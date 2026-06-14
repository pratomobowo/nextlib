<?php
/**
 * Unit tests for TokenValidator middleware.
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\Middleware\TokenValidator;
use NextLibAgent\Lib\HmacSigner;

class TokenValidatorTest extends TestCase
{
    /**
     * @var string Test secret key
     */
    private $secretKey = 'test-secret-key-for-hmac-sha256';

    /**
     * @var TokenValidator
     */
    private $validator;

    protected function setUp(): void
    {
        $this->validator = new TokenValidator($this->secretKey);
    }

    // =========================================================================
    // validate() tests
    // =========================================================================

    public function testValidateReturnsTrueForValidToken(): void
    {
        $body = '{"query":"test","limit":10}';
        $token = $this->validator->generateToken($body);

        $this->assertTrue($this->validator->validate($token, $body));
    }

    public function testValidateReturnsFalseForWrongSecret(): void
    {
        $body = '{"query":"test"}';
        $otherValidator = new TokenValidator('different-secret-key');
        $token = $otherValidator->generateToken($body);

        $this->assertFalse($this->validator->validate($token, $body));
    }

    public function testValidateReturnsFalseForTamperedBody(): void
    {
        $body = '{"query":"test"}';
        $token = $this->validator->generateToken($body);

        $this->assertFalse($this->validator->validate($token, '{"query":"tampered"}'));
    }

    public function testValidateReturnsFalseForMalformedToken(): void
    {
        $this->assertFalse($this->validator->validate('not-a-valid-token', ''));
        $this->assertFalse($this->validator->validate('', ''));
        $this->assertFalse($this->validator->validate('abc.def', ''));
    }

    public function testValidateReturnsFalseForTamperedSignature(): void
    {
        $body = '{"query":"test"}';
        $token = $this->validator->generateToken($body);
        $parts = explode('.', $token, 2);
        $tamperedToken = $parts[0] . '.0000000000000000000000000000000000000000000000000000000000000000';

        $this->assertFalse($this->validator->validate($tamperedToken, $body));
    }

    public function testValidateReturnsFalseForTamperedTimestamp(): void
    {
        $body = '{"query":"test"}';
        $token = $this->validator->generateToken($body);
        $parts = explode('.', $token, 2);
        $tamperedToken = '9999999999.' . $parts[1];

        $this->assertFalse($this->validator->validate($tamperedToken, $body));
    }

    // =========================================================================
    // isExpired() tests
    // =========================================================================

    public function testIsExpiredReturnsFalseForFreshToken(): void
    {
        $body = '{"query":"test"}';
        $token = $this->validator->generateToken($body);

        $this->assertFalse($this->validator->isExpired($token));
    }

    public function testIsExpiredReturnsTrueForOldToken(): void
    {
        // Create a token with an old timestamp manually
        $signer = new HmacSigner($this->secretKey);
        $oldTimestamp = (string) (time() - 400); // 400 seconds ago, beyond 5 min window
        $signature = hash_hmac('sha256', $oldTimestamp . '{"test":"data"}', $this->secretKey);
        $expiredToken = $oldTimestamp . '.' . $signature;

        $this->assertTrue($this->validator->isExpired($expiredToken));
    }

    public function testIsExpiredReturnsTrueForMalformedToken(): void
    {
        $this->assertTrue($this->validator->isExpired('malformed'));
        $this->assertTrue($this->validator->isExpired(''));
    }

    public function testIsExpiredRespectsCustomMaxAge(): void
    {
        // Create a token 10 seconds old
        $signer = new HmacSigner($this->secretKey);
        $timestamp = (string) (time() - 10);
        $signature = hash_hmac('sha256', $timestamp . '', $this->secretKey);
        $token = $timestamp . '.' . $signature;

        // With default 300s, should NOT be expired
        $this->assertFalse($this->validator->isExpired($token));

        // With 5s max age, should be expired
        $this->assertTrue($this->validator->isExpired($token, 5));
    }

    public function testIsExpiredUsesConstructorMaxAgeWhenZeroPassed(): void
    {
        // Validator with 60s max age
        $shortLived = new TokenValidator($this->secretKey, 60);

        // Create a token 80 seconds old
        $timestamp = (string) (time() - 80);
        $signature = hash_hmac('sha256', $timestamp . '', $this->secretKey);
        $token = $timestamp . '.' . $signature;

        // Should be expired with 60s constructor max age
        $this->assertTrue($shortLived->isExpired($token, 0));
    }

    // =========================================================================
    // generateToken() tests
    // =========================================================================

    public function testGenerateTokenFormatsCorrectly(): void
    {
        $body = '{"query":"test"}';
        $token = $this->validator->generateToken($body);

        // Token should be in format {timestamp}.{signature}
        $parts = explode('.', $token, 2);
        $this->assertCount(2, $parts);
        $this->assertTrue(is_numeric($parts[0]), 'Timestamp should be numeric');
        $this->assertEquals(64, strlen($parts[1]), 'Signature should be 64 hex chars');
    }

    public function testGenerateTokenProducesUniqueSignaturesForDifferentBodies(): void
    {
        $token1 = $this->validator->generateToken('body1');
        $token2 = $this->validator->generateToken('body2');

        $sig1 = explode('.', $token1, 2)[1];
        $sig2 = explode('.', $token2, 2)[1];

        $this->assertNotEquals($sig1, $sig2);
    }

    public function testGenerateTokenWithEmptyBody(): void
    {
        $token = $this->validator->generateToken('');

        $parts = explode('.', $token, 2);
        $this->assertCount(2, $parts);
        $this->assertTrue(is_numeric($parts[0]));
        $this->assertEquals(64, strlen($parts[1]));

        // Should validate
        $this->assertTrue($this->validator->validate($token, ''));
    }

    // =========================================================================
    // Round-trip integration tests
    // =========================================================================

    public function testTokenRoundTripValidation(): void
    {
        $bodies = [
            '{"query":"searchterm","limit":10}',
            '{"member_id":"12345"}',
            '{"loan_id":"abc","days":7}',
            '',
            '{"unicode":"日本語テスト"}',
        ];

        foreach ($bodies as $body) {
            $token = $this->validator->generateToken($body);
            $this->assertTrue(
                $this->validator->validate($token, $body),
                "Token round-trip failed for body: $body"
            );
            $this->assertFalse(
                $this->validator->isExpired($token),
                "Fresh token should not be expired for body: $body"
            );
        }
    }
}
