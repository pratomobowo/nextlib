<?php
/**
 * Property-Based Tests: Expired Tokens Always Rejected
 *
 * **Validates: Requirements 3.3**
 *
 * Property 7: For all tokens with timestamp more than 5 minutes (300 seconds)
 * in the past, isExpired() always returns true.
 *
 * Formal: ∀ token where token.timestamp < (now - 300s): isExpired(token) == true
 *
 * This test simulates property-based testing by generating many random
 * timestamps beyond the 5-minute window and verifying that the expiry
 * detection holds universally.
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\Middleware\TokenValidator;
use NextLibAgent\Lib\HmacSigner;

class TokenExpiryPropertyTest extends TestCase
{
    /**
     * @var string Test secret key
     */
    private $secretKey = 'property-test-secret-key-for-expiry';

    /**
     * @var TokenValidator
     */
    private $validator;

    /**
     * @var HmacSigner
     */
    private $signer;

    /**
     * Number of random iterations for property tests.
     */
    const ITERATIONS = 100;

    protected function setUp(): void
    {
        $this->validator = new TokenValidator($this->secretKey);
        $this->signer = new HmacSigner($this->secretKey);
    }

    // =========================================================================
    // Property 7: Expired Tokens Always Rejected
    // ∀ token where token.timestamp < (now - 300s): isExpired(token) == true
    // **Validates: Requirements 3.3**
    // =========================================================================

    /**
     * Property: Tokens with timestamp 301+ seconds in the past are always expired.
     *
     * Generates 100 random timestamps ranging from 301 seconds to 1 year
     * in the past, constructs valid tokens with those timestamps, and
     * verifies isExpired() always returns true.
     *
     * **Validates: Requirements 3.3**
     */
    public function testExpiredTimestampsAlwaysRejected(): void
    {
        $now = time();

        for ($i = 0; $i < self::ITERATIONS; $i++) {
            // Generate a random age between 301 seconds and 1 year (31536000 seconds)
            $age = random_int(301, 31536000);
            $oldTimestamp = (string) ($now - $age);
            $requestBody = '{"iteration":' . $i . ',"data":"test"}';

            // Construct a valid token with the old timestamp
            $signature = hash_hmac('sha256', $oldTimestamp . $requestBody, $this->secretKey);
            $token = $oldTimestamp . '.' . $signature;

            $this->assertTrue(
                $this->validator->isExpired($token),
                sprintf(
                    "Token with age %d seconds (timestamp=%s) should be expired but was not. Iteration %d.",
                    $age,
                    $oldTimestamp,
                    $i
                )
            );
        }
    }

    /**
     * Property: Tokens with very old timestamps (days/weeks/months ago)
     * are always expired.
     *
     * Tests with extreme past timestamps to ensure no overflow or
     * edge-case issues.
     *
     * **Validates: Requirements 3.3**
     */
    public function testVeryOldTimestampsAlwaysExpired(): void
    {
        $now = time();

        $extremeAges = array(
            3600,         // 1 hour
            86400,        // 1 day
            604800,       // 1 week
            2592000,      // 30 days
            7776000,      // 90 days
            15552000,     // 180 days
            31536000,     // 1 year
            63072000,     // 2 years
            157680000,    // 5 years
        );

        foreach ($extremeAges as $age) {
            $oldTimestamp = (string) ($now - $age);
            $requestBody = '{"test":"extreme-age"}';
            $signature = hash_hmac('sha256', $oldTimestamp . $requestBody, $this->secretKey);
            $token = $oldTimestamp . '.' . $signature;

            $this->assertTrue(
                $this->validator->isExpired($token),
                sprintf(
                    "Token with age %d seconds (%s) should be expired.",
                    $age,
                    $this->humanReadableAge($age)
                )
            );
        }
    }

    /**
     * Property: Boundary test - token at exactly 301 seconds old is expired.
     *
     * The 5-minute window is 300 seconds. A token at 301 seconds exceeds
     * the window and must be rejected.
     *
     * **Validates: Requirements 3.3**
     */
    public function testBoundaryAt301SecondsIsExpired(): void
    {
        $now = time();
        $oldTimestamp = (string) ($now - 301);
        $requestBody = '{"boundary":"test-301"}';
        $signature = hash_hmac('sha256', $oldTimestamp . $requestBody, $this->secretKey);
        $token = $oldTimestamp . '.' . $signature;

        $this->assertTrue(
            $this->validator->isExpired($token),
            "Token at exactly 301 seconds old should be expired (exceeds 300s window)"
        );
    }

    /**
     * Property: Boundary test - token at exactly 300 seconds old is NOT expired.
     *
     * The condition is `tokenAge > maxAgeSeconds`. At exactly 300 seconds,
     * tokenAge (300) is NOT greater than maxAgeSeconds (300), so it should
     * still be valid.
     *
     * **Validates: Requirements 3.3**
     */
    public function testBoundaryAt300SecondsIsNotExpired(): void
    {
        $now = time();
        $oldTimestamp = (string) ($now - 300);
        $requestBody = '{"boundary":"test-300"}';
        $signature = hash_hmac('sha256', $oldTimestamp . $requestBody, $this->secretKey);
        $token = $oldTimestamp . '.' . $signature;

        $this->assertFalse(
            $this->validator->isExpired($token),
            "Token at exactly 300 seconds old should NOT be expired (300 is not > 300)"
        );
    }

    /**
     * Property: For all random request bodies, expired tokens are always
     * detected regardless of the body content.
     *
     * The request body should not influence expiry detection - only the
     * timestamp matters.
     *
     * **Validates: Requirements 3.3**
     */
    public function testExpiryIsIndependentOfRequestBody(): void
    {
        $now = time();

        for ($i = 0; $i < self::ITERATIONS; $i++) {
            $age = random_int(301, 86400);
            $oldTimestamp = (string) ($now - $age);

            // Generate a random request body
            $requestBody = $this->generateRandomRequestBody();

            $signature = hash_hmac('sha256', $oldTimestamp . $requestBody, $this->secretKey);
            $token = $oldTimestamp . '.' . $signature;

            $this->assertTrue(
                $this->validator->isExpired($token),
                sprintf(
                    "Expired token (age=%ds) should be detected regardless of body content. Iteration %d, body='%s'",
                    $age,
                    $i,
                    substr($requestBody, 0, 100)
                )
            );
        }
    }

    /**
     * Property: For all random secret keys, expired tokens are always
     * detected regardless of which secret was used to sign.
     *
     * Expiry is based solely on the timestamp, not the signature validity.
     *
     * **Validates: Requirements 3.3**
     */
    public function testExpiryIsIndependentOfSecretKey(): void
    {
        $now = time();

        for ($i = 0; $i < self::ITERATIONS; $i++) {
            $age = random_int(301, 86400);
            $oldTimestamp = (string) ($now - $age);
            $requestBody = '{"test":"secret-independence"}';

            // Use a random secret key to sign
            $randomSecret = bin2hex(random_bytes(random_int(8, 64)));
            $signature = hash_hmac('sha256', $oldTimestamp . $requestBody, $randomSecret);
            $token = $oldTimestamp . '.' . $signature;

            // Validate with the test validator (different secret)
            $this->assertTrue(
                $this->validator->isExpired($token),
                sprintf(
                    "Expired token (age=%ds) should be detected regardless of signing secret. Iteration %d.",
                    $age,
                    $i
                )
            );
        }
    }

    /**
     * Property: Fresh tokens (within the 5-minute window) are never
     * reported as expired.
     *
     * This is the complementary property: tokens within [0, 299] seconds
     * should NOT be expired.
     *
     * **Validates: Requirements 3.3**
     */
    public function testFreshTokensNeverReportedAsExpired(): void
    {
        $now = time();

        for ($i = 0; $i < self::ITERATIONS; $i++) {
            // Generate a random age between 0 and 299 seconds (within window)
            $age = random_int(0, 299);
            $freshTimestamp = (string) ($now - $age);
            $requestBody = '{"fresh":"iteration-' . $i . '"}';

            $signature = hash_hmac('sha256', $freshTimestamp . $requestBody, $this->secretKey);
            $token = $freshTimestamp . '.' . $signature;

            $this->assertFalse(
                $this->validator->isExpired($token),
                sprintf(
                    "Token with age %d seconds (within 300s window) should NOT be expired. Iteration %d.",
                    $age,
                    $i
                )
            );
        }
    }

    /**
     * Property: Tokens generated via generateToken() are never immediately
     * expired (sanity check for the generation mechanism).
     *
     * **Validates: Requirements 3.3**
     */
    public function testGeneratedTokensAreNeverImmediatelyExpired(): void
    {
        for ($i = 0; $i < self::ITERATIONS; $i++) {
            $requestBody = $this->generateRandomRequestBody();
            $token = $this->validator->generateToken($requestBody);

            $this->assertFalse(
                $this->validator->isExpired($token),
                sprintf(
                    "Freshly generated token should never be expired. Iteration %d, body='%s'",
                    $i,
                    substr($requestBody, 0, 100)
                )
            );
        }
    }

    /**
     * Property: Malformed tokens (no dot separator, non-numeric timestamp)
     * are always treated as expired for safety.
     *
     * **Validates: Requirements 3.3**
     */
    public function testMalformedTokensAlwaysTreatedAsExpired(): void
    {
        $malformedTokens = array(
            '',
            'no-dot-separator',
            'abc.validlookingsignature',
            '.onlysignature',
            'onlytimestamp.',
            '..doubleDot',
            'not-numeric.abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
            'NaN.abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
            'Infinity.abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
        );

        foreach ($malformedTokens as $token) {
            $this->assertTrue(
                $this->validator->isExpired($token),
                sprintf("Malformed token '%s' should be treated as expired", $token)
            );
        }

        // Also test with random garbage strings
        for ($i = 0; $i < 50; $i++) {
            $garbage = bin2hex(random_bytes(random_int(1, 32)));
            $this->assertTrue(
                $this->validator->isExpired($garbage),
                sprintf("Random garbage token '%s' should be treated as expired", $garbage)
            );
        }
    }

    // =========================================================================
    // Helper methods
    // =========================================================================

    /**
     * Generate a random JSON request body.
     *
     * @return string Random JSON string
     */
    private function generateRandomRequestBody(): string
    {
        $type = random_int(0, 4);

        switch ($type) {
            case 0:
                // Search query
                $queries = array('perpustakaan', 'database', 'algoritma', 'komputer', 'jaringan', 'sistem operasi');
                return json_encode(array(
                    'query' => $queries[array_rand($queries)],
                    'limit' => random_int(1, 100),
                ));
            case 1:
                // Member check
                return json_encode(array(
                    'member_id' => (string) random_int(10000, 99999),
                ));
            case 2:
                // Extend book
                return json_encode(array(
                    'loan_id' => 'LN' . random_int(1000, 9999),
                    'days' => random_int(1, 30),
                ));
            case 3:
                // Empty body
                return '';
            case 4:
                // Large random body
                return json_encode(array(
                    'data' => bin2hex(random_bytes(random_int(10, 200))),
                    'timestamp' => time(),
                    'random' => random_int(0, PHP_INT_MAX),
                ));
            default:
                return '';
        }
    }

    /**
     * Convert seconds to human-readable age string.
     *
     * @param int $seconds
     * @return string
     */
    private function humanReadableAge(int $seconds): string
    {
        if ($seconds >= 31536000) {
            return round($seconds / 31536000, 1) . ' years';
        }
        if ($seconds >= 86400) {
            return round($seconds / 86400, 1) . ' days';
        }
        if ($seconds >= 3600) {
            return round($seconds / 3600, 1) . ' hours';
        }
        if ($seconds >= 60) {
            return round($seconds / 60, 1) . ' minutes';
        }
        return $seconds . ' seconds';
    }
}
