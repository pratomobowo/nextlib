<?php
/**
 * Unit tests for HandshakePing class.
 *
 * Tests the agent-side handshake ping function that sends initial
 * connection verification to NextLib-Cloud.
 *
 * Verifies:
 * - Correct request body construction (action: "ping", tenant_id)
 * - HMAC-SHA256 token generation and inclusion in X-NextLib-Token header
 * - POST to /api/v1/handshake endpoint
 * - Success/failure response parsing
 * - Edge cases: missing config, connection errors
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\Lib\HandshakePing;
use NextLibAgent\lib\HttpClient;
use NextLibAgent\Lib\HmacSigner;

class HandshakePingTest extends TestCase
{
    // =========================================================================
    // Request body construction
    // =========================================================================

    public function testBuildRequestBodyContainsActionPing(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $config = array(
            'api_secret' => 'test-secret',
            'tenant_id' => 'tenant-123',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $body = $ping->buildRequestBody('tenant-123');
        $decoded = json_decode($body, true);

        $this->assertIsArray($decoded);
        $this->assertArrayHasKey('action', $decoded);
        $this->assertSame('ping', $decoded['action']);
    }

    public function testBuildRequestBodyContainsTenantId(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $config = array(
            'api_secret' => 'test-secret',
            'tenant_id' => 'my-university-tenant',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $body = $ping->buildRequestBody('my-university-tenant');
        $decoded = json_decode($body, true);

        $this->assertIsArray($decoded);
        $this->assertArrayHasKey('tenant_id', $decoded);
        $this->assertSame('my-university-tenant', $decoded['tenant_id']);
    }

    public function testBuildRequestBodyIsValidJson(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $config = array(
            'api_secret' => 'test-secret',
            'tenant_id' => 'tenant-abc',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $body = $ping->buildRequestBody('tenant-abc');

        $this->assertJson($body);
    }

    // =========================================================================
    // Successful handshake
    // =========================================================================

    public function testSendReturnsSuccessOnHttp200(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array(
                'status' => 200,
                'body' => '{"status":"ok","tenant_name":"Universitas Test"}',
                'error' => null,
            ));

        $config = array(
            'api_secret' => 'test-secret-key',
            'tenant_id' => 'tenant-123',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $result = $ping->send();

        $this->assertTrue($result['success']);
        $this->assertSame(200, $result['status']);
        $this->assertSame('Handshake successful', $result['message']);
    }

    public function testSendReturnsSuccessOnHttp201(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array(
                'status' => 201,
                'body' => '{"status":"ok"}',
                'error' => null,
            ));

        $config = array(
            'api_secret' => 'test-secret-key',
            'tenant_id' => 'tenant-456',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $result = $ping->send();

        $this->assertTrue($result['success']);
        $this->assertSame(201, $result['status']);
    }

    public function testSendReturnsResponseDataOnSuccess(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array(
                'status' => 200,
                'body' => '{"status":"ok","tenant_name":"Kampus A"}',
                'error' => null,
            ));

        $config = array(
            'api_secret' => 'test-secret-key',
            'tenant_id' => 'tenant-789',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $result = $ping->send();

        $this->assertIsArray($result['data']);
        $this->assertSame('ok', $result['data']['status']);
        $this->assertSame('Kampus A', $result['data']['tenant_name']);
    }

    // =========================================================================
    // Correct endpoint and headers
    // =========================================================================

    public function testSendPostsToHandshakeEndpoint(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->once())
            ->method('post')
            ->with(
                $this->equalTo('/api/v1/handshake'),
                $this->anything(),
                $this->anything()
            )
            ->willReturn(array('status' => 200, 'body' => '{"status":"ok"}', 'error' => null));

        $config = array(
            'api_secret' => 'test-secret',
            'tenant_id' => 'tenant-123',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $ping->send();
    }

    public function testSendIncludesContentTypeJsonHeader(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->once())
            ->method('post')
            ->with(
                $this->anything(),
                $this->anything(),
                $this->callback(function (array $headers) {
                    return in_array('Content-Type: application/json', $headers, true);
                })
            )
            ->willReturn(array('status' => 200, 'body' => '{"status":"ok"}', 'error' => null));

        $config = array(
            'api_secret' => 'test-secret',
            'tenant_id' => 'tenant-123',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $ping->send();
    }

    public function testSendIncludesXNextLibTokenHeader(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->once())
            ->method('post')
            ->with(
                $this->anything(),
                $this->anything(),
                $this->callback(function (array $headers) {
                    foreach ($headers as $header) {
                        if (strpos($header, 'X-NextLib-Token: ') === 0) {
                            return true;
                        }
                    }
                    return false;
                })
            )
            ->willReturn(array('status' => 200, 'body' => '{"status":"ok"}', 'error' => null));

        $config = array(
            'api_secret' => 'my-secret-key',
            'tenant_id' => 'tenant-123',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $ping->send();
    }

    public function testSendTokenIsValidHmacSignature(): void
    {
        $apiSecret = 'my-test-secret-key';
        $tenantId = 'tenant-xyz';
        $capturedHeaders = null;
        $capturedBody = null;

        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->once())
            ->method('post')
            ->with(
                $this->anything(),
                $this->callback(function (string $body) use (&$capturedBody) {
                    $capturedBody = $body;
                    return true;
                }),
                $this->callback(function (array $headers) use (&$capturedHeaders) {
                    $capturedHeaders = $headers;
                    return true;
                })
            )
            ->willReturn(array('status' => 200, 'body' => '{"status":"ok"}', 'error' => null));

        $config = array(
            'api_secret' => $apiSecret,
            'tenant_id' => $tenantId,
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $ping->send();

        // Extract token from captured headers
        $token = null;
        foreach ($capturedHeaders as $header) {
            if (strpos($header, 'X-NextLib-Token: ') === 0) {
                $token = substr($header, strlen('X-NextLib-Token: '));
                break;
            }
        }

        $this->assertNotNull($token, 'X-NextLib-Token header should be present');

        // Validate the token against the sent body
        $signer = new HmacSigner($apiSecret);
        $this->assertTrue(
            $signer->validateToken($token, $capturedBody),
            'Token should be a valid HMAC-SHA256 signature of the request body'
        );
    }

    public function testSendBodyContainsActionPingAndTenantId(): void
    {
        $tenantId = 'university-abc';
        $capturedBody = null;

        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->once())
            ->method('post')
            ->with(
                $this->anything(),
                $this->callback(function (string $body) use (&$capturedBody) {
                    $capturedBody = $body;
                    return true;
                }),
                $this->anything()
            )
            ->willReturn(array('status' => 200, 'body' => '{"status":"ok"}', 'error' => null));

        $config = array(
            'api_secret' => 'test-secret',
            'tenant_id' => $tenantId,
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $ping->send();

        $decoded = json_decode($capturedBody, true);
        $this->assertIsArray($decoded);
        $this->assertSame('ping', $decoded['action']);
        $this->assertSame($tenantId, $decoded['tenant_id']);
    }

    // =========================================================================
    // Failure scenarios
    // =========================================================================

    public function testSendReturnsFalseOnHttp401(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array(
                'status' => 401,
                'body' => '{"error":true,"message":"Token tidak valid"}',
                'error' => null,
            ));

        $config = array(
            'api_secret' => 'wrong-secret',
            'tenant_id' => 'tenant-123',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $result = $ping->send();

        $this->assertFalse($result['success']);
        $this->assertSame(401, $result['status']);
        $this->assertSame('Token tidak valid', $result['message']);
    }

    public function testSendReturnsFalseOnHttp500(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array(
                'status' => 500,
                'body' => 'Internal Server Error',
                'error' => null,
            ));

        $config = array(
            'api_secret' => 'test-secret',
            'tenant_id' => 'tenant-123',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $result = $ping->send();

        $this->assertFalse($result['success']);
        $this->assertSame(500, $result['status']);
    }

    public function testSendReturnsFalseOnConnectionError(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array(
                'status' => 0,
                'body' => '',
                'error' => 'Connection timed out',
            ));

        $config = array(
            'api_secret' => 'test-secret',
            'tenant_id' => 'tenant-123',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $result = $ping->send();

        $this->assertFalse($result['success']);
        $this->assertSame(0, $result['status']);
        $this->assertStringContainsString('Connection error', $result['message']);
    }

    // =========================================================================
    // Missing configuration edge cases
    // =========================================================================

    public function testSendReturnsFalseWhenApiSecretIsEmpty(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->never())->method('post');

        $config = array(
            'api_secret' => '',
            'tenant_id' => 'tenant-123',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $result = $ping->send();

        $this->assertFalse($result['success']);
        $this->assertSame('API secret is not configured', $result['message']);
    }

    public function testSendReturnsFalseWhenApiSecretMissing(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->never())->method('post');

        $config = array(
            'tenant_id' => 'tenant-123',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $result = $ping->send();

        $this->assertFalse($result['success']);
        $this->assertSame('API secret is not configured', $result['message']);
    }

    public function testSendReturnsFalseWhenTenantIdIsEmpty(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->never())->method('post');

        $config = array(
            'api_secret' => 'test-secret',
            'tenant_id' => '',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $result = $ping->send();

        $this->assertFalse($result['success']);
        $this->assertSame('Tenant ID is not configured', $result['message']);
    }

    public function testSendReturnsFalseWhenTenantIdMissing(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->never())->method('post');

        $config = array(
            'api_secret' => 'test-secret',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $result = $ping->send();

        $this->assertFalse($result['success']);
        $this->assertSame('Tenant ID is not configured', $result['message']);
    }

    // =========================================================================
    // Response parsing edge cases
    // =========================================================================

    public function testSendHandlesNonJsonResponseBody(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array(
                'status' => 200,
                'body' => 'OK',
                'error' => null,
            ));

        $config = array(
            'api_secret' => 'test-secret',
            'tenant_id' => 'tenant-123',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $result = $ping->send();

        $this->assertTrue($result['success']);
        $this->assertNull($result['data']);
    }

    public function testSendHandlesEmptyResponseBody(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array(
                'status' => 204,
                'body' => '',
                'error' => null,
            ));

        $config = array(
            'api_secret' => 'test-secret',
            'tenant_id' => 'tenant-123',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $result = $ping->send();

        $this->assertTrue($result['success']);
        $this->assertSame(204, $result['status']);
    }

    public function testSendUsesErrorMessageFromResponse(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array(
                'status' => 403,
                'body' => '{"error":true,"message":"Tenant not found"}',
                'error' => null,
            ));

        $config = array(
            'api_secret' => 'test-secret',
            'tenant_id' => 'unknown-tenant',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $ping = new HandshakePing($httpClient, $config);
        $result = $ping->send();

        $this->assertFalse($result['success']);
        $this->assertSame('Tenant not found', $result['message']);
    }
}
