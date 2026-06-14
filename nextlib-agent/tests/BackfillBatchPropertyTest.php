<?php
/**
 * Property-Based Tests: BackfillEngine Batching and Stop-On-Failure
 *
 * **Validates: Requirements 5.2, 5.3, 6.3**
 *
 * Property 5: partitionIntoBatches always partitions arbitrary date ranges
 * into chronological, non-overlapping batches of at most 30 days.
 *
 * Property 6: A failing export halts backfill immediately, prevents any subsequent
 * batches from being processed, and saves the resume state.
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\Exporter\BackfillEngine;
use NextLibAgent\Exporter\MetricsCollector;
use NextLibAgent\Exporter\EnhancedExporter;
use PDO;

class BackfillBatchPropertyTest extends TestCase
{
    /**
     * @var string
     */
    private $tempDir;

    protected function setUp(): void
    {
        $this->tempDir = sys_get_temp_dir() . '/backfill_prop_test_' . getmypid() . '_' . mt_rand();
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

    // =========================================================================
    // Property 5: Date Range Batch Partitioning
    // =========================================================================

    /**
     * **Validates: Requirement 5.2**
     *
     * Property: Arbitrary start/end dates partition chronologically into
     * non-overlapping batches of <= 30 days covering the entire range.
     */
    public function testPartitionIntoBatchesAlwaysProducesValidBatches(): void
    {
        $db = new PDO('sqlite::memory:');
        $collector = new MetricsCollector($db);
        $exporter = $this->createMock(EnhancedExporter::class);
        $engine = new BackfillEngine($collector, $exporter, $this->tempDir);

        // Generate 100 random date ranges
        for ($i = 0; $i < 100; $i++) {
            $startDaysOffset = mt_rand(0, 1000);
            $durationDays = mt_rand(0, 200); // 0 offset = 1 day duration

            $startDt = new \DateTime('2020-01-01');
            $startDt->modify("+{$startDaysOffset} days");
            $startDate = $startDt->format('Y-m-d');

            $endDt = clone $startDt;
            $endDt->modify("+{$durationDays} days");
            $endDate = $endDt->format('Y-m-d');

            $batches = $engine->partitionIntoBatches($startDate, $endDate);

            $this->assertNotEmpty($batches);
            $totalDaysCovered = 0;
            $previousBatchEnd = null;

            foreach ($batches as $idx => $batch) {
                $batchStart = new \DateTime($batch['start']);
                $batchEnd = new \DateTime($batch['end']);
                
                // Assert start <= end
                $this->assertTrue($batchStart <= $batchEnd);

                // Assert batch size <= 30 days
                $days = (int) $batchStart->diff($batchEnd)->days + 1;
                $this->assertTrue($days <= 30, "Batch at index {$idx} has size {$days} (> 30 days)");

                $totalDaysCovered += $days;

                // Chronological order and no gaps or overlaps
                if ($previousBatchEnd !== null) {
                    $expectedStart = clone $previousBatchEnd;
                    $expectedStart->modify('+1 day');
                    $this->assertEquals(
                        $expectedStart->format('Y-m-d'),
                        $batch['start'],
                        "Batch start at index {$idx} does not chronologically succeed previous batch end"
                    );
                } else {
                    $this->assertEquals($startDate, $batch['start'], "First batch start does not match start date");
                }

                $previousBatchEnd = $batchEnd;
            }

            // Verify final batch end matches end date
            $this->assertEquals($endDate, $previousBatchEnd->format('Y-m-d'), "Last batch end does not match end date");

            // Verify total days match expected difference + 1
            $expectedTotalDays = (int) $startDt->diff($endDt)->days + 1;
            $this->assertEquals($expectedTotalDays, $totalDaysCovered, "Total days covered in batches does not match date range");
        }
    }

    // =========================================================================
    // Property 6: Stop-On-Failure / Resume Position Persistence
    // =========================================================================

    /**
     * **Validates: Requirement 6.3**
     *
     * Property: On first export failure, the backfill halts and saves state,
     * preventing any subsequent batches from executing.
     */
    public function testStopOnFailureSavesPositionAndHalts(): void
    {
        $db = new PDO('sqlite::memory:');
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        // Required tables for MetricsCollector queries inside BackfillEngine
        $db->exec("CREATE TABLE visitor_count (id INTEGER PRIMARY KEY, checkin_date DATETIME)");
        $db->exec("CREATE TABLE loan (loan_id INTEGER PRIMARY KEY, loan_date DATE, return_date DATE, is_return INTEGER, is_lent INTEGER)");
        $db->exec("CREATE TABLE member (member_id INTEGER PRIMARY KEY, register_date DATE, expire_date DATE)");
        $db->exec("CREATE TABLE biblio (biblio_id INTEGER PRIMARY KEY, input_date DATE)");
        $db->exec("CREATE TABLE item (item_id INTEGER PRIMARY KEY, input_date DATE)");
        $db->exec("CREATE TABLE fines (fines_id INTEGER PRIMARY KEY, fines_date DATE, debet INTEGER, credit INTEGER)");
        $db->exec("CREATE TABLE reserve (reserve_id INTEGER PRIMARY KEY, reserve_date DATE)");

        $collector = new MetricsCollector($db);

        // We want to simulate a backfill spanning 3 batches (e.g. 70 days)
        // Batch 0: days 1-30
        // Batch 1: days 31-60
        // Batch 2: days 61-70
        // Let's make the export fail on day 35 (which falls into Batch 1)
        
        $startDate = '2026-01-01';
        $endDate = '2026-03-11'; // 70 days total

        // Date of failure
        $failDate = '2026-02-04'; // Day 35 (Batch 1, day 5 of that batch)

        $exporter = $this->createMock(EnhancedExporter::class);
        
        // Exporter expects export() calls.
        // It returns true for dates before $failDate, and false for $failDate.
        // It should NEVER be called for dates after $failDate.
        $exporter->expects($this->any())
            ->method('export')
            ->will($this->returnCallback(function (string $date) use ($failDate) {
                if ($date === $failDate) {
                    return false;
                }
                return true;
            }));

        $engine = new BackfillEngine($collector, $exporter, $this->tempDir);

        $result = $engine->start($startDate, $endDate);

        $this->assertEquals('started', $result['status']);
        $this->assertStringContainsString('halted at batch 1', $result['message']);

        // Verify state file is persisted
        $stateFile = $this->tempDir . '/backfill_state.json';
        $this->assertFileExists($stateFile);
        $state = json_decode(file_get_contents($stateFile), true);

        $this->assertTrue($state['in_progress']);
        $this->assertEquals(1, $state['current_batch_index']);
        $this->assertEquals(3, $state['total_batches']);
        $this->assertEquals(30, $state['completed_days']); // Batch 0 completed, Batch 1 failed
        $this->assertNotEmpty($state['last_error']);
        $this->assertStringContainsString('Batch 1 failed', $state['last_error']);

        // Verify getProgress() shows correct resume position
        $progress = $engine->getProgress();
        $this->assertTrue($progress['in_progress']);
        // Batch 1 starts on day 31 (2026-01-31)
        $this->assertEquals('2026-01-31', $progress['current_position']);
        $this->assertEquals(70, $progress['total_days']);
        $this->assertEquals(30, $progress['completed_days']);
    }
}
