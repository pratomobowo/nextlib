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
 * @version    1.0.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\Middleware;

use NextLibAgent\Lib\HmacSigner;

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
     * Middleware handler that validates the X-NextLib-Token header and
     * either proceeds with the endpoint callback or returns an HTTP 401 error.
     *
     * This is the primary entry point for protecting API endpoints.
     *
     * @param string   $secretKey     The shared secret key
     * @param callable $callback      Endpoint handler function, receives raw request body as argument
     * @param int      $maxAgeSeconds Maximum token age in seconds (default: 300)
     * @return void Outputs JSON response directly
     */
    public static function handle(string $secretKey, callable $callback, int $maxAgeSeconds = 300)
    {
        $validator = new self($secretKey, $maxAgeSeconds);

        // Extract the X-NextLib-Token header
        $token = self::extractToken();

        if ($token === null || $token === '') {
            self::sendError(
                401,
                'INVALID_TOKEN',
                'Token tidak valid: header X-NextLib-Token tidak ditemukan'
            );
            return;
        }

        // Read the raw request body
        $requestBody = self::getRequestBody();

        // Check signature validity
        if (!$validator->validate($token, $requestBody)) {
            self::sendError(
                401,
                'INVALID_TOKEN',
                'Token tidak valid: signature HMAC-SHA256 tidak cocok'
            );
            return;
        }

        // Check timestamp expiry
        if ($validator->isExpired($token)) {
            self::sendError(
                401,
                'TOKEN_EXPIRED',
                'Token sudah kedaluwarsa: melebihi batas waktu 5 menit'
            );
            return;
        }

        // Token is valid, proceed with the endpoint handler
        $result = call_user_func($callback, $requestBody);

        // If the callback returns data, output it as JSON
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
     * @param int   $statusCode HTTP status code
     * @param array $data       Response data to encode as JSON
     * @return void
     */
    private static function sendJson(int $statusCode, array $data)
    {
        http_response_code($statusCode);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE);
    }
}
