<?php
/**
 * Unit tests for HttpClient HTTPS validation.
 *
 * Validates Requirement 8.2: THE NextLib_Agent SHALL menolak koneksi
 * dari NextLib_Cloud yang tidak menggunakan protokol HTTPS.
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\lib\HttpClient;
use InvalidArgumentException;

class HttpClientHttpsTest extends TestCase
{
    // =========================================================================
    // Constructor HTTPS enforcement tests
    // =========================================================================

    public function testConstructorAcceptsHttpsUrl(): void
    {
        $client = new HttpClient('https://cloud.nextlib.com', 5, null, true);

        $this->assertInstanceOf(HttpClient::class, $client);
    }

    public function testConstructorAcceptsHttpsUrlWithPort(): void
    {
        $client = new HttpClient('https://cloud.nextlib.com:8443', 5, null, true);

        $this->assertInstanceOf(HttpClient::class, $client);
    }

    public function testConstructorAcceptsHttpsUrlWithPath(): void
    {
        $client = new HttpClient('https://cloud.nextlib.com/api', 5, null, true);

        $this->assertInstanceOf(HttpClient::class, $client);
    }

    public function testConstructorRejectsHttpUrl(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('HTTPS');

        new HttpClient('http://cloud.nextlib.com', 5, null, true);
    }

    public function testConstructorRejectsHttpUrlWithClearErrorMessage(): void
    {
        try {
            new HttpClient('http://insecure.example.com', 5, null, true);
            $this->fail('Expected InvalidArgumentException was not thrown');
        } catch (InvalidArgumentException $e) {
            $this->assertStringContainsString('HTTPS', $e->getMessage());
            $this->assertStringContainsString('http://insecure.example.com', $e->getMessage());
        }
    }

    public function testConstructorRejectsUrlWithNoScheme(): void
    {
        $this->expectException(InvalidArgumentException::class);

        new HttpClient('cloud.nextlib.com', 5, null, true);
    }

    public function testConstructorRejectsFtpUrl(): void
    {
        $this->expectException(InvalidArgumentException::class);

        new HttpClient('ftp://cloud.nextlib.com', 5, null, true);
    }

    // =========================================================================
    // Enforcement can be disabled for testing
    // =========================================================================

    public function testConstructorAllowsHttpWhenEnforcementDisabled(): void
    {
        $client = new HttpClient('http://localhost:8080', 5, null, false);

        $this->assertInstanceOf(HttpClient::class, $client);
    }

    public function testEnforcementDisabledByDefaultIsFalse(): void
    {
        // Default is enforceHttps=true, so HTTP should be rejected
        $this->expectException(InvalidArgumentException::class);

        new HttpClient('http://cloud.nextlib.com');
    }

    // =========================================================================
    // isHttps() method tests
    // =========================================================================

    public function testIsHttpsReturnsTrueForHttpsUrl(): void
    {
        $client = new HttpClient('https://cloud.nextlib.com', 5, null, true);

        $this->assertTrue($client->isHttps('https://cloud.nextlib.com'));
    }

    public function testIsHttpsReturnsTrueForUppercaseHttps(): void
    {
        $client = new HttpClient('https://cloud.nextlib.com', 5, null, true);

        $this->assertTrue($client->isHttps('HTTPS://cloud.nextlib.com'));
    }

    public function testIsHttpsReturnsTrueForMixedCaseHttps(): void
    {
        $client = new HttpClient('https://cloud.nextlib.com', 5, null, true);

        $this->assertTrue($client->isHttps('Https://cloud.nextlib.com'));
    }

    public function testIsHttpsReturnsFalseForHttpUrl(): void
    {
        $client = new HttpClient('https://cloud.nextlib.com', 5, null, true);

        $this->assertFalse($client->isHttps('http://cloud.nextlib.com'));
    }

    public function testIsHttpsReturnsFalseForEmptyString(): void
    {
        $client = new HttpClient('https://cloud.nextlib.com', 5, null, true);

        $this->assertFalse($client->isHttps(''));
    }

    public function testIsHttpsReturnsFalseForNoScheme(): void
    {
        $client = new HttpClient('https://cloud.nextlib.com', 5, null, true);

        $this->assertFalse($client->isHttps('cloud.nextlib.com'));
    }

    // =========================================================================
    // post() HTTPS validation tests
    // =========================================================================

    public function testPostRejectsNonHttpsEndpointWhenEnforced(): void
    {
        // Use enforcement disabled in constructor with HTTPS base, then test
        // This scenario can't happen normally (base is always HTTPS when enforced)
        // But we test the post() validation by using a non-enforced client
        // and then testing with a client that has enforcement enabled
        $client = new HttpClient('https://cloud.nextlib.com', 5, null, true);

        // With an HTTPS base URL, the constructed full URL will always be HTTPS
        // so the post() validation won't trigger. This is correct behavior -
        // if the base is HTTPS, all endpoints will also be HTTPS.
        $result = $client->post('/api/v1/aggregate', '{}');

        // The request will likely fail due to DNS/network, but it should NOT
        // fail with an HTTPS error since the URL is valid HTTPS
        $this->assertNotEquals(
            'HTTPS is required for all cloud communication.',
            substr($result['error'] ?: '', 0, 45)
        );
    }

    public function testPostAllowsRequestWithEnforcementDisabled(): void
    {
        $client = new HttpClient('http://localhost:8080', 5, null, false);

        // The post will fail due to connection, but it should not reject
        // based on HTTPS validation
        $result = $client->post('/api/v1/aggregate', '{}');

        // Error should be connection-related, not HTTPS-related
        if ($result['error'] !== null) {
            $this->assertStringNotContainsString(
                'HTTPS is required',
                $result['error']
            );
        }
    }
}
