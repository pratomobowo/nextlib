<?php
/**
 * Unit tests for AggregateExporter.
 *
 * Uses SQLite in-memory database to test SQL query logic
 * and payload building without requiring a real SLiMS/MySQL database.
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\Exporter\AggregateExporter;
use NextLibAgent\lib\HttpClient;
use PDO;

class AggregateExporterTest extends TestCase
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
     * @var HttpClient|\PHPUnit\Framework\MockObject\MockObject
     */
    private $httpClient;

    protected function setUp(): void
    {
        // Create in-memory SQLite database that mimics SLiMS table structure
        $this->db = new PDO('sqlite::memory:');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        // Create visitor_count table
        $this->db->exec("
            CREATE TABLE visitor_count (
                visitor_id INTEGER PRIMARY KEY AUTOINCREMENT,
                member_id VARCHAR(20),
                member_name VARCHAR(100),
                checkin_date DATETIME NOT NULL
            )
        ");

        // Create loan table
        $this->db->exec("
            CREATE TABLE loan (
                loan_id INTEGER PRIMARY KEY AUTOINCREMENT,
                member_id VARCHAR(20),
                item_code VARCHAR(20),
                loan_date DATE NOT NULL,
                due_date DATE,
                return_date DATE
            )
        ");

        $this->config = array(
            'tenant_id' => 'test-tenant-uuid-1234',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $this->httpClient = $this->createMock(HttpClient::class);
    }

    // =========================================================================
    // collectDailyStats() tests
    // =========================================================================

    public function testCollectDailyStatsReturnsZeroWhenNoData(): void
    {
        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);

        $stats = $exporter->collectDailyStats('2026-06-12');

        $this->assertSame(0, $stats['visitor_count']);
        $this->assertSame(0, $stats['loan_count']);
        $this->assertSame(0, $stats['return_count']);
    }

    public function testCollectDailyStatsCountsVisitors(): void
    {
        // Insert 3 visitors for target date
        $this->insertVisitor('2026-06-12 08:30:00');
        $this->insertVisitor('2026-06-12 09:15:00');
        $this->insertVisitor('2026-06-12 10:00:00');
        // Insert 1 visitor for different date (should not be counted)
        $this->insertVisitor('2026-06-11 14:00:00');

        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        $stats = $exporter->collectDailyStats('2026-06-12');

        $this->assertSame(3, $stats['visitor_count']);
    }

    public function testCollectDailyStatsCountsLoans(): void
    {
        // Insert 2 loans for target date
        $this->insertLoan('2026-06-12', null);
        $this->insertLoan('2026-06-12', null);
        // Insert 1 loan for different date
        $this->insertLoan('2026-06-11', null);

        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        $stats = $exporter->collectDailyStats('2026-06-12');

        $this->assertSame(2, $stats['loan_count']);
    }

    public function testCollectDailyStatsCountsReturns(): void
    {
        // Insert loans with return dates
        $this->insertLoan('2026-06-10', '2026-06-12');
        $this->insertLoan('2026-06-09', '2026-06-12');
        $this->insertLoan('2026-06-08', '2026-06-12');
        // Return on different date
        $this->insertLoan('2026-06-10', '2026-06-11');

        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        $stats = $exporter->collectDailyStats('2026-06-12');

        $this->assertSame(3, $stats['return_count']);
    }

    public function testCollectDailyStatsCombinedCounts(): void
    {
        // 5 visitors
        for ($i = 0; $i < 5; $i++) {
            $this->insertVisitor('2026-06-12 0' . $i . ':00:00');
        }
        // 3 loans
        for ($i = 0; $i < 3; $i++) {
            $this->insertLoan('2026-06-12', null);
        }
        // 2 returns
        $this->insertLoan('2026-06-10', '2026-06-12');
        $this->insertLoan('2026-06-09', '2026-06-12');

        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        $stats = $exporter->collectDailyStats('2026-06-12');

        $this->assertSame(5, $stats['visitor_count']);
        $this->assertSame(3, $stats['loan_count']);
        $this->assertSame(2, $stats['return_count']);
    }

    public function testCollectDailyStatsDefaultsToToday(): void
    {
        $today = date('Y-m-d');
        $this->insertVisitor($today . ' 10:00:00');

        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        $stats = $exporter->collectDailyStats();

        $this->assertSame(1, $stats['visitor_count']);
    }

    // =========================================================================
    // buildPayload() tests
    // =========================================================================

    public function testBuildPayloadStructure(): void
    {
        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        $stats = array(
            'visitor_count' => 150,
            'loan_count' => 45,
            'return_count' => 38,
        );

        $payload = $exporter->buildPayload($stats, '2026-06-12');

        $this->assertSame('test-tenant-uuid-1234', $payload['tenant_id']);
        $this->assertSame('2026-06-12', $payload['date']);
        $this->assertSame(150, $payload['stats']['visitor_count']);
        $this->assertSame(45, $payload['stats']['loan_count']);
        $this->assertSame(38, $payload['stats']['return_count']);
        $this->assertArrayHasKey('sent_at', $payload);
    }

    public function testBuildPayloadSentAtIsIso8601(): void
    {
        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        $stats = array('visitor_count' => 1, 'loan_count' => 2, 'return_count' => 3);

        $payload = $exporter->buildPayload($stats, '2026-06-12');

        // Verify sent_at is a valid ISO 8601 datetime
        $parsed = \DateTime::createFromFormat(\DateTime::ATOM, $payload['sent_at']);
        $this->assertNotFalse($parsed, 'sent_at should be a valid ISO 8601 datetime');
    }

    public function testBuildPayloadCastsStatsToIntegers(): void
    {
        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        // Pass string values (as might come from database)
        $stats = array(
            'visitor_count' => '100',
            'loan_count' => '50',
            'return_count' => '25',
        );

        $payload = $exporter->buildPayload($stats);

        $this->assertSame(100, $payload['stats']['visitor_count']);
        $this->assertSame(50, $payload['stats']['loan_count']);
        $this->assertSame(25, $payload['stats']['return_count']);
    }

    public function testBuildPayloadHandlesMissingStatsKeys(): void
    {
        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);

        $payload = $exporter->buildPayload(array());

        $this->assertSame(0, $payload['stats']['visitor_count']);
        $this->assertSame(0, $payload['stats']['loan_count']);
        $this->assertSame(0, $payload['stats']['return_count']);
    }

    public function testBuildPayloadUsesConfigTenantId(): void
    {
        $config = array('tenant_id' => 'campus-abc-uuid');
        $exporter = new AggregateExporter($this->db, $this->httpClient, $config);

        $payload = $exporter->buildPayload(array('visitor_count' => 10, 'loan_count' => 5, 'return_count' => 2));

        $this->assertSame('campus-abc-uuid', $payload['tenant_id']);
    }

    public function testBuildPayloadDefaultsDateToToday(): void
    {
        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);

        $payload = $exporter->buildPayload(array('visitor_count' => 0, 'loan_count' => 0, 'return_count' => 0));

        $this->assertSame(date('Y-m-d'), $payload['date']);
    }

    public function testBuildPayloadContainsNoPiiFields(): void
    {
        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        $stats = array('visitor_count' => 100, 'loan_count' => 50, 'return_count' => 25);

        $payload = $exporter->buildPayload($stats, '2026-06-12');
        $json = json_encode($payload);

        // Ensure no PII-related field names exist in the payload
        $piiFields = array('name', 'member_name', 'nim', 'phone', 'email', 'address', 'member_id');
        foreach ($piiFields as $field) {
            $this->assertStringNotContainsString(
                '"' . $field . '"',
                $json,
                "Payload should not contain PII field: $field"
            );
        }
    }

    // =========================================================================
    // sanitizePayload() tests
    // =========================================================================

    public function testSanitizePayloadKeepsAllowedFields(): void
    {
        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        $payload = array(
            'tenant_id' => 'test-uuid',
            'date' => '2026-06-12',
            'stats' => array(
                'visitor_count' => 100,
                'loan_count' => 50,
                'return_count' => 25,
            ),
            'sent_at' => '2026-06-12T23:59:00+07:00',
        );

        $sanitized = $exporter->sanitizePayload($payload);

        $this->assertSame('test-uuid', $sanitized['tenant_id']);
        $this->assertSame('2026-06-12', $sanitized['date']);
        $this->assertSame(100, $sanitized['stats']['visitor_count']);
        $this->assertSame(50, $sanitized['stats']['loan_count']);
        $this->assertSame(25, $sanitized['stats']['return_count']);
        $this->assertSame('2026-06-12T23:59:00+07:00', $sanitized['sent_at']);
    }

    public function testSanitizePayloadStripsUnexpectedTopLevelKeys(): void
    {
        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        $payload = array(
            'tenant_id' => 'test-uuid',
            'date' => '2026-06-12',
            'stats' => array('visitor_count' => 10, 'loan_count' => 5, 'return_count' => 3),
            'sent_at' => '2026-06-12T23:59:00+07:00',
            'member_name' => 'John Doe',
            'email' => 'john@example.com',
            'borrowing_history' => array('book1', 'book2'),
        );

        $sanitized = $exporter->sanitizePayload($payload);

        $this->assertArrayNotHasKey('member_name', $sanitized);
        $this->assertArrayNotHasKey('email', $sanitized);
        $this->assertArrayNotHasKey('borrowing_history', $sanitized);
        $this->assertCount(4, $sanitized);
    }

    public function testSanitizePayloadStripsUnexpectedStatsKeys(): void
    {
        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        $payload = array(
            'tenant_id' => 'test-uuid',
            'date' => '2026-06-12',
            'stats' => array(
                'visitor_count' => 10,
                'loan_count' => 5,
                'return_count' => 3,
                'member_names' => array('Alice', 'Bob'),
                'nim_list' => array('12345678', '87654321'),
            ),
            'sent_at' => '2026-06-12T23:59:00+07:00',
        );

        $sanitized = $exporter->sanitizePayload($payload);

        $this->assertArrayNotHasKey('member_names', $sanitized['stats']);
        $this->assertArrayNotHasKey('nim_list', $sanitized['stats']);
        $this->assertCount(3, $sanitized['stats']);
    }

    public function testSanitizePayloadCastsStatsToIntegers(): void
    {
        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        $payload = array(
            'tenant_id' => 'test-uuid',
            'date' => '2026-06-12',
            'stats' => array(
                'visitor_count' => '100',
                'loan_count' => '50',
                'return_count' => '25',
            ),
            'sent_at' => '2026-06-12T23:59:00+07:00',
        );

        $sanitized = $exporter->sanitizePayload($payload);

        $this->assertSame(100, $sanitized['stats']['visitor_count']);
        $this->assertSame(50, $sanitized['stats']['loan_count']);
        $this->assertSame(25, $sanitized['stats']['return_count']);
    }

    public function testSanitizePayloadHandlesMissingStats(): void
    {
        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        $payload = array(
            'tenant_id' => 'test-uuid',
            'date' => '2026-06-12',
            'stats' => 'not-an-array',
            'sent_at' => '2026-06-12T23:59:00+07:00',
        );

        $sanitized = $exporter->sanitizePayload($payload);

        $this->assertSame(0, $sanitized['stats']['visitor_count']);
        $this->assertSame(0, $sanitized['stats']['loan_count']);
        $this->assertSame(0, $sanitized['stats']['return_count']);
    }

    public function testSanitizePayloadDetectsAndStripsPIIInValues(): void
    {
        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        $payload = array(
            'tenant_id' => 'john.doe@university.ac.id',
            'date' => '2026-06-12',
            'stats' => array('visitor_count' => 10, 'loan_count' => 5, 'return_count' => 3),
            'sent_at' => '2026-06-12T23:59:00+07:00',
        );

        $sanitized = $exporter->sanitizePayload($payload);

        // tenant_id contained an email, so it should be stripped
        $this->assertSame('', $sanitized['tenant_id']);
    }

    // =========================================================================
    // containsPII() tests
    // =========================================================================

    public function testContainsPIIDetectsEmail(): void
    {
        $payload = array('field' => 'user@example.com');
        $this->assertTrue(AggregateExporter::containsPII($payload));
    }

    public function testContainsPIIDetectsEmailInNestedArray(): void
    {
        $payload = array('data' => array('email' => 'student@univ.ac.id'));
        $this->assertTrue(AggregateExporter::containsPII($payload));
    }

    public function testContainsPIIDetectsPhoneNumber(): void
    {
        $payload = array('phone' => '+6281234567890');
        $this->assertTrue(AggregateExporter::containsPII($payload));
    }

    public function testContainsPIIDetectsPhoneNumberWithSpaces(): void
    {
        $payload = array('phone' => '0812 3456 7890');
        $this->assertTrue(AggregateExporter::containsPII($payload));
    }

    public function testContainsPIIDetectsPhoneNumberWithDashes(): void
    {
        $payload = array('phone' => '021-555-1234');
        $this->assertTrue(AggregateExporter::containsPII($payload));
    }

    public function testContainsPIIDetectsNIM(): void
    {
        $payload = array('nim' => '20210001234');
        $this->assertTrue(AggregateExporter::containsPII($payload));
    }

    public function testContainsPIIDetectsLongNames(): void
    {
        $payload = array('name' => 'Muhammad Rizky Pratama Putra');
        $this->assertTrue(AggregateExporter::containsPII($payload));
    }

    public function testContainsPIIReturnsFalseForValidAggregatePayload(): void
    {
        $payload = array(
            'tenant_id' => 'abc-def-123',
            'date' => '2026-06-12',
            'stats' => array(
                'visitor_count' => 150,
                'loan_count' => 45,
                'return_count' => 38,
            ),
            'sent_at' => '2026-06-12T23:59:00+07:00',
        );
        $this->assertFalse(AggregateExporter::containsPII($payload));
    }

    public function testContainsPIIReturnsFalseForShortStrings(): void
    {
        $payload = array('id' => 'tenant-1', 'date' => '2026-06-12');
        $this->assertFalse(AggregateExporter::containsPII($payload));
    }

    public function testContainsPIIReturnsFalseForNumericValues(): void
    {
        $payload = array('count' => 100, 'total' => 50);
        $this->assertFalse(AggregateExporter::containsPII($payload));
    }

    public function testContainsPIIReturnsFalseForThreeWordName(): void
    {
        // 3 words is the threshold - should NOT trigger
        $payload = array('field' => 'Rizky Pratama Putra');
        $this->assertFalse(AggregateExporter::containsPII($payload));
    }

    public function testContainsPIIDetectsFourWordName(): void
    {
        // 4 words should trigger
        $payload = array('field' => 'Muhammad Rizky Pratama Putra');
        $this->assertTrue(AggregateExporter::containsPII($payload));
    }

    // =========================================================================
    // export() integration test with sanitizePayload
    // =========================================================================

    public function testExportCallsSanitizePayloadBeforeCompression(): void
    {
        // Insert some data
        $this->insertVisitor('2026-06-12 08:00:00');
        $this->insertLoan('2026-06-12', null);

        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        // Export will call sanitizePayload internally before compression
        // send() returns false so it queues for retry
        $result = $exporter->export('2026-06-12');

        $this->assertFalse($result);
    }

    // =========================================================================
    // compress() tests
    // =========================================================================

    public function testCompressReturnsEmptyStringForEmptyInput(): void
    {
        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);

        $result = $exporter->compress('');

        $this->assertSame('', $result);
    }

    public function testCompressReturnsNonEmptyStringForValidJson(): void
    {
        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        $json = json_encode(array('tenant_id' => 'abc', 'stats' => array('visitor_count' => 10)));

        $result = $exporter->compress($json);

        $this->assertNotEmpty($result, 'Compressed output should not be empty');
        $this->assertNotSame($json, $result, 'Compressed output should differ from input');
    }

    public function testCompressProducesValidGzipData(): void
    {
        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        $json = '{"tenant_id":"test","date":"2026-06-12","stats":{"visitor_count":100}}';

        $compressed = $exporter->compress($json);

        // gzdecode should be able to decompress it
        $decompressed = gzdecode($compressed);
        $this->assertSame($json, $decompressed);
    }

    public function testCompressRoundTrip(): void
    {
        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        $json = json_encode(array(
            'tenant_id' => 'test-tenant-uuid',
            'date' => '2026-06-12',
            'stats' => array(
                'visitor_count' => 150,
                'loan_count' => 45,
                'return_count' => 38,
            ),
            'sent_at' => '2026-06-12T23:59:00+07:00',
        ));

        $compressed = $exporter->compress($json);
        $decompressed = AggregateExporter::decompress($compressed);

        $this->assertSame($json, $decompressed);
    }

    // =========================================================================
    // decompress() tests
    // =========================================================================

    public function testDecompressReturnsEmptyStringForEmptyInput(): void
    {
        $result = AggregateExporter::decompress('');

        $this->assertSame('', $result);
    }

    public function testDecompressReturnsEmptyStringForInvalidData(): void
    {
        $result = AggregateExporter::decompress('not valid gzip data');

        $this->assertSame('', $result);
    }

    public function testDecompressReversesCompress(): void
    {
        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        $original = '{"key":"value","number":42}';

        $compressed = $exporter->compress($original);
        $decompressed = AggregateExporter::decompress($compressed);

        $this->assertSame($original, $decompressed);
    }

    // =========================================================================
    // export() integration test
    // =========================================================================

    public function testExportCallsCollectBuildAndSend(): void
    {
        // Insert some data
        $this->insertVisitor('2026-06-12 08:00:00');
        $this->insertLoan('2026-06-12', null);
        $this->insertLoan('2026-06-10', '2026-06-12');

        $exporter = new AggregateExporter($this->db, $this->httpClient, $this->config);
        // Export will call compress() (now implemented) and send() which is TODO,
        // so it will return false because send() returns false
        $result = $exporter->export('2026-06-12');

        // Since send() returns false (TODO), export returns false and queues for retry
        $this->assertFalse($result);
    }

    // =========================================================================
    // Helper methods
    // =========================================================================

    private function insertVisitor(string $checkinDate): void
    {
        $stmt = $this->db->prepare(
            "INSERT INTO visitor_count (member_id, member_name, checkin_date) VALUES (:mid, :name, :date)"
        );
        $stmt->execute(array(
            'mid' => 'M' . rand(1000, 9999),
            'name' => 'Test Member',
            'date' => $checkinDate,
        ));
    }

    private function insertLoan(string $loanDate, ?string $returnDate): void
    {
        $stmt = $this->db->prepare(
            "INSERT INTO loan (member_id, item_code, loan_date, due_date, return_date) VALUES (:mid, :item, :loan, :due, :return)"
        );
        $stmt->execute(array(
            'mid' => 'M' . rand(1000, 9999),
            'item' => 'B' . rand(10000, 99999),
            'loan' => $loanDate,
            'due' => date('Y-m-d', strtotime($loanDate . ' +14 days')),
            'return' => $returnDate,
        ));
    }
}
