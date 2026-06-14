<?php
/**
 * Unit tests for EnhancedExporter::export() and processRetryQueue()
 *
 * Tests the export orchestration flow (task 6.2):
 * - collectDailyMetrics → collectSnapshotMetrics → detectAnomalies
 *   → buildPayloadV2 → sanitize → compress → send v2 (if v2_enabled)
 *   → build v1 → sanitize → compress → send v1
 *   → on success: recordLastExport(), return true
 *   → on failure: enqueue to RetryScheduler, return false
 * - processRetryQueue(): processes due items, marks success/failed
 *
 * Uses in-memory SQLite with all required SLiMS tables so MetricsCollector
 * and AnomalyTagger can run their SQL without errors.
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\Exporter\EnhancedExporter;
use NextLibAgent\Exporter\MetricsCollector;
use NextLibAgent\Exporter\AnomalyTagger;
use NextLibAgent\Exporter\RetryScheduler;
use NextLibAgent\lib\HttpClient;
use PDO;

class EnhancedExporterExportTest extends TestCase
{
    /** @var PDO */
    private $db;

    /** @var string */
    private $tempDir;

    /** @var array */
    private $baseConfig;

    protected function setUp(): void
    {
        $this->db = new PDO('sqlite::memory:');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        // Create all SLiMS tables needed by MetricsCollector and AnomalyTagger
        $this->db->exec("CREATE TABLE visitor_count (
            id INTEGER PRIMARY KEY,
            member_id INTEGER,
            checkin_date DATETIME
        )");
        $this->db->exec("CREATE TABLE loan (
            loan_id INTEGER PRIMARY KEY,
            member_id INTEGER,
            loan_date DATE,
            return_date DATE,
            due_date DATE,
            is_lent INTEGER DEFAULT 1,
            is_return INTEGER DEFAULT 0
        )");
        $this->db->exec("CREATE TABLE member (
            member_id INTEGER PRIMARY KEY,
            register_date DATE,
            expire_date DATE
        )");
        $this->db->exec("CREATE TABLE biblio (
            biblio_id INTEGER PRIMARY KEY,
            input_date DATE
        )");
        $this->db->exec("CREATE TABLE item (
            item_id INTEGER PRIMARY KEY,
            input_date DATE
        )");
        $this->db->exec("CREATE TABLE fines (
            fines_id INTEGER PRIMARY KEY,
            fines_date DATE,
            debet INTEGER DEFAULT 0,
            credit INTEGER DEFAULT 0
        )");
        $this->db->exec("CREATE TABLE reserve (
            reserve_id INTEGER PRIMARY KEY,
            reserve_date DATE
        )");

        $this->tempDir = sys_get_temp_dir() . '/nextlib_ee_test_' . getmypid() . '_' . mt_rand();
        mkdir($this->tempDir, 0755, true);

        $this->baseConfig = array(
            'tenant_id'      => 'test-tenant-uuid',
            'cloud_base_url' => 'https://cloud.nextlib.test',
            'api_secret'     => 'test-secret-key-for-hmac',
            'v2_enabled'     => false,
            'export_schedule' => 'daily',
        );
    }

    protected function tearDown(): void
    {
        $files = glob($this->tempDir . '/*');
        if (is_array($files)) {
            foreach ($files as $file) {
                if (is_file($file)) {
                    unlink($file);
                }
            }
        }
        if (is_dir($this->tempDir)) {
            rmdir($this->tempDir);
        }
    }

    // =========================================================================
    // export() — v2_enabled = false (v1 only)
    // =========================================================================

    public function testExportReturnsTrueWhenV1SendSucceeds(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->once())
            ->method('post')
            ->with($this->equalTo('/api/v1/aggregate'), $this->anything(), $this->anything())
            ->willReturn(array('status' => 200, 'body' => '', 'error' => null));

        $exporter = $this->createExporter($httpClient, array('v2_enabled' => false));
        $result = $exporter->export('2026-06-12');

        $this->assertTrue($result);
    }

    public function testExportReturnsFalseWhenV1SendFails(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array('status' => 500, 'body' => '', 'error' => 'Server Error'));

        $exporter = $this->createExporter($httpClient, array('v2_enabled' => false));
        $result = $exporter->export('2026-06-12');

        $this->assertFalse($result);
    }

    public function testExportEnqueuesV1PayloadOnSendFailure(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array('status' => 500, 'body' => '', 'error' => 'Server Error'));

        $exporter = $this->createExporter($httpClient, array('v2_enabled' => false));
        $exporter->export('2026-06-12');

        $queueFile = $this->tempDir . '/pending_exports.json';
        $this->assertFileExists($queueFile);
        $queue = json_decode(file_get_contents($queueFile), true);
        $this->assertCount(1, $queue);
        // v1 payload should have 'stats' key
        $this->assertArrayHasKey('stats', $queue[0]['payload']);
    }

    public function testExportRecordsLastExportOnSuccess(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array('status' => 200, 'body' => '', 'error' => null));

        $exporter = $this->createExporter($httpClient, array('v2_enabled' => false));
        $result = $exporter->export('2026-06-12');

        $this->assertTrue($result);
        $lastExportFile = $this->tempDir . '/last_export.json';
        $this->assertFileExists($lastExportFile);
        $data = json_decode(file_get_contents($lastExportFile), true);
        $this->assertArrayHasKey('last_successful_export', $data);
    }

    // =========================================================================
    // export() — v2_enabled = true (v1 + v2)
    // =========================================================================

    public function testExportSendsBothV1AndV2WhenV2Enabled(): void
    {
        $calls = array();

        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturnCallback(function (string $endpoint, string $body, array $headers) use (&$calls) {
                $calls[] = $endpoint;
                return array('status' => 200, 'body' => '', 'error' => null);
            });

        $exporter = $this->createExporter($httpClient, array('v2_enabled' => true));
        $result = $exporter->export('2026-06-12');

        $this->assertTrue($result);
        $this->assertCount(2, $calls);
        $this->assertContains('/api/v2/aggregate', $calls);
        $this->assertContains('/api/v1/aggregate', $calls);
    }

    public function testExportReturnsFalseAndEnqueuesV2PayloadWhenV2SendFails(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturnCallback(function (string $endpoint) {
                if ($endpoint === '/api/v2/aggregate') {
                    return array('status' => 500, 'body' => '', 'error' => 'v2 server error');
                }
                return array('status' => 200, 'body' => '', 'error' => null);
            });

        $exporter = $this->createExporter($httpClient, array('v2_enabled' => true));
        $result = $exporter->export('2026-06-12');

        $this->assertFalse($result);

        $queueFile = $this->tempDir . '/pending_exports.json';
        $this->assertFileExists($queueFile);
        $queue = json_decode(file_get_contents($queueFile), true);
        $this->assertCount(1, $queue);
        // Should have enqueued v2 payload (has schema_version)
        $this->assertSame('v2', $queue[0]['payload_version']);
    }

    public function testExportDoesNotSendV1WhenV2FailsWithV2Enabled(): void
    {
        $v1Called = false;

        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturnCallback(function (string $endpoint) use (&$v1Called) {
                if ($endpoint === '/api/v1/aggregate') {
                    $v1Called = true;
                }
                return array('status' => 500, 'body' => '', 'error' => 'server error');
            });

        $exporter = $this->createExporter($httpClient, array('v2_enabled' => true));
        $exporter->export('2026-06-12');

        $this->assertFalse($v1Called, 'v1 should not be called when v2 fails (early exit)');
    }

    // =========================================================================
    // export() — payload content validation
    // =========================================================================

    public function testExportSendsGzipCompressedPayload(): void
    {
        $receivedBody = null;

        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturnCallback(function (string $endpoint, string $body) use (&$receivedBody) {
                $receivedBody = $body;
                return array('status' => 200, 'body' => '', 'error' => null);
            });

        $exporter = $this->createExporter($httpClient, array('v2_enabled' => false));
        $exporter->export('2026-06-12');

        $this->assertNotNull($receivedBody);
        // gzip magic bytes: 1f 8b
        $this->assertSame("\x1f\x8b", substr($receivedBody, 0, 2));
    }

    public function testExportSendsContentEncodingGzipHeader(): void
    {
        $receivedHeaders = null;

        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturnCallback(function (string $endpoint, string $body, array $headers) use (&$receivedHeaders) {
                $receivedHeaders = $headers;
                return array('status' => 200, 'body' => '', 'error' => null);
            });

        $exporter = $this->createExporter($httpClient, array('v2_enabled' => false));
        $exporter->export('2026-06-12');

        $this->assertNotNull($receivedHeaders);
        $this->assertContains('Content-Encoding: gzip', $receivedHeaders);
    }

    public function testExportDecompressedV1PayloadHasRequiredFields(): void
    {
        $receivedBody = null;

        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturnCallback(function (string $endpoint, string $body) use (&$receivedBody) {
                if ($endpoint === '/api/v1/aggregate') {
                    $receivedBody = $body;
                }
                return array('status' => 200, 'body' => '', 'error' => null);
            });

        $exporter = $this->createExporter($httpClient, array('v2_enabled' => false));
        $exporter->export('2026-06-12');

        $this->assertNotNull($receivedBody);
        $json = gzdecode($receivedBody);
        $this->assertNotFalse($json);
        $payload = json_decode($json, true);
        $this->assertArrayHasKey('tenant_id', $payload);
        $this->assertArrayHasKey('date', $payload);
        $this->assertArrayHasKey('stats', $payload);
        $this->assertArrayHasKey('sent_at', $payload);
        $this->assertArrayHasKey('visitor_count', $payload['stats']);
        $this->assertArrayHasKey('loan_count', $payload['stats']);
        $this->assertArrayHasKey('return_count', $payload['stats']);
    }

    public function testExportDecompressedV2PayloadHasRequiredFields(): void
    {
        $v2Body = null;

        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturnCallback(function (string $endpoint, string $body) use (&$v2Body) {
                if ($endpoint === '/api/v2/aggregate') {
                    $v2Body = $body;
                }
                return array('status' => 200, 'body' => '', 'error' => null);
            });

        $exporter = $this->createExporter($httpClient, array('v2_enabled' => true));
        $exporter->export('2026-06-12');

        $this->assertNotNull($v2Body);
        $json = gzdecode($v2Body);
        $this->assertNotFalse($json);
        $payload = json_decode($json, true);
        $this->assertSame('2.0', $payload['schema_version']);
        $this->assertArrayHasKey('daily_metrics', $payload);
        $this->assertArrayHasKey('snapshot_metrics', $payload);
        $this->assertArrayHasKey('anomaly_flags', $payload);
        $this->assertSame('2026-06-12', $payload['date']);
    }

    // =========================================================================
    // export() — date handling
    // =========================================================================

    public function testExportUsesTodayWhenDateIsNull(): void
    {
        $receivedBody = null;

        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturnCallback(function (string $endpoint, string $body) use (&$receivedBody) {
                $receivedBody = $body;
                return array('status' => 200, 'body' => '', 'error' => null);
            });

        $exporter = $this->createExporter($httpClient, array('v2_enabled' => false));
        $exporter->export(null);

        $this->assertNotNull($receivedBody);
        $json = gzdecode($receivedBody);
        $payload = json_decode($json, true);
        $this->assertSame(date('Y-m-d'), $payload['date']);
    }

    public function testExportUsesProvidedDate(): void
    {
        $receivedBody = null;

        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturnCallback(function (string $endpoint, string $body) use (&$receivedBody) {
                $receivedBody = $body;
                return array('status' => 200, 'body' => '', 'error' => null);
            });

        $exporter = $this->createExporter($httpClient, array('v2_enabled' => false));
        $exporter->export('2026-01-15');

        $json = gzdecode($receivedBody);
        $payload = json_decode($json, true);
        $this->assertSame('2026-01-15', $payload['date']);
    }

    // =========================================================================
    // processRetryQueue()
    // =========================================================================

    public function testProcessRetryQueueReturnsZeroWhenEmpty(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->never())->method('post');

        $exporter = $this->createExporter($httpClient);
        $result = $exporter->processRetryQueue();

        $this->assertSame(0, $result);
    }

    public function testProcessRetryQueueSendsDueV1ItemAndReturnsOne(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->once())
            ->method('post')
            ->with($this->equalTo('/api/v1/aggregate'))
            ->willReturn(array('status' => 200, 'body' => '', 'error' => null));

        // Pre-populate queue with a due v1 item (next_retry_at in the past)
        $this->writeQueueFile(array(
            array(
                'payload'         => array(
                    'tenant_id' => 'test-tenant-uuid',
                    'date'      => '2026-06-11',
                    'stats'     => array('visitor_count' => 10, 'loan_count' => 5, 'return_count' => 3),
                    'sent_at'   => date('c'),
                ),
                'attempt_count'   => 0,
                'next_retry_at'   => date('c', strtotime('-10 seconds')),
                'last_error'      => 'HTTP 500',
                'queued_at'       => date('c'),
                'payload_version' => 'v1',
            ),
        ));

        $exporter = $this->createExporter($httpClient);
        $result = $exporter->processRetryQueue();

        $this->assertSame(1, $result);
    }

    public function testProcessRetryQueueSendsDueV2ItemToV2Endpoint(): void
    {
        $calledEndpoint = null;

        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturnCallback(function (string $endpoint) use (&$calledEndpoint) {
                $calledEndpoint = $endpoint;
                return array('status' => 200, 'body' => '', 'error' => null);
            });

        $this->writeQueueFile(array(
            array(
                'payload'         => array(
                    'schema_version'   => '2.0',
                    'tenant_id'        => 'test-tenant-uuid',
                    'date'             => '2026-06-11',
                    'sent_at'          => date('c'),
                    'daily_metrics'    => array('visitor_count' => 0, 'unique_visitor_count' => 0,
                                                'loan_count' => 0, 'return_count' => 0,
                                                'new_member_count' => 0, 'new_biblio_count' => 0,
                                                'new_item_count' => 0, 'fines_debet_total' => 0,
                                                'fines_credit_total' => 0, 'reservation_count' => 0),
                    'snapshot_metrics' => array('total_collection_size' => 0,
                                                'active_member_count' => 0,
                                                'active_overdue_count' => 0),
                    'anomaly_flags'    => array(),
                ),
                'attempt_count'   => 1,
                'next_retry_at'   => date('c', strtotime('-5 seconds')),
                'last_error'      => 'HTTP 503',
                'queued_at'       => date('c'),
                'payload_version' => 'v2',
            ),
        ));

        $exporter = $this->createExporter($httpClient);
        $result = $exporter->processRetryQueue();

        $this->assertSame(1, $result);
        $this->assertSame('/api/v2/aggregate', $calledEndpoint);
    }

    public function testProcessRetryQueueRemovesItemOnSuccess(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array('status' => 200, 'body' => '', 'error' => null));

        $this->writeQueueFile(array(
            array(
                'payload'         => array('tenant_id' => 't', 'date' => '2026-06-01',
                                           'stats' => array('visitor_count' => 0, 'loan_count' => 0, 'return_count' => 0),
                                           'sent_at' => date('c')),
                'attempt_count'   => 0,
                'next_retry_at'   => date('c', strtotime('-10 seconds')),
                'last_error'      => 'HTTP 500',
                'queued_at'       => date('c'),
                'payload_version' => 'v1',
            ),
        ));

        $exporter = $this->createExporter($httpClient);
        $exporter->processRetryQueue();

        // Queue should be empty after success
        $queue = $this->readQueueFile();
        $this->assertCount(0, $queue);
    }

    public function testProcessRetryQueueIncrementsAttemptOnFailure(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturn(array('status' => 503, 'body' => '', 'error' => null));

        $this->writeQueueFile(array(
            array(
                'payload'         => array('tenant_id' => 't', 'date' => '2026-06-01',
                                           'stats' => array('visitor_count' => 0, 'loan_count' => 0, 'return_count' => 0),
                                           'sent_at' => date('c')),
                'attempt_count'   => 0,
                'next_retry_at'   => date('c', strtotime('-10 seconds')),
                'last_error'      => 'HTTP 500',
                'queued_at'       => date('c'),
                'payload_version' => 'v1',
            ),
        ));

        $exporter = $this->createExporter($httpClient);
        $result = $exporter->processRetryQueue();

        $this->assertSame(0, $result);
        $queue = $this->readQueueFile();
        $this->assertCount(1, $queue);
        $this->assertSame(1, $queue[0]['attempt_count']);
    }

    public function testProcessRetryQueueSkipsItemsNotYetDue(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->never())->method('post');

        $this->writeQueueFile(array(
            array(
                'payload'         => array('tenant_id' => 't', 'date' => '2026-06-01',
                                           'stats' => array('visitor_count' => 0, 'loan_count' => 0, 'return_count' => 0),
                                           'sent_at' => date('c')),
                'attempt_count'   => 0,
                'next_retry_at'   => date('c', strtotime('+1 hour')), // future
                'last_error'      => 'HTTP 500',
                'queued_at'       => date('c'),
                'payload_version' => 'v1',
            ),
        ));

        $exporter = $this->createExporter($httpClient);
        $result = $exporter->processRetryQueue();

        $this->assertSame(0, $result);
    }

    public function testProcessRetryQueueHandlesMultipleItemsMixed(): void
    {
        $callCount = 0;

        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')
            ->willReturnCallback(function () use (&$callCount) {
                $callCount++;
                // First call fails, second succeeds
                return $callCount === 1
                    ? array('status' => 503, 'body' => '', 'error' => null)
                    : array('status' => 200, 'body' => '', 'error' => null);
            });

        $this->writeQueueFile(array(
            array(
                'payload'         => array('tenant_id' => 't', 'date' => '2026-06-01',
                                           'stats' => array('visitor_count' => 1, 'loan_count' => 0, 'return_count' => 0),
                                           'sent_at' => date('c')),
                'attempt_count'   => 0,
                'next_retry_at'   => date('c', strtotime('-5 seconds')),
                'last_error'      => 'err',
                'queued_at'       => date('c'),
                'payload_version' => 'v1',
            ),
            array(
                'payload'         => array('tenant_id' => 't', 'date' => '2026-06-02',
                                           'stats' => array('visitor_count' => 2, 'loan_count' => 0, 'return_count' => 0),
                                           'sent_at' => date('c')),
                'attempt_count'   => 0,
                'next_retry_at'   => date('c', strtotime('-5 seconds')),
                'last_error'      => 'err',
                'queued_at'       => date('c'),
                'payload_version' => 'v1',
            ),
        ));

        $exporter = $this->createExporter($httpClient);
        $result = $exporter->processRetryQueue();

        // One success out of two
        $this->assertSame(1, $result);
    }

    // =========================================================================
    // Helper methods
    // =========================================================================

    private function createExporter(
        ?HttpClient $httpClient = null,
        array $configOverrides = array()
    ): EnhancedExporter {
        if ($httpClient === null) {
            $httpClient = $this->createMock(HttpClient::class);
        }

        $config = array_merge($this->baseConfig, $configOverrides);

        $collector      = new MetricsCollector($this->db);
        $anomalyTagger  = new AnomalyTagger($this->db, $collector);
        $retryScheduler = new RetryScheduler($this->tempDir);

        return new EnhancedExporter(
            $collector,
            $anomalyTagger,
            $retryScheduler,
            $httpClient,
            $config,
            $this->tempDir
        );
    }

    private function writeQueueFile(array $data): void
    {
        $path = $this->tempDir . '/pending_exports.json';
        file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT));
    }

    private function readQueueFile(): array
    {
        $path = $this->tempDir . '/pending_exports.json';
        if (!file_exists($path)) {
            return array();
        }
        $content = file_get_contents($path);
        $data = json_decode($content, true);
        return is_array($data) ? $data : array();
    }
}
