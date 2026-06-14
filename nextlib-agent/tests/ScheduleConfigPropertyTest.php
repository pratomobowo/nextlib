<?php
/**
 * Property-based tests for EnhancedExporter schedule config defaults.
 *
 * Feature: enhanced-agent-exporter, Property 10: Invalid Schedule Defaults to Daily
 *
 * **Property 10: Invalid Schedule Defaults to Daily**
 * For any string value of `export_schedule` that is not one of "hourly",
 * "every_6_hours", "every_12_hours", or "daily" (including empty string and
 * null), the EnhancedExporter SHALL interpret the schedule as "daily"
 * (86400-second interval).
 *
 * **Validates: Requirements 6.3**
 *
 * Test strategy:
 * 1. Create a temp queue directory per iteration.
 * 2. Write last_export.json with last_successful_export = now - (86400 + 1) s.
 * 3. Create EnhancedExporter with an invalid schedule string.
 * 4. Assert shouldExportNow() returns true  (elapsed >= daily interval ≥ schedule interval).
 * 5. Overwrite last_export.json with last_successful_export = now - 43200 s (12 h ago).
 * 6. Assert shouldExportNow() returns false (12 h < daily 24 h).
 * 7. Verify that the valid "every_12_hours" schedule returns true for the same 12-h gap,
 *    confirming the default is definitely "daily" and not "every_12_hours".
 *
 * Since PHP lacks a native property-based testing library, these tests simulate
 * PBT by generating many random invalid schedule strings across diverse categories
 * and verifying the default-to-daily property holds for all of them.
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\Exporter\EnhancedExporter;
use NextLibAgent\Exporter\MetricsCollector;
use NextLibAgent\Exporter\AnomalyTagger;
use NextLibAgent\Exporter\RetryScheduler;
use PDO;

class ScheduleConfigPropertyTest extends TestCase
{
    /**
     * Valid schedule strings that must be excluded from random generation.
     */
    const VALID_SCHEDULES = array('hourly', 'every_6_hours', 'every_12_hours', 'daily');

    /**
     * Temp directories created during tests — cleaned up in tearDown.
     *
     * @var string[]
     */
    private $tempDirs = array();

    protected function tearDown(): void
    {
        foreach ($this->tempDirs as $dir) {
            $lastExportFile = $dir . DIRECTORY_SEPARATOR . EnhancedExporter::LAST_EXPORT_FILE;
            if (file_exists($lastExportFile)) {
                @unlink($lastExportFile);
            }

            $queueFile = $dir . DIRECTORY_SEPARATOR . RetryScheduler::QUEUE_FILE;
            if (file_exists($queueFile)) {
                @unlink($queueFile);
            }

            // Remove any .tmp files left behind
            foreach (glob($dir . DIRECTORY_SEPARATOR . '*') as $file) {
                if (is_file($file)) {
                    @unlink($file);
                }
            }

            if (is_dir($dir)) {
                @rmdir($dir);
            }
        }

        $this->tempDirs = array();
    }

    // =========================================================================
    // Property 10: Invalid Schedule Defaults to Daily
    //
    // For any invalid export_schedule string, shouldExportNow() uses a
    // 86400-second (daily) interval.
    //
    // **Feature: enhanced-agent-exporter, Property 10: Invalid Schedule Defaults to Daily**
    // **Validates: Requirements 6.3**
    // =========================================================================

    /**
     * Feature: enhanced-agent-exporter, Property 10: Invalid Schedule Defaults to Daily
     *
     * Property 10 — Part A: shouldExportNow() returns TRUE when last export was
     * (86400 + 1) seconds ago and schedule is any invalid string.
     *
     * For 100 randomly-generated invalid schedule strings, an exporter configured
     * with that schedule must return true when the last export timestamp is just
     * over 24 hours in the past (elapsed >= daily interval of 86400 s).
     *
     * **Validates: Requirements 6.3**
     */
    public function testInvalidScheduleDefaultsToDailyReturnsTrueAfter86401Seconds(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $invalidSchedule = $this->generateInvalidSchedule($i);
            $tempDir         = $this->createTempDir();

            // last_successful_export = now - (86400 + 1) seconds → elapsed > daily interval
            $this->writeLastExportFile($tempDir, time() - 86401);

            $exporter = $this->buildExporter($invalidSchedule, $tempDir);

            $this->assertTrue(
                $exporter->shouldExportNow(),
                sprintf(
                    "Iteration %d: shouldExportNow() must return TRUE for invalid schedule '%s' "
                    . "when last export was 86401 s ago (>= daily 86400 s). "
                    . "Expected default to daily interval.",
                    $i,
                    $invalidSchedule
                )
            );
        }
    }

    /**
     * Feature: enhanced-agent-exporter, Property 10: Invalid Schedule Defaults to Daily
     *
     * Property 10 — Part B: shouldExportNow() returns FALSE when last export was
     * 43200 seconds ago (12 h) and schedule is any invalid string.
     *
     * If the invalid schedule defaulted to any sub-daily interval (e.g. hourly,
     * every_6_hours, every_12_hours) it would return true; defaulting to "daily"
     * (86400 s) means 43200 s elapsed is insufficient → must return false.
     *
     * **Validates: Requirements 6.3**
     */
    public function testInvalidScheduleDefaultsToDailyReturnsFalseAfter43200Seconds(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $invalidSchedule = $this->generateInvalidSchedule($i);
            $tempDir         = $this->createTempDir();

            // last_successful_export = now - 43200 s (12 h ago) → elapsed < daily interval
            $this->writeLastExportFile($tempDir, time() - 43200);

            $exporter = $this->buildExporter($invalidSchedule, $tempDir);

            $this->assertFalse(
                $exporter->shouldExportNow(),
                sprintf(
                    "Iteration %d: shouldExportNow() must return FALSE for invalid schedule '%s' "
                    . "when last export was 43200 s ago (< daily 86400 s). "
                    . "Invalid schedule must default to daily, not a shorter interval.",
                    $i,
                    $invalidSchedule
                )
            );
        }
    }

    /**
     * Feature: enhanced-agent-exporter, Property 10: Invalid Schedule Defaults to Daily
     *
     * Contrast test: valid "every_12_hours" schedule returns TRUE for the same
     * 43200-second gap.
     *
     * This confirms that the invalid-schedule behavior is unambiguously "daily"
     * and not "every_12_hours": with a 12-hour-old last export, "every_12_hours"
     * fires (elapsed >= 43200 s) while "daily" does not (elapsed < 86400 s).
     *
     * **Validates: Requirements 6.3**
     */
    public function testEvery12HoursScheduleReturnsTrueAfter43200Seconds(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $tempDir = $this->createTempDir();

            // last_successful_export = now - 43200 s (exactly 12 h ago)
            $this->writeLastExportFile($tempDir, time() - 43200);

            $exporter = $this->buildExporter('every_12_hours', $tempDir);

            $this->assertTrue(
                $exporter->shouldExportNow(),
                sprintf(
                    "Iteration %d: shouldExportNow() must return TRUE for 'every_12_hours' "
                    . "when last export was exactly 43200 s ago (>= 43200 s interval).",
                    $i
                )
            );
        }
    }

    /**
     * Feature: enhanced-agent-exporter, Property 10: Invalid Schedule Defaults to Daily
     *
     * Edge case: missing last_export.json always returns TRUE regardless of
     * what invalid schedule is configured (never-exported state).
     *
     * **Validates: Requirements 6.3, 6.4**
     */
    public function testInvalidScheduleDefaultsReturnsTrueWhenNoLastExportFile(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $invalidSchedule = $this->generateInvalidSchedule($i);
            $tempDir         = $this->createTempDir();
            // Intentionally do NOT write last_export.json

            $exporter = $this->buildExporter($invalidSchedule, $tempDir);

            $this->assertTrue(
                $exporter->shouldExportNow(),
                sprintf(
                    "Iteration %d: shouldExportNow() must return TRUE for invalid schedule '%s' "
                    . "when last_export.json does not exist.",
                    $i,
                    $invalidSchedule
                )
            );
        }
    }

    // =========================================================================
    // Helper: random invalid schedule generator
    // =========================================================================

    /**
     * Generate a random schedule string that is NOT one of the four valid values.
     *
     * Categories cycled across iterations to ensure broad coverage:
     *   0  random alphanumeric strings
     *   1  empty string
     *   2  near-miss strings (valid prefix or suffix)
     *   3  common non-valid keywords ("weekly", "monthly", "none", "always", "never")
     *   4  numeric strings ("0", "1", "86400", "3600")
     *   5  strings with special characters ("every-6-hours", "every 6 hours", "DAILY")
     *   6  very long strings
     *
     * @param int $iteration Current loop index (used to cycle categories)
     * @return string An invalid schedule string
     */
    private function generateInvalidSchedule(int $iteration): string
    {
        $category = $iteration % 7;

        switch ($category) {
            case 0:
                return $this->randomAlphanumericNotInValid(random_int(1, 20));

            case 1:
                return '';

            case 2:
                // Near-miss: prefix of a valid value or valid value with extra suffix
                $nearMisses = array(
                    'hour', 'hourly_export', 'every_6', 'every_12', 'every_6_hour',
                    'every_12_hour', 'dail', 'daily_export', 'every-6-hours',
                    'every_6_hourly', 'Every_6_hours', 'HOURLY', 'Daily', 'DAILY',
                );
                return $nearMisses[array_rand($nearMisses)];

            case 3:
                // Common invalid keywords
                $keywords = array(
                    'weekly', 'monthly', 'none', 'always', 'never',
                    'auto', 'default', 'true', 'false', 'null',
                    'on', 'off', 'enabled', 'disabled', 'custom',
                    'every_day', 'every_hour', 'per_hour', 'per_day',
                );
                return $keywords[array_rand($keywords)];

            case 4:
                // Numeric strings
                $numerics = array(
                    '0', '1', '60', '3600', '21600', '43200', '86400',
                    '86401', '-1', '0.5', '1.5', '24', '12', '6',
                );
                return $numerics[array_rand($numerics)];

            case 5:
                // Special characters and format variations
                $special = array(
                    'every-6-hours', 'every 6 hours', 'every_6hours',
                    'every-12-hours', 'every 12 hours', 'EVERY_6_HOURS',
                    'EVERY_12_HOURS', 'every_6_Hours', 'every_12_Hours',
                    '1h', '6h', '12h', '24h', '1d', '@hourly', '@daily',
                    'cron(0 * * * *)', '*/6 * * * *',
                );
                return $special[array_rand($special)];

            case 6:
            default:
                // Very long strings
                $chars  = 'abcdefghijklmnopqrstuvwxyz_0123456789';
                $length = random_int(25, 100);
                $result = '';
                for ($k = 0; $k < $length; $k++) {
                    $result .= $chars[random_int(0, strlen($chars) - 1)];
                }
                // Ensure it is not accidentally a valid schedule
                if (in_array($result, self::VALID_SCHEDULES, true)) {
                    $result .= '_invalid';
                }
                return $result;
        }
    }

    /**
     * Generate a random alphanumeric string of $length characters that is not
     * one of the four valid schedule strings.
     *
     * @param int $length Desired string length
     * @return string
     */
    private function randomAlphanumericNotInValid(int $length): string
    {
        $chars  = 'abcdefghijklmnopqrstuvwxyz0123456789_';
        $maxIdx = strlen($chars) - 1;

        do {
            $result = '';
            for ($k = 0; $k < $length; $k++) {
                $result .= $chars[random_int(0, $maxIdx)];
            }
        } while (in_array($result, self::VALID_SCHEDULES, true));

        return $result;
    }

    // =========================================================================
    // Helper: build a minimal EnhancedExporter for schedule testing only
    // =========================================================================

    /**
     * Build a minimal EnhancedExporter configured with the given schedule.
     *
     * MetricsCollector, AnomalyTagger, RetryScheduler, and HttpClient are
     * constructed minimally; only shouldExportNow() is exercised.
     *
     * @param string $schedule Value to use for export_schedule config key
     * @param string $queuePath Path to temp directory for last_export.json
     * @return EnhancedExporter
     */
    private function buildExporter(string $schedule, string $queuePath): EnhancedExporter
    {
        $db = new PDO('sqlite::memory:');

        // Minimal tables required by MetricsCollector constructor
        $db->exec("CREATE TABLE IF NOT EXISTS visitor_count (id INTEGER PRIMARY KEY, checkin_date DATETIME, member_id TEXT)");
        $db->exec("CREATE TABLE IF NOT EXISTS loan (loan_id INTEGER PRIMARY KEY, loan_date DATE, return_date DATE, due_date DATE, is_return INTEGER DEFAULT 0, is_lent INTEGER DEFAULT 1)");
        $db->exec("CREATE TABLE IF NOT EXISTS member (member_id TEXT PRIMARY KEY, register_date DATE, expire_date DATE)");
        $db->exec("CREATE TABLE IF NOT EXISTS biblio (biblio_id INTEGER PRIMARY KEY, input_date DATE)");
        $db->exec("CREATE TABLE IF NOT EXISTS item (item_id INTEGER PRIMARY KEY, input_date DATE)");
        $db->exec("CREATE TABLE IF NOT EXISTS fines (fines_id INTEGER PRIMARY KEY, fines_date DATE, debet INTEGER DEFAULT 0, credit INTEGER DEFAULT 0)");
        $db->exec("CREATE TABLE IF NOT EXISTS reserve (reserve_id INTEGER PRIMARY KEY, reserve_date DATE)");

        $collector      = new MetricsCollector($db);
        $anomalyTagger  = new AnomalyTagger($db, $collector);
        $retryScheduler = new RetryScheduler($queuePath);
        $httpClient     = $this->createMock(\NextLibAgent\lib\HttpClient::class);

        $config = array(
            'tenant_id'       => 'test-tenant-schedule',
            'cloud_base_url'  => 'https://cloud.nextlib.id',
            'api_secret'      => 'test-secret-schedule',
            'v2_enabled'      => false,
            'export_schedule' => $schedule,
        );

        return new EnhancedExporter(
            $collector,
            $anomalyTagger,
            $retryScheduler,
            $httpClient,
            $config,
            $queuePath
        );
    }

    // =========================================================================
    // Helper: file system utilities
    // =========================================================================

    /**
     * Create a temporary directory, register it for cleanup, and return its path.
     *
     * @return string Absolute path to the new temp directory
     */
    private function createTempDir(): string
    {
        $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR
            . 'nextlib_schedule_test_' . uniqid('', true);

        if (!mkdir($dir, 0755, true)) {
            $this->fail("Could not create temp directory: $dir");
        }

        $this->tempDirs[] = $dir;

        return $dir;
    }

    /**
     * Write last_export.json to the given queue directory using the supplied
     * Unix timestamp as the last_successful_export value.
     *
     * @param string $queuePath  Path to the queue directory
     * @param int    $timestamp  Unix timestamp for last_successful_export
     */
    private function writeLastExportFile(string $queuePath, int $timestamp): void
    {
        $data = array(
            'last_successful_export' => date('c', $timestamp),
            'last_export_date'       => date('Y-m-d', $timestamp),
            'export_schedule'        => 'daily',
        );

        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

        $filePath = $queuePath . DIRECTORY_SEPARATOR . EnhancedExporter::LAST_EXPORT_FILE;

        if (file_put_contents($filePath, $json) === false) {
            $this->fail("Could not write last_export.json to: $filePath");
        }
    }
}
