<?php
/**
 * Unit tests for AggregateExporter::send() method.
 *
 * Tests the send() method using mock HttpClient to verify:
 * - HMAC-SHA256 signed requests
 * - Correct headers (Content-Encoding: gzip, X-NextLib-Token)
 * - HTTP 2xx returns true, non-2xx returns false
 * - Empty payload handling
 * - Missing api_secret handling
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\Exporter\AggregateExporter;
use NextLibAgent\lib\HttpClient;
use NextLibAgent\Lib\HmacSigner;
use PDO;

class SendMethodTest extends TestCase
{
    /**
     * @var PDO In-memory SQLite database
     */
    private $db;

    /**
     * @var string Test queue path
     */
    private $queuePath;

    protected function setUp(): void
    {
        $this->db = new PDO('sqlite::memory:');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        // Create minimal tables needed by AggregateExporter
        $this->db->exec("CREATE TABLE visitor_count (visitor_id INTEGER PRIMARY KEY, checkin_date DATETIME)");
        $this->db->exec("CREATE TABLE loan (loan_id INTEGER PRIMARY KEY, loan_date DATE, return_date DATE)");

        $this->queuePath = sys_get_temp_dir() . '/nextlib-test-queue-' . getmypid();
        if (!is_dir($this->queuePath)) {
            mkdir($this->queuePath, 0755, true);
        }
    }

    protected function tearDown(): void
    {
        // Clean up queue directory
        $queueFile = $this->queuePath . '/pending_exports.json';
        if (file_exists($queueFile)) {
            unlink($queueFile);
        }
        if (is_dir($this->queuePath)) {
            rmdir($this->queuePath);
        }
    }

    // =========================================================================
    // send() success scenarios
    // =========================================================================

    public function testSendReturnsTrueOnHttp200(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array('status' => 200, 'body' => '{"ok":true}', 'error' => null));

        $config = array(
            'tenant_id' => 'test-tenant',
            'cloud_base_url' => 'https://cloud.nextlib.id',
            'api_secret' => 'test-secret-key-123',
        );

        $exporter = new AggregateExporter($this->db, $httpClient, $config, $this->queuePath);
        $compressed = gzencode('{"test":"data"}', 9);

        $result = $exporter->send($compressed);

        $this->assertTrue($result);
    }

    public function testSendReturnsTrueOnHttp201(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array('status' => 201, 'body' => '', 'error' => null));

        $config = array(
            'tenant_id' => 'test-tenant',
            'cloud_base_url' => 'https://cloud.nextlib.id',
            'api_secret' => 'test-secret-key-123',
        );

        $exporter = new AggregateExporter($this->db, $httpClient, $config, $this->queuePath);
        $compressed = gzencode('{"test":"data"}', 9);

        $result = $exporter->send($compressed);

        $this->assertTrue($result);
    }

    public function testSendReturnsTrueOnHttp204(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array('status' => 204, 'body' => '', 'error' => null));

        $config = array(
            'tenant_id' => 'test-tenant',
            'cloud_base_url' => 'https://cloud.nextlib.id',
            'api_secret' => 'test-secret-key-123',
        );

        $exporter = new AggregateExporter($this->db, $httpClient, $config, $this->queuePath);
        $compressed = gzencode('{"test":"data"}', 9);

        $result = $exporter->send($compressed);

        $this->assertTrue($result);
    }

    // =========================================================================
    // send() failure scenarios
    // =========================================================================

    public function testSendReturnsFalseOnHttp401(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array('status' => 401, 'body' => '{"error":"unauthorized"}', 'error' => null));

        $config = array(
            'tenant_id' => 'test-tenant',
            'cloud_base_url' => 'https://cloud.nextlib.id',
            'api_secret' => 'test-secret-key-123',
        );

        $exporter = new AggregateExporter($this->db, $httpClient, $config, $this->queuePath);
        $compressed = gzencode('{"test":"data"}', 9);

        $result = $exporter->send($compressed);

        $this->assertFalse($result);
    }

    public function testSendReturnsFalseOnHttp500(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array('status' => 500, 'body' => 'Internal Server Error', 'error' => null));

        $config = array(
            'tenant_id' => 'test-tenant',
            'cloud_base_url' => 'https://cloud.nextlib.id',
            'api_secret' => 'test-secret-key-123',
        );

        $exporter = new AggregateExporter($this->db, $httpClient, $config, $this->queuePath);
        $compressed = gzencode('{"test":"data"}', 9);

        $result = $exporter->send($compressed);

        $this->assertFalse($result);
    }

    public function testSendReturnsFalseOnHttp0ConnectionError(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array('status' => 0, 'body' => '', 'error' => 'Connection timed out'));

        $config = array(
            'tenant_id' => 'test-tenant',
            'cloud_base_url' => 'https://cloud.nextlib.id',
            'api_secret' => 'test-secret-key-123',
        );

        $exporter = new AggregateExporter($this->db, $httpClient, $config, $this->queuePath);
        $compressed = gzencode('{"test":"data"}', 9);

        $result = $exporter->send($compressed);

        $this->assertFalse($result);
    }

    public function testSendReturnsFalseOnHttp403(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array('status' => 403, 'body' => 'Forbidden', 'error' => null));

        $config = array(
            'tenant_id' => 'test-tenant',
            'cloud_base_url' => 'https://cloud.nextlib.id',
            'api_secret' => 'test-secret-key-123',
        );

        $exporter = new AggregateExporter($this->db, $httpClient, $config, $this->queuePath);
        $compressed = gzencode('{"test":"data"}', 9);

        $result = $exporter->send($compressed);

        $this->assertFalse($result);
    }

    // =========================================================================
    // send() validation / edge cases
    // =========================================================================

    public function testSendReturnsFalseForEmptyPayload(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->never())->method('post');

        $config = array(
            'tenant_id' => 'test-tenant',
            'cloud_base_url' => 'https://cloud.nextlib.id',
            'api_secret' => 'test-secret-key-123',
        );

        $exporter = new AggregateExporter($this->db, $httpClient, $config, $this->queuePath);

        $result = $exporter->send('');

        $this->assertFalse($result);
    }

    public function testSendReturnsFalseWhenApiSecretIsEmpty(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->never())->method('post');

        $config = array(
            'tenant_id' => 'test-tenant',
            'cloud_base_url' => 'https://cloud.nextlib.id',
            'api_secret' => '',
        );

        $exporter = new AggregateExporter($this->db, $httpClient, $config, $this->queuePath);
        $compressed = gzencode('{"test":"data"}', 9);

        $result = $exporter->send($compressed);

        $this->assertFalse($result);
    }

    public function testSendReturnsFalseWhenApiSecretMissing(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->never())->method('post');

        $config = array(
            'tenant_id' => 'test-tenant',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $exporter = new AggregateExporter($this->db, $httpClient, $config, $this->queuePath);
        $compressed = gzencode('{"test":"data"}', 9);

        $result = $exporter->send($compressed);

        $this->assertFalse($result);
    }

    // =========================================================================
    // send() header verification
    // =========================================================================

    public function testSendPostsToCorrectEndpoint(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->once())
            ->method('post')
            ->with(
                $this->equalTo('/api/v1/aggregate'),
                $this->anything(),
                $this->anything()
            )
            ->willReturn(array('status' => 200, 'body' => '', 'error' => null));

        $config = array(
            'tenant_id' => 'test-tenant',
            'cloud_base_url' => 'https://cloud.nextlib.id',
            'api_secret' => 'test-secret-key-123',
        );

        $exporter = new AggregateExporter($this->db, $httpClient, $config, $this->queuePath);
        $compressed = gzencode('{"test":"data"}', 9);

        $exporter->send($compressed);
    }

    public function testSendIncludesGzipContentEncodingHeader(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->once())
            ->method('post')
            ->with(
                $this->anything(),
                $this->anything(),
                $this->callback(function (array $headers) {
                    return in_array('Content-Encoding: gzip', $headers, true);
                })
            )
            ->willReturn(array('status' => 200, 'body' => '', 'error' => null));

        $config = array(
            'tenant_id' => 'test-tenant',
            'cloud_base_url' => 'https://cloud.nextlib.id',
            'api_secret' => 'test-secret-key-123',
        );

        $exporter = new AggregateExporter($this->db, $httpClient, $config, $this->queuePath);
        $compressed = gzencode('{"test":"data"}', 9);

        $exporter->send($compressed);
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
            ->willReturn(array('status' => 200, 'body' => '', 'error' => null));

        $config = array(
            'tenant_id' => 'test-tenant',
            'cloud_base_url' => 'https://cloud.nextlib.id',
            'api_secret' => 'test-secret-key-123',
        );

        $exporter = new AggregateExporter($this->db, $httpClient, $config, $this->queuePath);
        $compressed = gzencode('{"test":"data"}', 9);

        $exporter->send($compressed);
    }

    public function testSendTokenIsValidHmacSignature(): void
    {
        $apiSecret = 'my-test-secret-key';
        $compressedPayload = gzencode('{"tenant_id":"test","stats":{}}', 9);
        $capturedHeaders = null;

        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->once())
            ->method('post')
            ->with(
                $this->anything(),
                $this->anything(),
                $this->callback(function (array $headers) use (&$capturedHeaders) {
                    $capturedHeaders = $headers;
                    return true;
                })
            )
            ->willReturn(array('status' => 200, 'body' => '', 'error' => null));

        $config = array(
            'tenant_id' => 'test-tenant',
            'cloud_base_url' => 'https://cloud.nextlib.id',
            'api_secret' => $apiSecret,
        );

        $exporter = new AggregateExporter($this->db, $httpClient, $config, $this->queuePath);
        $exporter->send($compressedPayload);

        // Extract token from captured headers
        $token = null;
        foreach ($capturedHeaders as $header) {
            if (strpos($header, 'X-NextLib-Token: ') === 0) {
                $token = substr($header, strlen('X-NextLib-Token: '));
                break;
            }
        }

        $this->assertNotNull($token, 'X-NextLib-Token header should be present');

        // Validate the token using HmacSigner
        $signer = new HmacSigner($apiSecret);
        $this->assertTrue(
            $signer->validateToken($token, $compressedPayload),
            'Token should be a valid HMAC-SHA256 signature of the compressed payload'
        );
    }

    public function testSendIncludesContentTypeHeader(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->once())
            ->method('post')
            ->with(
                $this->anything(),
                $this->anything(),
                $this->callback(function (array $headers) {
                    return in_array('Content-Type: application/octet-stream', $headers, true);
                })
            )
            ->willReturn(array('status' => 200, 'body' => '', 'error' => null));

        $config = array(
            'tenant_id' => 'test-tenant',
            'cloud_base_url' => 'https://cloud.nextlib.id',
            'api_secret' => 'test-secret-key-123',
        );

        $exporter = new AggregateExporter($this->db, $httpClient, $config, $this->queuePath);
        $compressed = gzencode('{"test":"data"}', 9);

        $exporter->send($compressed);
    }

    // =========================================================================
    // send() integration with export()
    // =========================================================================

    public function testExportReturnsTrueWhenSendSucceeds(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array('status' => 200, 'body' => '{"ok":true}', 'error' => null));

        $config = array(
            'tenant_id' => 'test-tenant',
            'cloud_base_url' => 'https://cloud.nextlib.id',
            'api_secret' => 'test-secret-key-123',
        );

        $exporter = new AggregateExporter($this->db, $httpClient, $config, $this->queuePath);
        $result = $exporter->export('2026-06-12');

        $this->assertTrue($result);
    }

    public function testExportQueuesForRetryWhenSendFails(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array('status' => 500, 'body' => 'error', 'error' => null));

        $config = array(
            'tenant_id' => 'test-tenant',
            'cloud_base_url' => 'https://cloud.nextlib.id',
            'api_secret' => 'test-secret-key-123',
        );

        $exporter = new AggregateExporter($this->db, $httpClient, $config, $this->queuePath);
        $result = $exporter->export('2026-06-12');

        $this->assertFalse($result);

        // Verify item was queued
        $queueFile = $this->queuePath . '/pending_exports.json';
        $this->assertFileExists($queueFile);
        $queue = json_decode(file_get_contents($queueFile), true);
        $this->assertCount(1, $queue);
    }

    public function testProcessPendingQueueSendsQueuedItems(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array('status' => 200, 'body' => '{"ok":true}', 'error' => null));

        $config = array(
            'tenant_id' => 'test-tenant',
            'cloud_base_url' => 'https://cloud.nextlib.id',
            'api_secret' => 'test-secret-key-123',
        );

        // Pre-populate queue with a pending item
        $queueFile = $this->queuePath . '/pending_exports.json';
        $queueData = array(
            array(
                'payload' => array(
                    'tenant_id' => 'test-tenant',
                    'date' => '2026-06-11',
                    'stats' => array('visitor_count' => 50, 'loan_count' => 20, 'return_count' => 15),
                    'sent_at' => '2026-06-11T23:59:00+07:00',
                ),
                'retry_count' => 0,
                'queued_at' => '2026-06-11T23:59:30+07:00',
            ),
        );
        file_put_contents($queueFile, json_encode($queueData));

        $exporter = new AggregateExporter($this->db, $httpClient, $config, $this->queuePath);
        $count = $exporter->processPendingQueue();

        $this->assertSame(1, $count);
    }
}
