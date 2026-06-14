<?php
/**
 * HMAC-SHA256 Signing Utility
 *
 * Provides methods for generating and validating HMAC-SHA256 tokens
 * used for secure communication between NextLib-Agent and NextLib-Cloud.
 *
 * Token format: {timestamp}.{signature}
 * Where signature = HMAC-SHA256(timestamp + request_body, secret_key)
 *
 * @package    NextLib-Agent
 * @subpackage Lib
 * @version    1.0.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\Lib;

class HmacSigner
{
    /**
     * @var string The secret key for HMAC-SHA256 operations
     */
    private $secretKey;

    /**
     * @param string $secretKey The shared secret key for HMAC signing
     */
    public function __construct(string $secretKey)
    {
        $this->secretKey = $secretKey;
    }

    /**
     * Generate a signed token for the given request body.
     *
     * Creates a token in the format {timestamp}.{signature} where
     * signature is HMAC-SHA256 of (timestamp + request_body) using the secret key.
     *
     * @param string $requestBody The request body to sign
     * @return string Token in format {timestamp}.{signature}
     */
    public function generateToken(string $requestBody): string
    {
        $timestamp = (string) time();
        $signature = $this->sign($timestamp . $requestBody);

        return $timestamp . '.' . $signature;
    }

    /**
     * Validate a token against the request body.
     *
     * Extracts the timestamp from the token, recomputes the expected
     * signature, and compares using timing-safe comparison to prevent
     * timing attacks.
     *
     * @param string $token       The token to validate (format: {timestamp}.{signature})
     * @param string $requestBody The request body to verify against
     * @return bool True if the signature is valid, false otherwise
     */
    public function validateToken(string $token, string $requestBody): bool
    {
        $parts = explode('.', $token, 2);

        if (count($parts) !== 2) {
            return false;
        }

        $timestamp = $parts[0];
        $signature = $parts[1];

        // Verify timestamp is numeric
        if (!is_numeric($timestamp)) {
            return false;
        }

        // Recompute expected signature
        $expectedSignature = $this->sign($timestamp . $requestBody);

        // Use timing-safe comparison to prevent timing attacks
        return hash_equals($expectedSignature, $signature);
    }

    /**
     * Check if a token has expired based on its timestamp.
     *
     * @param string $token          The token to check (format: {timestamp}.{signature})
     * @param int    $maxAgeSeconds  Maximum allowed age in seconds (default: 300 = 5 minutes)
     * @return bool True if the token is expired, false if still valid
     */
    public function isExpired(string $token, int $maxAgeSeconds = 300): bool
    {
        $parts = explode('.', $token, 2);

        if (count($parts) !== 2) {
            return true;
        }

        $timestamp = $parts[0];

        if (!is_numeric($timestamp)) {
            return true;
        }

        $tokenAge = time() - (int) $timestamp;

        return $tokenAge > $maxAgeSeconds;
    }

    /**
     * Compute HMAC-SHA256 signature.
     *
     * @param string $data The data to sign (typically timestamp + request_body)
     * @return string Hex-encoded HMAC-SHA256 signature
     */
    public function sign(string $data): string
    {
        return hash_hmac('sha256', $data, $this->secretKey);
    }
}
