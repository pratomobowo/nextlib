<?php
/**
 * Property-Based Tests for AnomalyTagger.
 *
 * Tests Properties 11 and 12 for the AnomalyTagger component.
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\Exporter\AnomalyTagger;
use NextLibAgent\Exporter\MetricsCollector;
use PDO;

class AnomalyTaggerPropertyTest extends TestCase
{
    /**
     * In-memory SQLite database for seeding historical data.
     *
     * @var PDO
     */
    private $db;

    protected function setUp(): void
    {
        $this->db = new PDO('sqlite::memory:');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        // Create the minimal SLiMS tables that MetricsCollector queries
        $this->db->exec("
            CREATE TABLE visitor_count (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                member_id VARCHAR(20),
                checkin_date DATETIME NOT NULL
            )
        ");

        $this->db->exec("
            CREATE TABLE loan (
                loan_id INTEGER PRIMARY KEY AUTOINCREMENT,
                member_id VARCHAR(20),
                loan_date DATE,
                return_date DATE,
                due_date DATE,
                is_return INTEGER DEFAULT 0,
                is_lent INTEGER DEFAULT 1
            )
        ");

        $this->db->exec("
            CREATE TABLE member (
                member_id INTEGER PRIMARY KEY AUTOINCREMENT,
                register_date DATE,
                expire_date DATE
            )
        ");

        $this->db->exec("
            CREATE TABLE biblio (
                biblio_id INTEGER PRIMARY KEY AUTOINCREMENT,
                input_date DATE
            )
        ");

        $this->db->exec("
            CREATE TABLE item (
                item_id INTEGER PRIMARY KEY AUTOINCREMENT,
                input_date DATE
            )
        ");

        $this->db->exec("
            CREATE TABLE fines (
                fines_id INTEGER PRIMARY KEY AUTOINCREMENT,
                fines_date DATE,
                debet INTEGER DEFAULT 0,
                credit INTEGER DEFAULT 0
            )
        ");

        $this->db->exec("
            CREATE TABLE reserve (
                reserve_id INTEGER PRIMARY KEY AUTOINCREMENT,
                reserve_date DATE
            )
        ");
    }

    // =========================================================================
    // Property 11: Anomaly Baseline Computation
    // For any set of 30-day history values, computeBaseline() returns arithmetic
    // mean (sum / 30).
    // **Validates: Requirements 8.1**
    // =========================================================================

    /**
     * Feature: enhanced-agent-exporter, Property 11: Anomaly Baseline Computation
     *
     * For any random 30-day history, computeBaseline('visitor_count', targetDate)
     * must equal sum(values) / 30.
     *
     * Validates: Requirements 8.1
     */
    public function testBaselineComputationIsArithmeticMean(): void
    {
        $collector = new MetricsCollector($this->db);
        $tagger    = new AnomalyTagger($this->db, $collector);

        for ($i = 0; $i < 100; $i++) {
            // Clear previous data
            $this->db->exec("DELETE FROM visitor_count");

            // Use a fixed target date so the 30-day window is deterministic
            $targetDate = '2025-08-01';
            $baseTs     = strtotime($targetDate);

            $expectedSum = 0;

            // Seed exactly 30 days preceding the target date with random counts
            for ($offset = 1; $offset <= 30; $offset++) {
                $day   = date('Y-m-d', strtotime("-{$offset} day", $baseTs));
                $count = random_int(0, 200);
                $expectedSum += $count;

                for ($v = 0; $v < $count; $v++) {
                    $stmt = $this->db->prepare(
                        "INSERT INTO visitor_count (member_id, checkin_date) VALUES (:mid, :dt)"
                    );
                    $stmt->execute(array(
                        'mid' => 'member-' . $v,
                        'dt'  => $day . ' 09:00:00',
                    ));
                }
            }

            $expectedBaseline = (float) ($expectedSum / 30);
            $actualBaseline   = $tagger->computeBaseline('visitor_count', $targetDate);

            $this->assertEqualsWithDelta(
                $expectedBaseline,
                $actualBaseline,
                0.0001,
                "Baseline should be arithmetic mean ({$expectedSum}/30) for iteration $i"
            );
        }
    }

    /**
     * Feature: enhanced-agent-exporter, Property 11: Anomaly Baseline Computation
     *
     * For loan_count: computeBaseline returns arithmetic mean over 30-day window.
     *
     * Validates: Requirements 8.1
     */
    public function testBaselineComputationForLoanCount(): void
    {
        $collector = new MetricsCollector($this->db);
        $tagger    = new AnomalyTagger($this->db, $collector);

        for ($i = 0; $i < 100; $i++) {
            $this->db->exec("DELETE FROM loan");

            $targetDate = '2025-09-15';
            $baseTs     = strtotime($targetDate);
            $expectedSum = 0;

            for ($offset = 1; $offset <= 30; $offset++) {
                $day   = date('Y-m-d', strtotime("-{$offset} day", $baseTs));
                $count = random_int(0, 100);
                $expectedSum += $count;

                for ($v = 0; $v < $count; $v++) {
                    $stmt = $this->db->prepare(
                        "INSERT INTO loan (member_id, loan_date, due_date, is_lent) VALUES (:mid, :ld, :dd, 1)"
                    );
                    $stmt->execute(array(
                        'mid' => 'member-' . $v,
                        'ld'  => $day,
                        'dd'  => date('Y-m-d', strtotime('+14 days', strtotime($day))),
                    ));
                }
            }

            $expectedBaseline = (float) ($expectedSum / 30);
            $actualBaseline   = $tagger->computeBaseline('loan_count', $targetDate);

            $this->assertEqualsWithDelta(
                $expectedBaseline,
                $actualBaseline,
                0.0001,
                "Loan baseline should be arithmetic mean for iteration $i"
            );
        }
    }

    // =========================================================================
    // Property 12: Anomaly Flag Correctness
    // For any combination of metric values, baselines, and target dates, the
    // anomaly_flags array contains exactly the set of flags whose conditions are
    // met:
    //   - "visitor_spike"         iff visitor_count > 2 × baseline_visitor
    //   - "zero_visitors_weekday" iff visitor_count = 0 AND isWeekday(date)
    //   - "loan_spike"            iff loan_count > 2 × baseline_loan
    //   - "overdue_spike"         iff active_overdue_count > 3 × baseline_overdue
    // If no conditions are met, anomaly_flags SHALL be an empty array.
    // **Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.6**
    // =========================================================================

    /**
     * Feature: enhanced-agent-exporter, Property 12: Anomaly Flag Correctness
     *
     * For random metric values, baselines, and dates, detectAnomalies() must
     * return exactly the flags whose threshold conditions are satisfied —
     * no more, no less.
     *
     * Strategy: mock computeBaseline() so that it returns a controlled value,
     * then drive detectAnomalies() with known inputs and verify the flags.
     *
     * Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.6
     */
    public function testAnomalyFlagCorrectnessWithRandomInputs(): void
    {
        // Known weekdays and weekends for deterministic day-of-week checks
        $weekdays = array(
            '2025-06-02', // Monday
            '2025-06-03', // Tuesday
            '2025-06-04', // Wednesday
            '2025-06-05', // Thursday
            '2025-06-06', // Friday
            '2025-06-09', // Monday
            '2025-06-10', // Tuesday
            '2025-06-16', // Monday
            '2025-06-17', // Tuesday
            '2025-06-18', // Wednesday
            '2025-07-07', // Monday
            '2025-07-08', // Tuesday
            '2025-07-14', // Monday
            '2025-07-21', // Monday
            '2025-08-04', // Monday
        );
        $weekends = array(
            '2025-06-07', // Saturday
            '2025-06-08', // Sunday
            '2025-06-14', // Saturday
            '2025-06-15', // Sunday
            '2025-06-21', // Saturday
            '2025-07-05', // Saturday
            '2025-07-06', // Sunday
            '2025-07-12', // Saturday
            '2025-07-13', // Sunday
            '2025-08-02', // Saturday
            '2025-08-03', // Sunday
            '2025-08-09', // Saturday
        );

        for ($i = 0; $i < 100; $i++) {
            // ---- Generate random baselines (non-negative floats) ----
            $baselineVisitor = (float) random_int(0, 200);
            $baselineLoan    = (float) random_int(0, 100);
            $baselineOverdue = (float) random_int(0, 50);

            // ---- Generate random metric values ----
            $visitorCount = random_int(0, 500);
            $loanCount    = random_int(0, 300);
            $overdueCount = random_int(0, 200);

            // ---- Pick a random target date (mix of weekdays and weekends) ----
            $allDates  = array_merge($weekdays, $weekends);
            $targetDate = $allDates[array_rand($allDates)];

            // ---- Build daily and snapshot metric arrays ----
            $dailyMetrics = array(
                'visitor_count'         => $visitorCount,
                'unique_visitor_count'  => (int) ($visitorCount * 0.8),
                'loan_count'            => $loanCount,
                'return_count'          => random_int(0, $loanCount),
                'new_member_count'      => random_int(0, 20),
                'new_biblio_count'      => random_int(0, 10),
                'new_item_count'        => random_int(0, 15),
                'fines_debet_total'     => random_int(0, 500000),
                'fines_credit_total'    => random_int(0, 500000),
                'reservation_count'     => random_int(0, 30),
            );

            $snapshotMetrics = array(
                'total_collection_size' => random_int(1000, 50000),
                'active_member_count'   => random_int(100, 5000),
                'active_overdue_count'  => $overdueCount,
            );

            // ---- Compute expected flags independently ----
            $expectedFlags = array();

            if ($visitorCount > 2 * $baselineVisitor) {
                $expectedFlags[] = 'visitor_spike';
            }

            if ($visitorCount === 0 && $this->isWeekdayPHP($targetDate)) {
                $expectedFlags[] = 'zero_visitors_weekday';
            }

            if ($loanCount > 2 * $baselineLoan) {
                $expectedFlags[] = 'loan_spike';
            }

            if ($overdueCount > 3 * $baselineOverdue) {
                $expectedFlags[] = 'overdue_spike';
            }

            // ---- Create a partial mock of AnomalyTagger that controls computeBaseline ----
            $collector = $this->createMock(MetricsCollector::class);
            $tagger    = $this->getMockBuilder(AnomalyTagger::class)
                ->setConstructorArgs(array($this->db, $collector))
                ->onlyMethods(array('computeBaseline'))
                ->getMock();

            // Map metric names to controlled baseline values
            $baselineMap = array(
                'visitor_count'        => $baselineVisitor,
                'loan_count'           => $baselineLoan,
                'active_overdue_count' => $baselineOverdue,
            );

            $tagger->method('computeBaseline')
                ->willReturnCallback(function ($metricName, $date) use ($baselineMap) {
                    return isset($baselineMap[$metricName]) ? $baselineMap[$metricName] : 0.0;
                });

            // ---- Invoke detectAnomalies() ----
            $actualFlags = $tagger->detectAnomalies($dailyMetrics, $snapshotMetrics, $targetDate);

            // ---- Assert exact flag set equality (order-insensitive) ----
            sort($expectedFlags);
            sort($actualFlags);

            $this->assertSame(
                $expectedFlags,
                $actualFlags,
                sprintf(
                    "Iteration %d: date=%s, visitor=%d (baseline=%.1f), loan=%d (baseline=%.1f), overdue=%d (baseline=%.1f). " .
                    "Expected flags: [%s]. Got: [%s].",
                    $i,
                    $targetDate,
                    $visitorCount, $baselineVisitor,
                    $loanCount,    $baselineLoan,
                    $overdueCount, $baselineOverdue,
                    implode(', ', $expectedFlags),
                    implode(', ', $actualFlags)
                )
            );
        }
    }

    /**
     * Feature: enhanced-agent-exporter, Property 12: Anomaly Flag Correctness
     *
     * When no anomaly conditions are met, anomaly_flags SHALL be an empty array.
     *
     * Validates: Requirements 8.6
     */
    public function testNoFlagsWhenNoAnomaliesDetected(): void
    {
        for ($i = 0; $i < 100; $i++) {
            // Choose baselines that are large enough to never be exceeded
            $baselineVisitor = (float) random_int(500, 1000);
            $baselineLoan    = (float) random_int(300, 800);
            $baselineOverdue = (float) random_int(200, 500);

            // Metric values strictly below each threshold
            $visitorCount = random_int(1, (int) (2 * $baselineVisitor));  // not > 2×
            $loanCount    = random_int(1, (int) (2 * $baselineLoan));     // not > 2×
            $overdueCount = random_int(1, (int) (3 * $baselineOverdue));  // not > 3×

            // Use a weekend date to also avoid zero_visitors_weekday rule
            $weekendDates = array('2025-06-07', '2025-06-08', '2025-06-14', '2025-06-15');
            $targetDate   = $weekendDates[array_rand($weekendDates)];

            $dailyMetrics = array(
                'visitor_count' => $visitorCount,
                'loan_count'    => $loanCount,
            );

            $snapshotMetrics = array(
                'active_overdue_count' => $overdueCount,
            );

            $collector = $this->createMock(MetricsCollector::class);
            $tagger    = $this->getMockBuilder(AnomalyTagger::class)
                ->setConstructorArgs(array($this->db, $collector))
                ->onlyMethods(array('computeBaseline'))
                ->getMock();

            $baselineMap = array(
                'visitor_count'        => $baselineVisitor,
                'loan_count'           => $baselineLoan,
                'active_overdue_count' => $baselineOverdue,
            );

            $tagger->method('computeBaseline')
                ->willReturnCallback(function ($metricName, $date) use ($baselineMap) {
                    return isset($baselineMap[$metricName]) ? $baselineMap[$metricName] : 0.0;
                });

            $actualFlags = $tagger->detectAnomalies($dailyMetrics, $snapshotMetrics, $targetDate);

            $this->assertSame(
                array(),
                $actualFlags,
                sprintf(
                    "Iteration %d: Expected empty flags but got [%s]. visitor=%d (baseline=%.1f), " .
                    "loan=%d (baseline=%.1f), overdue=%d (baseline=%.1f), date=%s",
                    $i,
                    implode(', ', $actualFlags),
                    $visitorCount, $baselineVisitor,
                    $loanCount,    $baselineLoan,
                    $overdueCount, $baselineOverdue,
                    $targetDate
                )
            );
        }
    }

    /**
     * Feature: enhanced-agent-exporter, Property 12: Anomaly Flag Correctness
     *
     * Boundary tests: verify each flag triggers at exactly the right threshold.
     * - visitor_spike: triggers when visitor_count = 2*baseline + 1, not at 2*baseline
     * - loan_spike:    triggers when loan_count = 2*baseline + 1, not at 2*baseline
     * - overdue_spike: triggers when overdue = 3*baseline + 1, not at 3*baseline
     *
     * Validates: Requirements 8.2, 8.4, 8.5
     */
    public function testAnomalyFlagBoundaryConditions(): void
    {
        // A Monday (weekday) for zero_visitors tests
        $weekdayDate  = '2025-06-02'; // Monday
        $weekendDate  = '2025-06-07'; // Saturday

        for ($i = 0; $i < 100; $i++) {
            $baseline = random_int(1, 100);

            $collector = $this->createMock(MetricsCollector::class);

            // ---- visitor_spike boundary: exactly at 2*baseline (no flag) ----
            $taggerAtBoundary = $this->getMockBuilder(AnomalyTagger::class)
                ->setConstructorArgs(array($this->db, $collector))
                ->onlyMethods(array('computeBaseline'))
                ->getMock();
            $taggerAtBoundary->method('computeBaseline')
                ->willReturnCallback(function ($metric) use ($baseline) {
                    return (float) $baseline;
                });

            $dailyExact = array('visitor_count' => 2 * $baseline, 'loan_count' => 2 * $baseline);
            $snapshotExact = array('active_overdue_count' => 3 * $baseline);
            $flagsAtBoundary = $taggerAtBoundary->detectAnomalies($dailyExact, $snapshotExact, $weekendDate);

            $this->assertNotContains(
                'visitor_spike',
                $flagsAtBoundary,
                "visitor_spike must NOT fire when visitor_count = 2*baseline (iteration $i)"
            );
            $this->assertNotContains(
                'loan_spike',
                $flagsAtBoundary,
                "loan_spike must NOT fire when loan_count = 2*baseline (iteration $i)"
            );
            $this->assertNotContains(
                'overdue_spike',
                $flagsAtBoundary,
                "overdue_spike must NOT fire when overdue = 3*baseline (iteration $i)"
            );

            // ---- visitor_spike boundary: 2*baseline + 1 (flag fires) ----
            $taggerAboveBoundary = $this->getMockBuilder(AnomalyTagger::class)
                ->setConstructorArgs(array($this->db, $collector))
                ->onlyMethods(array('computeBaseline'))
                ->getMock();
            $taggerAboveBoundary->method('computeBaseline')
                ->willReturnCallback(function ($metric) use ($baseline) {
                    return (float) $baseline;
                });

            $dailyAbove   = array('visitor_count' => 2 * $baseline + 1, 'loan_count' => 2 * $baseline + 1);
            $snapshotAbove = array('active_overdue_count' => 3 * $baseline + 1);
            $flagsAbove    = $taggerAboveBoundary->detectAnomalies($dailyAbove, $snapshotAbove, $weekendDate);

            $this->assertContains(
                'visitor_spike',
                $flagsAbove,
                "visitor_spike MUST fire when visitor_count = 2*baseline+1 (iteration $i)"
            );
            $this->assertContains(
                'loan_spike',
                $flagsAbove,
                "loan_spike MUST fire when loan_count = 2*baseline+1 (iteration $i)"
            );
            $this->assertContains(
                'overdue_spike',
                $flagsAbove,
                "overdue_spike MUST fire when overdue = 3*baseline+1 (iteration $i)"
            );

            // ---- zero_visitors_weekday: fires on weekday with visitor=0 ----
            $taggerZero = $this->getMockBuilder(AnomalyTagger::class)
                ->setConstructorArgs(array($this->db, $collector))
                ->onlyMethods(array('computeBaseline'))
                ->getMock();
            $taggerZero->method('computeBaseline')
                ->willReturn((float) $baseline);

            $dailyZero   = array('visitor_count' => 0, 'loan_count' => 0);
            $snapshotZero = array('active_overdue_count' => 0);

            $flagsWeekday  = $taggerZero->detectAnomalies($dailyZero, $snapshotZero, $weekdayDate);
            $flagsWeekend  = $taggerZero->detectAnomalies($dailyZero, $snapshotZero, $weekendDate);

            $this->assertContains(
                'zero_visitors_weekday',
                $flagsWeekday,
                "zero_visitors_weekday MUST fire on weekday with visitor_count=0 (iteration $i)"
            );
            $this->assertNotContains(
                'zero_visitors_weekday',
                $flagsWeekend,
                "zero_visitors_weekday must NOT fire on weekend even with visitor_count=0 (iteration $i)"
            );
        }
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    /**
     * Independent PHP implementation of isWeekday() for test oracle use.
     *
     * @param  string $date Date in 'Y-m-d' format
     * @return bool True for Monday–Friday
     */
    private function isWeekdayPHP(string $date): bool
    {
        $n = (int) date('N', strtotime($date));
        return $n >= 1 && $n <= 5;
    }
}
