<?php
/**
 * Unit tests for the local file queue retry mechanism
 * in AggregateExporter (queueForRetry and processPendingQueue).
 *
 * Uses a temporary directory for the queue file to avoid
 * interfering with the actual queue directory.
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\Exporter\AggregateExporter;
use NextLibAgent\lib\HttpClient;
use PDO;

class QueueRetryTest extends TestCase
{
    /**
     * @var PDO In-memory SQLite database
     */
    private $db;

    /**
     * @var array Test configuration
     */
    private $config;

    /**
     * @var string Temporary directory for queue files
     */
    private $tempDir;

    protected function setUp(): void
    {
        $this->db = new PDO('sqlite::memory:');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        // Create minimal tables for the exporter
        $this->db->exec("CREATE TABLE visitor_count (visitor_id INTEGER PRIMARY KEY, checkin_date DATETIME)");
        $this->db->exec("CREATE TABLE loan (loan_id INTEGER PRIMARY KEY, loan_date DATE, return_date DATE)");

        $this->config = array(
            'tenant_id' => 'test-tenant-uuid',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $this->tempDir = sys_get_temp_dir() . '/nextlib_queue_test_' . getmypid() . '_' . mt_rand();
        mkdir($this->tempDir, 0755, true);
    }

    protected function tearDown(): void
    {
        // Clean up temp directory
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
    // queueForRetry() tests
    // =========================================================================

    public function testQueueForRetryCreatesFileWhenNotExists(): void
    {
        $exporter = $this->createExporter();
        $payload = $this->makeSamplePayload();

        $result = $exporter->queueForRetry($payload);

        $this->assertTrue($result);
        $this->assertFileExists($this->tempDir . '/pending_exports.json');
    }

    public function testQueueForRetryAddsPayloadWithMetadata(): void
    {
        $exporter = $this->createExporter();
        $payload = $this->makeSamplePayload();

        $exporter->queueForRetry($payload);

        $queue = $this->readQueueFile();
        $this->assertCount(1, $queue);
        $this->assertSame($payload, $queue[0]['payload']);
        $this->assertSame(0, $queue[0]['retry_count']);
        $this->assertArrayHasKey('queued_at', $queue[0]);
    }

    public function testQueueForRetryQueuedAtIsIso8601(): void
    {
        $exporter = $this->createExporter();
        $payload = $this->makeSamplePayload();

        $exporter->queueForRetry($payload);

        $queue = $this->readQueueFile();
        $parsed = \DateTime::createFromFormat(\DateTime::ATOM, $queue[0]['queued_at']);
        $this->assertNotFalse($parsed, 'queued_at should be ISO 8601');
    }

    public function testQueueForRetryAppendsToExistingQueue(): void
    {
        $exporter = $this->createExporter();

        $payload1 = $this->makeSamplePayload('2026-06-10');
        $payload2 = $this->makeSamplePayload('2026-06-11');

        $exporter->queueForRetry($payload1);
        $exporter->queueForRetry($payload2);

        $queue = $this->readQueueFile();
        $this->assertCount(2, $queue);
        $this->assertSame('2026-06-10', $queue[0]['payload']['date']);
        $this->assertSame('2026-06-11', $queue[1]['payload']['date']);
    }

    public function testQueueForRetryEnforcesMaxQueueSize(): void
    {
        $exporter = $this->createExporter();

        // Fill queue to max (100 items)
        for ($i = 0; $i < 100; $i++) {
            $exporter->queueForRetry($this->makeSamplePayload('2026-01-' . sprintf('%02d', ($i % 28) + 1)));
        }

        $queue = $this->readQueueFile();
        $this->assertCount(100, $queue);

        // Add one more - should drop the oldest
        $exporter->queueForRetry($this->makeSamplePayload('2099-12-31'));

        $queue = $this->readQueueFile();
        $this->assertCount(100, $queue);

        // The newest item should be at the end
        $lastItem = end($queue);
        $this->assertSame('2099-12-31', $lastItem['payload']['date']);
    }

    public function testQueueForRetryDropsOldestWhenExceedingMax(): void
    {
        $exporter = $this->createExporter();

        // Add 101 items
        for ($i = 1; $i <= 101; $i++) {
            $exporter->queueForRetry(array('index' => $i));
        }

        $queue = $this->readQueueFile();
        $this->assertCount(100, $queue);

        // First item should be index 2 (index 1 was dropped)
        $this->assertSame(2, $queue[0]['payload']['index']);
        // Last item should be index 101
        $this->assertSame(101, $queue[99]['payload']['index']);
    }

    public function testQueueForRetryAtomicWrite(): void
    {
        $exporter = $this->createExporter();
        $payload = $this->makeSamplePayload();

        $result = $exporter->queueForRetry($payload);

        $this->assertTrue($result);
        // Verify no temp files remain
        $tempFiles = glob($this->tempDir . '/*.tmp.*');
        $this->assertEmpty($tempFiles);
    }

    public function testQueueForRetryHandlesCorruptedFile(): void
    {
        // Write invalid JSON to queue file
        file_put_contents($this->tempDir . '/pending_exports.json', 'not valid json{{{');

        $exporter = $this->createExporter();
        $payload = $this->makeSamplePayload();

        $result = $exporter->queueForRetry($payload);

        $this->assertTrue($result);
        $queue = $this->readQueueFile();
        $this->assertCount(1, $queue);
        $this->assertSame($payload, $queue[0]['payload']);
    }

    public function testQueueForRetryHandlesEmptyFile(): void
    {
        file_put_contents($this->tempDir . '/pending_exports.json', '');

        $exporter = $this->createExporter();
        $payload = $this->makeSamplePayload();

        $result = $exporter->queueForRetry($payload);

        $this->assertTrue($result);
        $queue = $this->readQueueFile();
        $this->assertCount(1, $queue);
    }

    // =========================================================================
    // processPendingQueue() tests
    // =========================================================================

    public function testProcessPendingQueueReturnsZeroWhenEmpty(): void
    {
        $exporter = $this->createExporter();

        $result = $exporter->processPendingQueue();

        $this->assertSame(0, $result);
    }

    public function testProcessPendingQueueReturnsZeroWhenNoFile(): void
    {
        $exporter = $this->createExporter();
        // No queue file exists

        $result = $exporter->processPendingQueue();

        $this->assertSame(0, $result);
    }

    public function testProcessPendingQueueRemovesSuccessfullySentItems(): void
    {
        // Create exporter with mock that succeeds on send
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->method('post')->willReturn(array('status' => 200, 'body' => '', 'error' => null));

        $exporter = $this->createExporterWithSendBehavior(true);

        // Queue 2 items
        $exporter->queueForRetry($this->makeSamplePayload('2026-06-10'));
        $exporter->queueForRetry($this->makeSamplePayload('2026-06-11'));

        $result = $exporter->processPendingQueue();

        $this->assertSame(2, $result);
        // Queue should be empty after successful sends
        $queue = $this->readQueueFile();
        $this->assertCount(0, $queue);
    }

    public function testProcessPendingQueueIncrementsRetryCountOnFailure(): void
    {
        $exporter = $this->createExporter(); // send() returns false by default

        // Queue an item
        $exporter->queueForRetry($this->makeSamplePayload());

        $exporter->processPendingQueue();

        $queue = $this->readQueueFile();
        $this->assertCount(1, $queue);
        $this->assertSame(1, $queue[0]['retry_count']);
    }

    public function testProcessPendingQueueRemovesItemsExceedingMaxRetries(): void
    {
        $exporter = $this->createExporter(); // send() returns false

        // Manually write an item at retry_count = 2 (next failure will be 3 = MAX)
        $this->writeQueueFile(array(
            array(
                'payload' => $this->makeSamplePayload(),
                'retry_count' => 2,
                'queued_at' => date('c'),
            ),
        ));

        $exporter->processPendingQueue();

        // Item should be discarded (retry_count would become 3 which equals MAX_RETRIES)
        $queue = $this->readQueueFile();
        $this->assertCount(0, $queue);
    }

    public function testProcessPendingQueueKeepsItemsBelowMaxRetries(): void
    {
        $exporter = $this->createExporter(); // send() returns false

        // Write an item at retry_count = 1 (next failure = 2, still below max of 3)
        $this->writeQueueFile(array(
            array(
                'payload' => $this->makeSamplePayload(),
                'retry_count' => 1,
                'queued_at' => date('c'),
            ),
        ));

        $exporter->processPendingQueue();

        $queue = $this->readQueueFile();
        $this->assertCount(1, $queue);
        $this->assertSame(2, $queue[0]['retry_count']);
    }

    public function testProcessPendingQueueMixedResults(): void
    {
        // Create exporter that succeeds on first call, fails on second
        $exporter = $this->createExporterWithAlternatingBehavior();

        // Queue 3 items
        $this->writeQueueFile(array(
            array('payload' => $this->makeSamplePayload('2026-06-01'), 'retry_count' => 0, 'queued_at' => date('c')),
            array('payload' => $this->makeSamplePayload('2026-06-02'), 'retry_count' => 0, 'queued_at' => date('c')),
            array('payload' => $this->makeSamplePayload('2026-06-03'), 'retry_count' => 0, 'queued_at' => date('c')),
        ));

        $result = $exporter->processPendingQueue();

        // Items at index 0,2 succeed; item at index 1 fails
        $this->assertSame(2, $result);
        $queue = $this->readQueueFile();
        $this->assertCount(1, $queue);
        $this->assertSame('2026-06-02', $queue[0]['payload']['date']);
        $this->assertSame(1, $queue[0]['retry_count']);
    }

    public function testProcessPendingQueuePreservesQueuedAtTimestamp(): void
    {
        $exporter = $this->createExporter(); // send() returns false

        $originalTime = '2026-06-10T10:00:00+07:00';
        $this->writeQueueFile(array(
            array(
                'payload' => $this->makeSamplePayload(),
                'retry_count' => 0,
                'queued_at' => $originalTime,
            ),
        ));

        $exporter->processPendingQueue();

        $queue = $this->readQueueFile();
        $this->assertSame($originalTime, $queue[0]['queued_at']);
    }

    // =========================================================================
    // Integration: export() triggers queueForRetry on failure
    // =========================================================================

    public function testExportQueuesPayloadOnSendFailure(): void
    {
        $exporter = $this->createExporter(); // send() returns false

        $exporter->export('2026-06-12');

        $queue = $this->readQueueFile();
        $this->assertCount(1, $queue);
        $this->assertSame('test-tenant-uuid', $queue[0]['payload']['tenant_id']);
        $this->assertArrayHasKey('stats', $queue[0]['payload']);
        $this->assertArrayHasKey('date', $queue[0]['payload']);
    }

    // =========================================================================
    // Helper methods
    // =========================================================================

    private function createExporter(): AggregateExporter
    {
        $httpClient = $this->createMock(HttpClient::class);
        return new AggregateExporter($this->db, $httpClient, $this->config, $this->tempDir);
    }

    /**
     * Creates an exporter with a controlled send() behavior using a subclass.
     */
    private function createExporterWithSendBehavior(bool $sendResult): AggregateExporter
    {
        $httpClient = $this->createMock(HttpClient::class);
        $exporter = new class($this->db, $httpClient, $this->config, $this->tempDir, $sendResult) extends AggregateExporter {
            private $sendResult;

            public function __construct(PDO $db, HttpClient $httpClient, array $config, string $queuePath, bool $sendResult)
            {
                parent::__construct($db, $httpClient, $config, $queuePath);
                $this->sendResult = $sendResult;
            }

            public function send(string $compressedPayload): bool
            {
                return $this->sendResult;
            }
        };

        return $exporter;
    }

    /**
     * Creates an exporter that alternates: send succeeds on odd calls, fails on even calls.
     */
    private function createExporterWithAlternatingBehavior(): AggregateExporter
    {
        $httpClient = $this->createMock(HttpClient::class);
        $exporter = new class($this->db, $httpClient, $this->config, $this->tempDir) extends AggregateExporter {
            private $callCount = 0;

            public function send(string $compressedPayload): bool
            {
                $this->callCount++;
                // Succeed on odd calls (1st, 3rd), fail on even (2nd)
                return ($this->callCount % 2) !== 0;
            }
        };

        return $exporter;
    }

    private function makeSamplePayload(string $date = '2026-06-12'): array
    {
        return array(
            'tenant_id' => 'test-tenant-uuid',
            'date' => $date,
            'stats' => array(
                'visitor_count' => 150,
                'loan_count' => 45,
                'return_count' => 38,
            ),
            'sent_at' => date('c'),
        );
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

    private function writeQueueFile(array $data): void
    {
        $path = $this->tempDir . '/pending_exports.json';
        file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT));
    }
}
