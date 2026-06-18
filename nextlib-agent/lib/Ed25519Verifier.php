<?php
/**
 * Ed25519 signature verifier for inbound NextLib-Cloud requests.
 *
 * Message signed by SaaS: `${timestamp}.${method}.${path}.${body}`
 * - timestamp: seconds since epoch (string)
 * - method: HTTP verb, uppercased
 * - path: URL path (e.g. "/api/v1/nextlib/handshake")
 * - body: raw request body (string)
 *
 * Headers expected from SaaS:
 *   X-NextLib-Timestamp: <seconds>
 *   X-NextLib-Signature: <base64 sig, 64 bytes>
 *
 * @package    NextLib-Agent
 * @subpackage Lib
 * @version    2.1.0
 * @requires   PHP 7.4+ with libsodium (sodium_crypto_sign_verify_detached)
 */

namespace NextLibAgent\Lib;

final class Ed25519Verifier
{
    /**
     * Verify a detached Ed25519 signature.
     *
     * @param string $publicKeyBase64 32-byte raw public key, base64-encoded
     * @param string $signatureBase64 64-byte detached signature, base64-encoded
     * @param string $timestamp       Seconds since epoch, as string
     * @param string $method          HTTP verb (case-insensitive — uppercased internally)
     * @param string $path            URL path (e.g. "/api/v1/nextlib/handshake")
     * @param string $body            Raw request body
     * @param int    $maxAgeSec       Tolerance window; older timestamps are rejected
     * @return bool true if signature is valid AND timestamp is within maxAgeSec of now
     */
    public static function verify(
        string $publicKeyBase64,
        string $signatureBase64,
        string $timestamp,
        string $method,
        string $path,
        string $body,
        int $maxAgeSec
    ): bool {
        if (!function_exists('sodium_crypto_sign_verify_detached')) {
            error_log('Ed25519Verifier: libsodium extension not loaded');
            return false;
        }

        $ts = filter_var($timestamp, FILTER_VALIDATE_INT);
        if ($ts === false) return false;
        if (abs(time() - $ts) > $maxAgeSec) return false;

        $publicKey = base64_decode($publicKeyBase64, true);
        $signature = base64_decode($signatureBase64, true);
        if ($publicKey === false || $signature === false) return false;
        if (strlen($publicKey) !== 32 || strlen($signature) !== 64) return false;

        $message = $timestamp . '.' . strtoupper($method) . '.' . $path . '.' . $body;
        return sodium_crypto_sign_verify_detached($signature, $message, $publicKey);
    }
}
