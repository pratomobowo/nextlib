<?php
/**
 * Property-based tests for Gzip Compression Round-Trip.
 *
 * **Validates: Requirements 4.3**
 *
 * **Property 5: Gzip Compression Round-Trip**
 * For all valid JSON payloads: decompress(compress(payload)) == payload
 *
 * Since PHP lacks a native property-based testing library, these tests
 * simulate PBT by generating many random inputs across diverse categories
 * and verifying the round-trip property holds for all of them.
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\Exporter\AggregateExporter;
use NextLibAgent\lib\HttpClient;
use PDO;

class GzipPropertyTest extends TestCase
{
    /**
     * @var AggregateExporter
     */
    private $exporter;

    /**
     * @var PDO In-memory SQLite database (required by AggregateExporter constructor)
     */
    private $db;

    protected function setUp(): void
    {
        $this->db = new PDO('sqlite::memory:');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        // Create minimal tables required by AggregateExporter
        $this->db->exec("CREATE TABLE visitor_count (visitor_id INTEGER PRIMARY KEY, checkin_date DATETIME)");
        $this->db->exec("CREATE TABLE loan (loan_id INTEGER PRIMARY KEY, loan_date DATE, return_date DATE)");

        $httpClient = $this->createMock(HttpClient::class);
        $config = array(
            'tenant_id' => 'test-tenant-gzip-property',
            'cloud_base_url' => 'https://cloud.nextlib.id',
        );

        $this->exporter = new AggregateExporter($this->db, $httpClient, $config);
    }

    // =========================================================================
    // Property 5: Gzip Compression Round-Trip
    // For all valid JSON strings: compress(json) → decompress(result) == json
    // **Validates: Requirements 4.3**
    // =========================================================================

    /**
     * Property: compress → decompress == original for random JSON objects.
     *
     * Generates 100 random JSON object payloads with varying keys and values,
     * and verifies the gzip round-trip property holds for each.
     */
    public function testGzipRoundTripWithRandomJsonObjects(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $payload = $this->generateRandomJsonObject();
            $json = json_encode($payload);

            $compressed = $this->exporter->compress($json);
            $decompressed = AggregateExporter::decompress($compressed);

            $this->assertSame(
                $json,
                $decompressed,
                "Gzip round-trip failed for iteration $i with payload: " . substr($json, 0, 200)
            );
        }
    }

    /**
     * Property: compress → decompress == original for random JSON arrays.
     *
     * Generates 100 random JSON array payloads of varying lengths and content.
     */
    public function testGzipRoundTripWithRandomJsonArrays(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $array = array();
            $length = random_int(0, 20);
            for ($j = 0; $j < $length; $j++) {
                $array[] = $this->generateRandomValue();
            }
            $json = json_encode($array);

            $compressed = $this->exporter->compress($json);
            $decompressed = AggregateExporter::decompress($compressed);

            $this->assertSame(
                $json,
                $decompressed,
                "Gzip round-trip failed for array iteration $i"
            );
        }
    }

    /**
     * Property: compress → decompress == original for varying payload sizes.
     *
     * Tests with payloads ranging from very small to large (up to ~50KB).
     */
    public function testGzipRoundTripWithVaryingSizes(): void
    {
        $sizes = array(1, 10, 50, 100, 500, 1000, 5000, 10000, 50000);

        foreach ($sizes as $size) {
            $data = array('data' => str_repeat('x', $size));
            $json = json_encode($data);

            $compressed = $this->exporter->compress($json);
            $decompressed = AggregateExporter::decompress($compressed);

            $this->assertSame(
                $json,
                $decompressed,
                "Gzip round-trip failed for payload size $size"
            );
        }
    }

    /**
     * Property: compress → decompress == original for unicode content.
     *
     * Tests with various unicode characters including CJK, Arabic, emoji, etc.
     */
    public function testGzipRoundTripWithUnicodePayloads(): void
    {
        $unicodeStrings = array(
            'Perpustakaan Universitas',
            'データベース接続',
            'مكتبة الجامعة',
            'Üniversite Kütüphanesi',
            'Bibliothèque universitaire',
            '도서관 시스템',
            '图书馆管理系统',
            'Система библиотеки',
            'Thư viện đại học',
            '🏫📚🎓',
        );

        for ($i = 0; $i < 100; $i++) {
            $payload = array(
                'tenant_id' => 'tenant-' . $i,
                'description' => $unicodeStrings[array_rand($unicodeStrings)],
                'notes' => $unicodeStrings[array_rand($unicodeStrings)] . ' ' . $unicodeStrings[array_rand($unicodeStrings)],
                'count' => random_int(0, 9999),
            );
            $json = json_encode($payload, JSON_UNESCAPED_UNICODE);

            $compressed = $this->exporter->compress($json);
            $decompressed = AggregateExporter::decompress($compressed);

            $this->assertSame(
                $json,
                $decompressed,
                "Gzip round-trip failed for unicode iteration $i"
            );
        }
    }

    /**
     * Property: compress → decompress == original for deeply nested structures.
     *
     * Tests with nested JSON up to 10 levels deep.
     */
    public function testGzipRoundTripWithNestedStructures(): void
    {
        for ($i = 0; $i < 50; $i++) {
            $depth = random_int(1, 10);
            $payload = $this->generateNestedPayload($depth);
            $json = json_encode($payload);

            $compressed = $this->exporter->compress($json);
            $decompressed = AggregateExporter::decompress($compressed);

            $this->assertSame(
                $json,
                $decompressed,
                "Gzip round-trip failed for nested structure depth $depth at iteration $i"
            );
        }
    }

    /**
     * Property: compress('') → '' and decompress('') → ''.
     *
     * Empty string edge case is handled consistently.
     */
    public function testGzipRoundTripWithEmptyString(): void
    {
        $compressed = $this->exporter->compress('');
        $this->assertSame('', $compressed, "compress('') should return ''");

        $decompressed = AggregateExporter::decompress('');
        $this->assertSame('', $decompressed, "decompress('') should return ''");
    }

    /**
     * Property: compress → decompress == original for the actual payload format
     * used by AggregateExporter's buildPayload() method.
     *
     * Tests with 100 randomly-generated payloads using the real buildPayload() method.
     */
    public function testGzipRoundTripWithBuildPayloadFormat(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $stats = array(
                'visitor_count' => random_int(0, 10000),
                'loan_count' => random_int(0, 5000),
                'return_count' => random_int(0, 5000),
            );

            $year = random_int(2020, 2030);
            $month = str_pad((string) random_int(1, 12), 2, '0', STR_PAD_LEFT);
            $day = str_pad((string) random_int(1, 28), 2, '0', STR_PAD_LEFT);
            $date = "$year-$month-$day";

            $payload = $this->exporter->buildPayload($stats, $date);
            $json = json_encode($payload);

            $compressed = $this->exporter->compress($json);
            $decompressed = AggregateExporter::decompress($compressed);

            $this->assertSame(
                $json,
                $decompressed,
                "Gzip round-trip failed for buildPayload format at iteration $i"
            );
        }
    }

    // =========================================================================
    // Property 4: Gzip Compression Round-Trip (EnhancedExporter)
    // For all valid JSON string payloads: decompress(compress(payload)) == payload
    // ** Feature: enhanced-agent-exporter, Property 4: Gzip Compression Round-Trip **
    // **Validates: Requirements 3.4**
    // =========================================================================

    /**
     * Property 4: compress → decompress == original for random JSON string payloads.
     *
     * Uses EnhancedExporter::compress() (instance method) and
     * EnhancedExporter::decompress() (static method) to verify byte-identical
     * round-trip across small, medium, and large payloads.
     *
     * Minimum 100 iterations as required by design.
     *
     * Feature: enhanced-agent-exporter, Property 4: Gzip Compression Round-Trip
     */
    public function testEnhancedExporterGzipRoundTripWithRandomJsonPayloads(): void
    {
        // Build a minimal EnhancedExporter instance (dependencies are unused for compress/decompress)
        $enhancedExporter = $this->buildMinimalEnhancedExporter();

        for ($i = 0; $i < 100; $i++) {
            // Rotate through small (0), medium (1), and large (2) sizes
            $sizeCategory = $i % 3;

            switch ($sizeCategory) {
                case 0:
                    // Small: 1–100 characters of JSON-encoded content
                    $payload = $this->generateRandomJsonPayload(random_int(1, 100));
                    break;
                case 1:
                    // Medium: 101–5 000 characters
                    $payload = $this->generateRandomJsonPayload(random_int(101, 5000));
                    break;
                default:
                    // Large: 5 001–50 000 characters
                    $payload = $this->generateRandomJsonPayload(random_int(5001, 50000));
                    break;
            }

            $json = json_encode($payload, JSON_UNESCAPED_UNICODE);

            $compressed   = $enhancedExporter->compress($json);
            $decompressed = \NextLibAgent\Exporter\EnhancedExporter::decompress($compressed);

            $this->assertSame(
                $json,
                $decompressed,
                "EnhancedExporter gzip round-trip failed at iteration $i "
                . "(size category $sizeCategory, json length " . strlen($json) . ")"
            );
        }
    }

    /**
     * Property 4 edge case: empty string survives round-trip via EnhancedExporter.
     *
     * Feature: enhanced-agent-exporter, Property 4: Gzip Compression Round-Trip
     */
    public function testEnhancedExporterGzipRoundTripEmptyString(): void
    {
        $enhancedExporter = $this->buildMinimalEnhancedExporter();

        $compressed   = $enhancedExporter->compress('');
        $decompressed = \NextLibAgent\Exporter\EnhancedExporter::decompress('');

        $this->assertSame('', $compressed, "EnhancedExporter::compress('') should return ''");
        $this->assertSame('', $decompressed, "EnhancedExporter::decompress('') should return ''");
    }

    // =========================================================================
    // Helper: build a minimal EnhancedExporter instance
    // =========================================================================

    /**
     * Build a minimal EnhancedExporter instance whose compress/decompress methods
     * can be exercised without a real database or HTTP client.
     *
     * @return \NextLibAgent\Exporter\EnhancedExporter
     */
    private function buildMinimalEnhancedExporter(): \NextLibAgent\Exporter\EnhancedExporter
    {
        $db = new PDO('sqlite::memory:');

        // Minimal tables required by MetricsCollector
        $db->exec("CREATE TABLE IF NOT EXISTS visitor_count (id INTEGER PRIMARY KEY, checkin_date DATETIME, member_id TEXT)");
        $db->exec("CREATE TABLE IF NOT EXISTS loan (loan_id INTEGER PRIMARY KEY, loan_date DATE, return_date DATE, due_date DATE, is_return INTEGER, is_lent INTEGER)");
        $db->exec("CREATE TABLE IF NOT EXISTS member (member_id INTEGER PRIMARY KEY, register_date DATE, expire_date DATE)");
        $db->exec("CREATE TABLE IF NOT EXISTS biblio (biblio_id INTEGER PRIMARY KEY, input_date DATE)");
        $db->exec("CREATE TABLE IF NOT EXISTS item (item_id INTEGER PRIMARY KEY, input_date DATE)");
        $db->exec("CREATE TABLE IF NOT EXISTS fines (fines_id INTEGER PRIMARY KEY, fines_date DATE, debet INTEGER, credit INTEGER)");
        $db->exec("CREATE TABLE IF NOT EXISTS reserve (reserve_id INTEGER PRIMARY KEY, reserve_date DATE)");

        $collector     = new \NextLibAgent\Exporter\MetricsCollector($db);
        $anomalyTagger = new \NextLibAgent\Exporter\AnomalyTagger($db, $collector);
        $retryScheduler = new \NextLibAgent\Exporter\RetryScheduler(sys_get_temp_dir());
        $httpClient    = $this->createMock(\NextLibAgent\lib\HttpClient::class);

        $config = array(
            'tenant_id'       => 'test-tenant-enhanced-gzip',
            'cloud_base_url'  => 'https://cloud.nextlib.id',
            'api_secret'      => 'test-secret',
            'v2_enabled'      => false,
            'export_schedule' => 'daily',
        );

        return new \NextLibAgent\Exporter\EnhancedExporter(
            $collector,
            $anomalyTagger,
            $retryScheduler,
            $httpClient,
            $config,
            sys_get_temp_dir()
        );
    }

    /**
     * Generate a JSON-serializable payload whose JSON encoding is approximately
     * the requested character length.
     *
     * @param int $targetLength Approximate desired JSON string length in characters
     * @return array Associative array suitable for json_encode()
     */
    private function generateRandomJsonPayload(int $targetLength): array
    {
        $payload = array(
            'schema_version' => '2.0',
            'tenant_id'      => 'test-' . random_int(1000, 9999),
            'date'           => date('Y-m-d'),
            'count'          => random_int(0, 99999),
        );

        // Pad with a data string until we reach approximately the target length
        $currentLength = strlen(json_encode($payload, JSON_UNESCAPED_UNICODE));
        $remaining     = $targetLength - $currentLength - 10; // 10 chars overhead for the key

        if ($remaining > 0) {
            $chars  = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?';
            $cLen   = strlen($chars) - 1;
            $data   = '';
            for ($k = 0; $k < $remaining; $k++) {
                $data .= $chars[random_int(0, $cLen)];
            }
            $payload['data'] = $data;
        }

        return $payload;
    }

    /**
     * Property: compress → decompress == original for strings with special characters.
     *
     * Tests with JSON containing escaped characters, newlines, tabs, etc.
     */
    public function testGzipRoundTripWithSpecialCharacters(): void
    {
        $specialStrings = array(
            "line1\nline2\nline3",
            "tab\there\tand\there",
            "quotes: \"hello\" and 'world'",
            "backslash: \\path\\to\\file",
            "null byte handling",
            "mixed\r\n\twhitespace   spaces",
            str_repeat("A", 1000),
            str_repeat("\n", 100),
            "emoji: 😀🎉🚀💻📖",
        );

        for ($i = 0; $i < 100; $i++) {
            $payload = array(
                'content' => $specialStrings[array_rand($specialStrings)],
                'index' => $i,
                'random' => bin2hex(random_bytes(random_int(1, 32))),
            );
            $json = json_encode($payload);

            $compressed = $this->exporter->compress($json);
            $decompressed = AggregateExporter::decompress($compressed);

            $this->assertSame(
                $json,
                $decompressed,
                "Gzip round-trip failed for special characters iteration $i"
            );
        }
    }

    /**
     * Property: compressed output is always smaller or equal to original for
     * sufficiently large payloads (gzip efficiency property).
     *
     * Note: For very small inputs, gzip may produce larger output due to headers.
     * This test only asserts compression for payloads > 100 bytes.
     */
    public function testGzipCompressionReducesSizeForLargePayloads(): void
    {
        for ($i = 0; $i < 50; $i++) {
            $size = random_int(200, 10000);
            $repeatCount = (int) ($size / 18);
            $data = array(
                'large_data' => str_repeat('test data payload ', $repeatCount),
                'index' => $i,
            );
            $json = json_encode($data);

            $compressed = $this->exporter->compress($json);

            $this->assertLessThan(
                strlen($json),
                strlen($compressed),
                "Compression should reduce size for payload of " . strlen($json) . " bytes"
            );

            // Also verify round-trip still works
            $decompressed = AggregateExporter::decompress($compressed);
            $this->assertSame($json, $decompressed);
        }
    }

    // =========================================================================
    // Helper methods for generating random test data
    // =========================================================================

    /**
     * Generate a random JSON-serializable object with varying keys/values.
     *
     * @return array Random associative array
     */
    private function generateRandomJsonObject(): array
    {
        $numKeys = random_int(1, 15);
        $obj = array();

        for ($i = 0; $i < $numKeys; $i++) {
            $key = $this->generateRandomKey();
            $obj[$key] = $this->generateRandomValue();
        }

        return $obj;
    }

    /**
     * Generate a random string suitable for use as a JSON key.
     *
     * @return string Random key name
     */
    private function generateRandomKey(): string
    {
        $prefixes = array('field', 'key', 'prop', 'attr', 'data', 'val', 'item', 'stat');
        return $prefixes[array_rand($prefixes)] . '_' . random_int(0, 999);
    }

    /**
     * Generate a random JSON-compatible value.
     *
     * @return mixed Random value (string, int, float, bool, null, or nested array)
     */
    private function generateRandomValue()
    {
        $type = random_int(0, 6);

        switch ($type) {
            case 0:
                return random_int(-10000, 10000);
            case 1:
                return random_int(0, 1000) / 100.0;
            case 2:
                return (bool) random_int(0, 1);
            case 3:
                return null;
            case 4:
                $len = random_int(0, 50);
                return $this->generateRandomString($len);
            case 5:
                // Nested array
                $arr = array();
                $size = random_int(0, 5);
                for ($i = 0; $i < $size; $i++) {
                    $arr[] = random_int(0, 100);
                }
                return $arr;
            case 6:
                // Nested object
                $obj = array();
                $size = random_int(1, 3);
                for ($i = 0; $i < $size; $i++) {
                    $obj['sub_' . $i] = random_int(0, 100);
                }
                return $obj;
            default:
                return '';
        }
    }

    /**
     * Generate a random string of specified length.
     *
     * @param int $length Desired string length
     * @return string Random string
     */
    private function generateRandomString(int $length): string
    {
        if ($length === 0) {
            return '';
        }

        $chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-.,!?';
        $result = '';
        $charsLen = strlen($chars) - 1;

        for ($i = 0; $i < $length; $i++) {
            $result .= $chars[random_int(0, $charsLen)];
        }

        return $result;
    }

    /**
     * Generate a nested payload with specified depth.
     *
     * @param int $depth Nesting depth
     * @return array Nested associative array
     */
    private function generateNestedPayload(int $depth): array
    {
        if ($depth <= 0) {
            return array('leaf' => random_int(0, 1000));
        }

        return array(
            'level' => $depth,
            'value' => random_int(0, 1000),
            'child' => $this->generateNestedPayload($depth - 1),
        );
    }
}
