<?php
/**
 * Property-Based Tests: Payload V2 Structure Validation
 *
 * **Validates: Requirements 9.1, 9.2, 9.3**
 *
 * Property 3: For all random metrics maps, buildPayloadV2 produces valid V2 structures
 * (10 daily metrics keys, 3 snapshot metrics keys, non-empty schema version,
 * matches tenant ID and date, correct data types).
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

class PayloadStructurePropertyTest extends TestCase
{
    /** @var string */
    private $tempDir;

    protected function setUp(): void
    {
        $this->tempDir = sys_get_temp_dir() . '/payload_prop_test_' . getmypid() . '_' . mt_rand();
        mkdir($this->tempDir, 0755, true);
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

    /**
     * Create a minimal EnhancedExporter instance for testing.
     *
     * @param array $config
     * @return EnhancedExporter
     */
    private function createExporter(array $config): EnhancedExporter
    {
        $db = new PDO('sqlite::memory:');
        $collector = new MetricsCollector($db);
        $anomalyTagger = new AnomalyTagger($db, $collector);
        $retryScheduler = new RetryScheduler($this->tempDir);
        $httpClient = $this->createMock(HttpClient::class);

        return new EnhancedExporter(
            $collector,
            $anomalyTagger,
            $retryScheduler,
            $httpClient,
            $config,
            $this->tempDir
        );
    }

    /**
     * **Validates: Requirements 9.1, 9.2, 9.3**
     *
     * Property: buildPayloadV2 always generates correct structure, keys, and types
     * regardless of random metrics maps and anomaly flags.
     */
    public function testBuildPayloadV2ConformsToSchemaProperty(): void
    {
        $tenantId = 'tenant-' . mt_rand(1000, 9999) . '-' . uniqid();
        $config = array(
            'tenant_id' => $tenantId,
            'cloud_base_url' => 'https://cloud.nextlib.test',
            'api_secret' => 'test-secret',
            'v2_enabled' => true,
        );

        $exporter = $this->createExporter($config);

        $dailyKeys = EnhancedExporter::ALLOWED_DAILY_METRICS_KEYS;
        $snapshotKeys = EnhancedExporter::ALLOWED_SNAPSHOT_METRICS_KEYS;

        $dates = array('2026-06-12', '2020-01-01', '2025-12-31', '2024-02-29');

        for ($i = 0; $i < 100; $i++) {
            // Generate random daily metrics input (might have extra keys, might be missing keys)
            $inputDaily = array();
            // 80% chance to put correct keys, sometimes omit some or add extra random fields
            foreach ($dailyKeys as $k) {
                if (mt_rand(0, 10) > 1) {
                    $inputDaily[$k] = mt_rand(-100, 10000); // include negative values to test casting
                }
            }
            $inputDaily['extra_random_key_' . mt_rand(1, 5)] = 'random-value';

            // Generate random snapshot metrics input
            $inputSnapshot = array();
            foreach ($snapshotKeys as $k) {
                if (mt_rand(0, 10) > 1) {
                    $inputSnapshot[$k] = mt_rand(0, 50000);
                }
            }
            $inputSnapshot['another_extra_' . mt_rand(1, 5)] = 999;

            // Generate anomaly flags
            $anomalyFlags = array();
            $possibleFlags = array('ANOMALY_VISITORS', 'ANOMALY_LOANS', 'ANOMALY_RETURNS', 123, null, array());
            $numFlags = mt_rand(0, 3);
            for ($f = 0; $f < $numFlags; $f++) {
                $anomalyFlags[] = $possibleFlags[array_rand($possibleFlags)];
            }

            $date = $dates[array_rand($dates)];

            // Call buildPayloadV2
            $payload = $exporter->buildPayloadV2($inputDaily, $inputSnapshot, $anomalyFlags, $date);

            // Assert top-level keys structure
            $this->assertIsArray($payload);
            $this->assertCount(7, $payload);
            foreach (EnhancedExporter::ALLOWED_V2_TOP_LEVEL_KEYS as $key) {
                $this->assertArrayHasKey($key, $payload);
            }

            // Assert schema version
            $this->assertEquals('2.0', $payload['schema_version']);
            // Assert tenant_id matches config
            $this->assertEquals($tenantId, $payload['tenant_id']);
            // Assert date matches input
            $this->assertEquals($date, $payload['date']);

            // Assert daily_metrics structure
            $daily = $payload['daily_metrics'];
            $this->assertIsArray($daily);
            $this->assertCount(10, $daily);
            foreach ($dailyKeys as $key) {
                $this->assertArrayHasKey($key, $daily);
                $this->assertIsInt($daily[$key], "Metric {$key} must be an integer, got " . gettype($daily[$key]));
            }

            // Assert snapshot_metrics structure
            $snapshot = $payload['snapshot_metrics'];
            $this->assertIsArray($snapshot);
            $this->assertCount(3, $snapshot);
            foreach ($snapshotKeys as $key) {
                $this->assertArrayHasKey($key, $snapshot);
                $this->assertIsInt($snapshot[$key], "Metric {$key} must be an integer, got " . gettype($snapshot[$key]));
            }

            // Assert anomaly_flags is array of strings (and any non-strings were stripped)
            $flags = $payload['anomaly_flags'];
            $this->assertIsArray($flags);
            foreach ($flags as $flag) {
                $this->assertIsString($flag);
                $this->assertContains($flag, array('ANOMALY_VISITORS', 'ANOMALY_LOANS', 'ANOMALY_RETURNS'));
            }
        }
    }
}
