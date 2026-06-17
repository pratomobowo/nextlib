<?php
namespace NextLib\Agent\Tests\Lib;

use PHPUnit\Framework\TestCase;
use NextLibAgent\Lib\Ed25519Verifier;

final class Ed25519VerifierTest extends TestCase
{
    public function testVerifyReturnsTrueForFreshSignature(): void
    {
        $kp = sodium_crypto_sign_keypair();
        $publicKey = base64_encode(sodium_crypto_sign_publickey($kp));
        $secretKey = sodium_crypto_sign_secretkey($kp);
        $timestamp = (string) time();
        $body = '{"a":1}';
        $message = "{$timestamp}.POST./api/v1/nextlib/handshake.{$body}";
        $sig = sodium_crypto_sign_detached($message, $secretKey);

        $this->assertTrue(
            Ed25519Verifier::verify($publicKey, base64_encode($sig), $timestamp, 'POST', '/api/v1/nextlib/handshake', $body, 300)
        );
    }

    public function testVerifyReturnsFalseForTamperedBody(): void
    {
        $kp = sodium_crypto_sign_keypair();
        $publicKey = base64_encode(sodium_crypto_sign_publickey($kp));
        $secretKey = sodium_crypto_sign_secretkey($kp);
        $timestamp = (string) time();
        $sig = sodium_crypto_sign_detached("{$timestamp}.POST./p.{}", $secretKey);
        $this->assertFalse(
            Ed25519Verifier::verify($publicKey, base64_encode($sig), $timestamp, 'POST', '/p', '{"x":1}', 300)
        );
    }

    public function testVerifyReturnsFalseForExpiredTimestamp(): void
    {
        $kp = sodium_crypto_sign_keypair();
        $publicKey = base64_encode(sodium_crypto_sign_publickey($kp));
        $secretKey = sodium_crypto_sign_secretkey($kp);
        $oldTs = (string) (time() - 1000);
        $body = '{}';
        $message = "{$oldTs}.POST./p.{$body}";
        $sig = sodium_crypto_sign_detached($message, $secretKey);
        $this->assertFalse(
            Ed25519Verifier::verify($publicKey, base64_encode($sig), $oldTs, 'POST', '/p', $body, 300)
        );
    }

    public function testVerifyReturnsFalseForMalformedPublicKey(): void
    {
        $this->assertFalse(
            Ed25519Verifier::verify('not-base64-!@#', 'sig', (string) time(), 'GET', '/', '', 300)
        );
    }

    public function testVerifyReturnsFalseForWrongLengthSignature(): void
    {
        $kp = sodium_crypto_sign_keypair();
        $publicKey = base64_encode(sodium_crypto_sign_publickey($kp));
        $this->assertFalse(
            Ed25519Verifier::verify($publicKey, base64_encode('short'), (string) time(), 'GET', '/', '', 300)
        );
    }
}
