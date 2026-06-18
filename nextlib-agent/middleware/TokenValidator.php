<?php
/**
 * Token Validation Middleware
 *
 * Validates incoming API requests using HMAC-SHA256 token verification.
 * Checks both signature validity and timestamp expiry (5-minute window).
 *
 * Token format: {timestamp}.{signature}
 * Where signature = HMAC-SHA256(timestamp + request_body, secret_key)
 *
 * Usage:
 *   TokenValidator::handle($secretKey, function($requestBody) {
 *       // Your endpoint logic here
 *       return ['success' => true];
 *   });
 *
 * @package    NextLib-Agent
 * @subpackage Middleware
 * @version    2.1.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\Middleware;

use NextLibAgent\Lib\HmacSigner;
use NextLibAgent\Lib\Ed25519Verifier;

class TokenValidator
{
    /**
     * @var string Secret key for HMAC validation
     */
    private $secretKey;

    /**
     * @var int Maximum token age in seconds (default: 300 = 5 minutes)
     */
    private $maxAgeSeconds;

    /**
     * @var HmacSigner HMAC signing utility
     */
    private $signer;

    /**
     * @param string $secretKey     The shared secret key for HMAC-SHA256
     * @param int    $maxAgeSeconds Maximum token age in seconds
     */
    public function __construct(string $secretKey, int $maxAgeSeconds = 300)
    {
        $this->secretKey = $secretKey;
        $this->maxAgeSeconds = $maxAgeSeconds;
        $this->signer = new HmacSigner($secretKey);
    }

    /**
     * Validate a token against the request body.
     *
     * Checks that the HMAC-SHA256 signature matches the expected value
     * computed from the timestamp and request body using the secret key.
     *
     * @param string $token       The token from X-NextLib-Token header
     * @param string $requestBody The raw request body
     * @return bool True if token signature is valid
     */
    public function validate(string $token, string $requestBody): bool
    {
        return $this->signer->validateToken($token, $requestBody);
    }

    /**
     * Check if a token has expired based on its timestamp.
     *
     * @param string $token         The token to check
     * @param int    $maxAgeSeconds Override max age (0 uses instance default)
     * @return bool True if token is expired
     */
    public function isExpired(string $token, int $maxAgeSeconds = 0): bool
    {
        $effectiveMaxAge = $maxAgeSeconds > 0 ? $maxAgeSeconds : $this->maxAgeSeconds;

        return $this->signer->isExpired($token, $effectiveMaxAge);
    }

    /**
     * Generate a new token for the given request body.
     *
     * @param string $requestBody The request body to sign
     * @return string The generated token in format {timestamp}.{signature}
     */
    public function generateToken(string $requestBody): string
    {
        return $this->signer->generateToken($requestBody);
    }

    /**
     * Middleware handler that validates the request and either proceeds with
     * the endpoint callback or returns an HTTP 401 error.
     *
     * Supports two auth schemes (tried in order):
     *
     * 1. **Ed25519 (preferred):**
     *    - `X-NextLib-Timestamp`: seconds since epoch
     *    - `X-NextLib-Signature`: base64-encoded 64-byte detached Ed25519 signature
     *      over `${timestamp}.${METHOD}.${path}.${body}`
     *    - `$ed25519PublicKey` is the 32-byte raw public key, base64-encoded
     *
     * 2. **Legacy HMAC (backward compat):**
     *    - `X-NextLib-Token`: `${timestamp}.${hex(HMAC-SHA256(timestamp.body, secret))}`
     *    - `X-NextLib-Secret-Hash`: SHA-256(secret) hex
     *    - `$hmacSecret` is the shared secret
     *
     * Both arguments are passed separately so each scheme can use its own key
     * — Ed25519 and HMAC keys are independent. If Ed25519 headers are present
     * but verification fails, the request is rejected with 401 INVALID_SIGNATURE
     * (no fallback to HMAC — prevents downgrade attacks).
     *
     * @param string   $ed25519PublicKey 32-byte raw Ed25519 public key, base64-encoded
     * @param string   $hmacSecret       Shared HMAC secret (legacy v1)
     * @param callable $callback         Endpoint handler function, receives raw request body as argument
     * @param int      $maxAgeSeconds    Maximum token age in seconds (default: 300)
     * @return void Outputs JSON response directly
     */
    public static function handle(string $ed25519PublicKey, string $hmacSecret, callable $callback, int $maxAgeSeconds = 300)
    {
        $headers = self::collectHeaders();

        $body = self::getRequestBody();
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

        // Path 1: Ed25519 (preferred)
        $timestamp = $headers['x-nextlib-timestamp'] ?? null;
        $signature = $headers['x-nextlib-signature'] ?? null;
        if ($timestamp !== null && $signature !== null) {
            if (Ed25519Verifier::verify($ed25519PublicKey, $signature, $timestamp, $method, $path, $body, $maxAgeSeconds)) {
                $result = call_user_func($callback, $body);
                if ($result !== null) {
                    self::sendJson(200, $result);
                }
                return;
            }
            self::sendError(
                401,
                'INVALID_SIGNATURE',
                'Tanda tangan Ed25519 tidak valid atau timestamp kedaluwarsa'
            );
            return;
        }

        // Path 2: legacy HMAC token (backward compat)
        $token = $headers['x-nextlib-token'] ?? null;
        $secretHash = $headers['x-nextlib-secret-hash'] ?? null;
        if ($token === null || $secretHash === null) {
            self::sendError(
                401,
                'MISSING_AUTH',
                'Header X-NextLib-Timestamp+X-NextLib-Signature (Ed25519) atau X-NextLib-Token+X-NextLib-Secret-Hash (HMAC) tidak ditemukan'
            );
            return;
        }

        $validator = new self($hmacSecret, $maxAgeSeconds);

        if (!$validator->validate($token, $body)) {
            self::sendError(
                401,
                'INVALID_TOKEN',
                'Token tidak valid: signature HMAC-SHA256 tidak cocok'
            );
            return;
        }

        if ($validator->isExpired($token)) {
            self::sendError(
                401,
                'TOKEN_EXPIRED',
                'Token sudah kedaluwarsa: melebihi batas waktu 5 menit'
            );
            return;
        }

        $result = call_user_func($callback, $body);

        if ($result !== null) {
            self::sendJson(200, $result);
        }
    }

    /**
     * Extract the X-NextLib-Token header from the current request.
     *
     * Supports both Apache (via $_SERVER) and various PHP SAPI environments.
     *
     * @return string|null The token value or null if not present
     */
    private static function extractToken()
    {
        // Standard: check $_SERVER for the header
        if (isset($_SERVER['HTTP_X_NEXTLIB_TOKEN'])) {
            return $_SERVER['HTTP_X_NEXTLIB_TOKEN'];
        }

        // Fallback: try getallheaders() if available (Apache module)
        if (function_exists('getallheaders')) {
            $headers = getallheaders();
            if ($headers === false) {
                return null;
            }

            // Headers are case-insensitive per HTTP spec
            foreach ($headers as $name => $value) {
                if (strtolower($name) === 'x-nextlib-token') {
                    return $value;
                }
            }
        }

        return null;
    }

    /**
     * Collect all HTTP request headers as lowercase => value.
     *
     * Prefers getallheaders() (Apache/CGI mod_php); falls back to scanning
     * $_SERVER['HTTP_*'] which is populated by every SAPI (PHP-FPM, CLI test
     * runner, built-in server, etc.). This makes TokenValidator testable
     * outside Apache and robust across PHP configurations.
     *
     * @return array<string, string>
     */
    private static function collectHeaders(): array
    {
        $headers = [];

        if (function_exists('getallheaders')) {
            $raw = @getallheaders();
            if (is_array($raw)) {
                foreach ($raw as $name => $value) {
                    $headers[strtolower((string) $name)] = (string) $value;
                }
            }
        }

        foreach ($_SERVER as $key => $value) {
            if (strpos($key, 'HTTP_') === 0) {
                // HTTP_X_NEXTLIB_TIMESTAMP → x-nextlib-timestamp
                $name = strtolower(str_replace('_', '-', substr($key, 5)));
                $headers[$name] = (string) $value;
            }
        }

        return $headers;
    }

    /**
     * Get the raw request body.
     *
     * @return string The raw request body (empty string if none)
     */
    private static function getRequestBody(): string
    {
        $body = file_get_contents('php://input');

        return $body !== false ? $body : '';
    }

    /**
     * Send a JSON error response with the given HTTP status code.
     *
     * @param int    $statusCode HTTP status code
     * @param string $code       Error code identifier
     * @param string $message    Human-readable error message
     * @return void
     */
    private static function sendError(int $statusCode, string $code, string $message)
    {
        self::sendJson($statusCode, array(
            'error' => true,
            'code' => $code,
            'message' => $message,
        ));
    }

    /**
     * Send a JSON response with the given HTTP status code.
     *
     * Skips http_response_code/header() if headers have already been sent
     * (e.g., in CLI/test environments). The JSON body is always emitted so
     * callers can still inspect the response.
     *
     * @param int   $statusCode HTTP status code
     * @param array $data       Response data to encode as JSON
     * @return void
     */
    private static function sendJson(int $statusCode, array $data)
    {
        if (!headers_sent()) {
            http_response_code($statusCode);
            header('Content-Type: application/json; charset=utf-8');
        }
        echo json_encode($data, JSON_UNESCAPED_UNICODE);
    }
}
