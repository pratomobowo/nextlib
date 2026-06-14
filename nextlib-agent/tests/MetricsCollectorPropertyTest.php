<?php
/**
 * Property-based tests for MetricsCollector.
 *
 * Feature: enhanced-agent-exporter, Property 1: Daily Metrics Accuracy
 *
 * **Property 1: Daily Metrics Accuracy**
 * For any set of records in SLiMS tables (visitor_count, loan, member, biblio,
 * item, fines, reserve) and for any valid target date, the MetricsCollector
 * SHALL return daily metric values that exactly match the expected aggregates
 * computed independently from those records.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10**
 *
 * Since PHP lacks a native property-based testing library, these tests
 * simulate PBT by generating many random inputs across diverse categories
 * and verifying the correctness property holds for all of them.
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\Exporter\MetricsCollector;
use PDO;

class MetricsCollectorPropertyTest extends TestCase
{
    /** @var PDO In-memory SQLite database */
    private $db;

    protected function setUp(): void
    {
        $this->db = new PDO('sqlite::memory:');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->createTables();
    }

    // =========================================================================
    // Schema setup
    // =========================================================================

    private function createTables(): void
    {
        $this->db->exec("
            CREATE TABLE visitor_count (
                visitor_id   INTEGER PRIMARY KEY AUTOINCREMENT,
                member_id    VARCHAR(20),
                checkin_date DATETIME NOT NULL
            )
        ");

        $this->db->exec("
            CREATE TABLE loan (
                loan_id     INTEGER PRIMARY KEY AUTOINCREMENT,
                member_id   VARCHAR(20),
                item_code   VARCHAR(20),
                loan_date   DATE,
                due_date    DATE,
                return_date DATE,
                is_return   INTEGER DEFAULT 0,
                is_lent     INTEGER DEFAULT 1
            )
        ");

        $this->db->exec("
            CREATE TABLE member (
                member_id     VARCHAR(20) PRIMARY KEY,
                register_date DATE,
                expire_date   DATE
            )
        ");

        $this->db->exec("
            CREATE TABLE biblio (
                biblio_id  INTEGER PRIMARY KEY AUTOINCREMENT,
                input_date DATE
            )
        ");

        $this->db->exec("
            CREATE TABLE item (
                item_id    INTEGER PRIMARY KEY AUTOINCREMENT,
                input_date DATE
            )
        ");

        $this->db->exec("
            CREATE TABLE fines (
                fines_id   INTEGER PRIMARY KEY AUTOINCREMENT,
                fines_date DATE,
                debet      INTEGER DEFAULT 0,
                credit     INTEGER DEFAULT 0
            )
        ");

        $this->db->exec("
            CREATE TABLE reserve (
                reserve_id   INTEGER PRIMARY KEY AUTOINCREMENT,
                reserve_date DATE
            )
        ");
    }

    // =========================================================================
    // Property 1: Daily Metrics Accuracy
    //
    // For any set of records and any valid target date, collectDailyMetrics()
    // returns values that exactly match the independently-computed expected
    // aggregates using COUNT/SUM with the appropriate date filter.
    //
    // **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10**
    // =========================================================================

    /**
     * Property 1: Daily Metrics Accuracy — all 10 metrics match independent counts.
     *
     * Each iteration:
     * 1. Picks a random target date
     * 2. Seeds all SLiMS tables with random records distributed across multiple dates
     * 3. Independently counts/sums records falling on the target date in PHP
     * 4. Asserts MetricsCollector returns values matching the independent computation
     *
     * 100 iterations cover a wide range of row counts, date distributions, and
     * edge cases (zero rows, all rows on target date, none on target date, etc.).
     */
    public function testDailyMetricsAccuracyAcrossRandomInputs(): void
    {
        for ($i = 0; $i < 100; $i++) {
            // Fresh tables for each iteration
            $this->clearTables();

            // Pick a random target date in a realistic window
            $targetDate = $this->randomDate('2024-01-01', '2026-12-31');

            // Seed tables with random data and independently track expected counts
            $expected = $this->seedTablesAndComputeExpected($targetDate);

            // Invoke the unit under test
            $collector = new MetricsCollector($this->db);
            $actual = $collector->collectDailyMetrics($targetDate);

            // Assert every metric matches the independent PHP computation
            $this->assertSame(
                $expected['visitor_count'],
                $actual['visitor_count'],
                "Iteration $i (date=$targetDate): visitor_count mismatch"
            );
            $this->assertSame(
                $expected['unique_visitor_count'],
                $actual['unique_visitor_count'],
                "Iteration $i (date=$targetDate): unique_visitor_count mismatch"
            );
            $this->assertSame(
                $expected['loan_count'],
                $actual['loan_count'],
                "Iteration $i (date=$targetDate): loan_count mismatch"
            );
            $this->assertSame(
                $expected['return_count'],
                $actual['return_count'],
                "Iteration $i (date=$targetDate): return_count mismatch"
            );
            $this->assertSame(
                $expected['new_member_count'],
                $actual['new_member_count'],
                "Iteration $i (date=$targetDate): new_member_count mismatch"
            );
            $this->assertSame(
                $expected['new_biblio_count'],
                $actual['new_biblio_count'],
                "Iteration $i (date=$targetDate): new_biblio_count mismatch"
            );
            $this->assertSame(
                $expected['new_item_count'],
                $actual['new_item_count'],
                "Iteration $i (date=$targetDate): new_item_count mismatch"
            );
            $this->assertSame(
                $expected['fines_debet_total'],
                $actual['fines_debet_total'],
                "Iteration $i (date=$targetDate): fines_debet_total mismatch"
            );
            $this->assertSame(
                $expected['fines_credit_total'],
                $actual['fines_credit_total'],
                "Iteration $i (date=$targetDate): fines_credit_total mismatch"
            );
            $this->assertSame(
                $expected['reservation_count'],
                $actual['reservation_count'],
                "Iteration $i (date=$targetDate): reservation_count mismatch"
            );
        }
    }

    /**
     * Property 1 — all returned values are non-negative integers.
     *
     * For any random database state, every metric value must be a non-negative int.
     */
    public function testDailyMetricValuesAreAlwaysNonNegativeIntegers(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $this->clearTables();

            $targetDate = $this->randomDate('2024-01-01', '2026-12-31');
            $this->seedTablesAndComputeExpected($targetDate);

            $collector = new MetricsCollector($this->db);
            $actual = $collector->collectDailyMetrics($targetDate);

            foreach ($actual as $key => $value) {
                $this->assertIsInt($value, "Iteration $i: metric '$key' must be an integer");
                $this->assertGreaterThanOrEqual(
                    0,
                    $value,
                    "Iteration $i: metric '$key' must be >= 0"
                );
            }
        }
    }

    /**
     * Property 1 — all 10 required keys are always present in the returned array.
     */
    public function testDailyMetricsAlwaysReturnsAllRequiredKeys(): void
    {
        $requiredKeys = array(
            'visitor_count',
            'unique_visitor_count',
            'loan_count',
            'return_count',
            'new_member_count',
            'new_biblio_count',
            'new_item_count',
            'fines_debet_total',
            'fines_credit_total',
            'reservation_count',
        );

        for ($i = 0; $i < 100; $i++) {
            $this->clearTables();

            $targetDate = $this->randomDate('2024-01-01', '2026-12-31');
            $this->seedTablesAndComputeExpected($targetDate);

            $collector = new MetricsCollector($this->db);
            $actual = $collector->collectDailyMetrics($targetDate);

            foreach ($requiredKeys as $key) {
                $this->assertArrayHasKey(
                    $key,
                    $actual,
                    "Iteration $i: key '$key' must be present in collectDailyMetrics() result"
                );
            }
        }
    }

    // =========================================================================
    // Property 2: Snapshot Metrics Accuracy
    //
    // For any set of records in SLiMS tables (item, member, loan) and any
    // valid target date, collectSnapshotMetrics() returns values that exactly
    // match independently-computed expected aggregates.
    //
    // **Validates: Requirements 2.1, 2.2, 2.3**
    // =========================================================================

    /**
     * Property 2: Snapshot Metrics Accuracy — all 3 snapshot metrics match independent counts.
     *
     * Each iteration:
     * 1. Picks a random target date
     * 2. Seeds item, member, and loan tables with random records
     * 3. Independently computes expected values in PHP:
     *    - total_collection_size = total rows in item table (no date filter)
     *    - active_member_count = count members where expire_date >= target_date
     *    - active_overdue_count = count loans where due_date < target_date AND return_date IS NULL AND is_lent = 1
     * 4. Asserts MetricsCollector::collectSnapshotMetrics() matches for each
     *
     * 100 iterations cover diverse row counts, date distributions, and edge
     * cases (empty tables, all members expired, no overdue loans, etc.).
     *
     * Feature: enhanced-agent-exporter, Property 2: Snapshot Metrics Accuracy
     */
    public function testSnapshotMetricsAccuracyAcrossRandomInputs(): void
    {
        for ($i = 0; $i < 100; $i++) {
            // Fresh tables for each iteration
            $this->clearTables();

            // Pick a random target date in a realistic window
            $targetDate = $this->randomDate('2024-01-01', '2026-12-31');

            // Seed tables and independently compute expected snapshot values
            $expected = $this->seedSnapshotTablesAndComputeExpected($targetDate);

            // Invoke the unit under test
            $collector = new MetricsCollector($this->db);
            $actual = $collector->collectSnapshotMetrics($targetDate);

            $this->assertSame(
                $expected['total_collection_size'],
                $actual['total_collection_size'],
                "Iteration $i (date=$targetDate): total_collection_size mismatch"
            );
            $this->assertSame(
                $expected['active_member_count'],
                $actual['active_member_count'],
                "Iteration $i (date=$targetDate): active_member_count mismatch"
            );
            $this->assertSame(
                $expected['active_overdue_count'],
                $actual['active_overdue_count'],
                "Iteration $i (date=$targetDate): active_overdue_count mismatch"
            );
        }
    }

    /**
     * Property 2 — all 3 snapshot metric values are always non-negative integers.
     *
     * For any random database state, every snapshot metric value must be a
     * non-negative integer.
     *
     * Feature: enhanced-agent-exporter, Property 2: Snapshot Metrics Accuracy
     */
    public function testSnapshotMetricValuesAreAlwaysNonNegativeIntegers(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $this->clearTables();

            $targetDate = $this->randomDate('2024-01-01', '2026-12-31');
            $this->seedSnapshotTablesAndComputeExpected($targetDate);

            $collector = new MetricsCollector($this->db);
            $actual = $collector->collectSnapshotMetrics($targetDate);

            foreach ($actual as $key => $value) {
                $this->assertIsInt($value, "Iteration $i: snapshot metric '$key' must be an integer");
                $this->assertGreaterThanOrEqual(
                    0,
                    $value,
                    "Iteration $i: snapshot metric '$key' must be >= 0"
                );
            }
        }
    }

    // =========================================================================
    // Property 1: continuation
    // =========================================================================

    /**
     * Property 1 — unique_visitor_count is always <= visitor_count.
     *
     * The distinct count of members cannot exceed total check-in rows.
     */
    public function testUniqueVisitorCountNeverExceedsTotalVisitorCount(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $this->clearTables();

            $targetDate = $this->randomDate('2024-01-01', '2026-12-31');
            $this->seedTablesAndComputeExpected($targetDate);

            $collector = new MetricsCollector($this->db);
            $actual = $collector->collectDailyMetrics($targetDate);

            $this->assertLessThanOrEqual(
                $actual['visitor_count'],
                $actual['unique_visitor_count'],
                "Iteration $i (date=$targetDate): unique_visitor_count ({$actual['unique_visitor_count']}) "
                . "must be <= visitor_count ({$actual['visitor_count']})"
            );
        }
    }

    // =========================================================================
    // Data seeding helpers
    // =========================================================================

    /**
     * Seed all SLiMS tables with random records and independently compute the
     * expected daily metric values for the given target date.
     *
     * Strategy:
     * - Each table gets 0–15 total rows
     * - Each row's date is independently drawn: with 40% probability it falls
     *   on the target date, otherwise it is a random nearby date (±30 days)
     * - Expected counts are accumulated in PHP while inserting rows
     *
     * @param string $targetDate Date in 'Y-m-d' format
     * @return array Expected daily metrics (same keys as collectDailyMetrics)
     */
    private function seedTablesAndComputeExpected(string $targetDate): array
    {
        $expected = array(
            'visitor_count'        => 0,
            'unique_visitor_count' => 0,
            'loan_count'           => 0,
            'return_count'         => 0,
            'new_member_count'     => 0,
            'new_biblio_count'     => 0,
            'new_item_count'       => 0,
            'fines_debet_total'    => 0,
            'fines_credit_total'   => 0,
            'reservation_count'    => 0,
        );

        // ---- visitor_count table ----
        $visitorRows = random_int(0, 15);
        $memberIdsOnTarget = array(); // track distinct members on target date

        for ($j = 0; $j < $visitorRows; $j++) {
            $memberId = 'M' . str_pad((string) random_int(1, 8), 3, '0', STR_PAD_LEFT);
            $checkinDate = $this->pickDate($targetDate);
            $checkinDatetime = $checkinDate . ' ' . $this->randomTime();

            $stmt = $this->db->prepare(
                "INSERT INTO visitor_count (member_id, checkin_date) VALUES (:mid, :date)"
            );
            $stmt->execute(array('mid' => $memberId, 'date' => $checkinDatetime));

            if ($checkinDate === $targetDate) {
                $expected['visitor_count']++;
                $memberIdsOnTarget[$memberId] = true;
            }
        }
        $expected['unique_visitor_count'] = count($memberIdsOnTarget);

        // ---- loan table (loan_count = new loans; return_count = returns) ----
        $loanRows = random_int(0, 15);

        for ($j = 0; $j < $loanRows; $j++) {
            $memberId  = 'M' . str_pad((string) random_int(1, 20), 3, '0', STR_PAD_LEFT);
            $itemCode  = 'B' . random_int(10000, 99999);
            $loanDate  = $this->pickDate($targetDate);
            $dueDate   = $this->addDays($loanDate, 14);
            $isReturn  = random_int(0, 1);
            $returnDate = null;

            if ($isReturn === 1) {
                $returnDate = $this->pickDate($targetDate);
            }

            $stmt = $this->db->prepare(
                "INSERT INTO loan (member_id, item_code, loan_date, due_date, return_date, is_return, is_lent)
                 VALUES (:mid, :item, :loan, :due, :ret, :is_return, :is_lent)"
            );
            $stmt->execute(array(
                'mid'       => $memberId,
                'item'      => $itemCode,
                'loan'      => $loanDate,
                'due'       => $dueDate,
                'ret'       => $returnDate,
                'is_return' => $isReturn,
                'is_lent'   => $isReturn === 1 ? 0 : 1,
            ));

            // Independent count for loan_count
            if ($loanDate === $targetDate) {
                $expected['loan_count']++;
            }

            // Independent count for return_count
            if ($returnDate === $targetDate && $isReturn === 1) {
                $expected['return_count']++;
            }
        }

        // ---- member table ----
        $memberRows = random_int(0, 10);
        $usedMemberIds = array();

        for ($j = 0; $j < $memberRows; $j++) {
            // Ensure unique member_id per iteration to avoid UNIQUE constraint violations
            do {
                $memberId = 'REG' . str_pad((string) random_int(1, 9999), 4, '0', STR_PAD_LEFT);
            } while (isset($usedMemberIds[$memberId]));
            $usedMemberIds[$memberId] = true;

            $registerDate = $this->pickDate($targetDate);
            $expireDate   = $this->addDays($registerDate, random_int(180, 730));

            $stmt = $this->db->prepare(
                "INSERT INTO member (member_id, register_date, expire_date) VALUES (:mid, :reg, :exp)"
            );
            $stmt->execute(array('mid' => $memberId, 'reg' => $registerDate, 'exp' => $expireDate));

            if ($registerDate === $targetDate) {
                $expected['new_member_count']++;
            }
        }

        // ---- biblio table ----
        $biblioRows = random_int(0, 15);

        for ($j = 0; $j < $biblioRows; $j++) {
            $inputDate = $this->pickDate($targetDate);

            $stmt = $this->db->prepare("INSERT INTO biblio (input_date) VALUES (:date)");
            $stmt->execute(array('date' => $inputDate));

            if ($inputDate === $targetDate) {
                $expected['new_biblio_count']++;
            }
        }

        // ---- item table ----
        $itemRows = random_int(0, 15);

        for ($j = 0; $j < $itemRows; $j++) {
            $inputDate = $this->pickDate($targetDate);

            $stmt = $this->db->prepare("INSERT INTO item (input_date) VALUES (:date)");
            $stmt->execute(array('date' => $inputDate));

            if ($inputDate === $targetDate) {
                $expected['new_item_count']++;
            }
        }

        // ---- fines table ----
        $finesRows = random_int(0, 15);

        for ($j = 0; $j < $finesRows; $j++) {
            $finesDate = $this->pickDate($targetDate);
            $debet     = random_int(0, 50000);
            $credit    = random_int(0, 50000);

            $stmt = $this->db->prepare(
                "INSERT INTO fines (fines_date, debet, credit) VALUES (:date, :debet, :credit)"
            );
            $stmt->execute(array('date' => $finesDate, 'debet' => $debet, 'credit' => $credit));

            if ($finesDate === $targetDate) {
                $expected['fines_debet_total']  += $debet;
                $expected['fines_credit_total'] += $credit;
            }
        }

        // ---- reserve table ----
        $reserveRows = random_int(0, 15);

        for ($j = 0; $j < $reserveRows; $j++) {
            $reserveDate = $this->pickDate($targetDate);

            $stmt = $this->db->prepare("INSERT INTO reserve (reserve_date) VALUES (:date)");
            $stmt->execute(array('date' => $reserveDate));

            if ($reserveDate === $targetDate) {
                $expected['reservation_count']++;
            }
        }

        return $expected;
    }

    /**
     * Seed item, member, and loan tables with random records and independently
     * compute the expected snapshot metric values for the given target date.
     *
     * Strategy:
     * - item table  : 0–20 rows, any input_date (all count toward total_collection_size)
     * - member table: 0–15 rows with unique member_ids; expire_date randomly set
     *                 either >= targetDate (active) or < targetDate (expired)
     * - loan table  : 0–15 rows; due_date randomly set either < targetDate (overdue)
     *                 or >= targetDate (not overdue); return_date is null or a date;
     *                 is_lent is 0 or 1
     *
     * Expected values are accumulated in PHP as rows are inserted so they can be
     * compared against the MetricsCollector output without a second DB query.
     *
     * @param string $targetDate Date in 'Y-m-d' format
     * @return array{total_collection_size: int, active_member_count: int, active_overdue_count: int}
     */
    private function seedSnapshotTablesAndComputeExpected(string $targetDate): array
    {
        $expected = array(
            'total_collection_size' => 0,
            'active_member_count'   => 0,
            'active_overdue_count'  => 0,
        );

        // ---- item table (total_collection_size = all rows, no date filter) ----
        $itemRows = random_int(0, 20);

        for ($j = 0; $j < $itemRows; $j++) {
            // Any input_date; all rows count toward total_collection_size
            $inputDate = $this->addDays($targetDate, random_int(-365, 365));

            $stmt = $this->db->prepare("INSERT INTO item (input_date) VALUES (:date)");
            $stmt->execute(array('date' => $inputDate));

            $expected['total_collection_size']++;
        }

        // ---- member table (active_member_count = rows where expire_date >= targetDate) ----
        $memberRows  = random_int(0, 15);
        $usedMemberIds = array();

        for ($j = 0; $j < $memberRows; $j++) {
            // Unique member_id to avoid PRIMARY KEY violations
            do {
                $memberId = 'SNP' . str_pad((string) random_int(1, 9999), 4, '0', STR_PAD_LEFT);
            } while (isset($usedMemberIds[$memberId]));
            $usedMemberIds[$memberId] = true;

            // 50% chance active (expire >= target), 50% chance expired (expire < target)
            if (random_int(0, 1) === 1) {
                // Active: expire_date is targetDate itself or later (1–730 days ahead)
                $expireDate = $this->addDays($targetDate, random_int(0, 730));
                $expected['active_member_count']++;
            } else {
                // Expired: expire_date is strictly before targetDate (1–365 days ago)
                $expireDate = $this->addDays($targetDate, -random_int(1, 365));
            }

            $registerDate = $this->addDays($expireDate, -random_int(180, 730));

            $stmt = $this->db->prepare(
                "INSERT INTO member (member_id, register_date, expire_date) VALUES (:mid, :reg, :exp)"
            );
            $stmt->execute(array('mid' => $memberId, 'reg' => $registerDate, 'exp' => $expireDate));
        }

        // ---- loan table (active_overdue_count = due_date < target AND return_date IS NULL AND is_lent = 1) ----
        $loanRows = random_int(0, 15);

        for ($j = 0; $j < $loanRows; $j++) {
            $memberId = 'M' . str_pad((string) random_int(1, 20), 3, '0', STR_PAD_LEFT);
            $itemCode = 'B' . random_int(10000, 99999);

            // 50% chance due_date is overdue (< targetDate), 50% not overdue (>= targetDate)
            $isOverdueDue = random_int(0, 1) === 1;
            if ($isOverdueDue) {
                $dueDate = $this->addDays($targetDate, -random_int(1, 90));
            } else {
                $dueDate = $this->addDays($targetDate, random_int(0, 90));
            }

            $loanDate = $this->addDays($dueDate, -14);

            // 50% chance return_date is null (not returned), 50% has a return date
            $hasReturnDate = random_int(0, 1) === 1;
            $returnDate = $hasReturnDate ? $this->addDays($loanDate, random_int(1, 30)) : null;

            // is_lent: randomly 0 or 1
            $isLent = random_int(0, 1);

            $stmt = $this->db->prepare(
                "INSERT INTO loan (member_id, item_code, loan_date, due_date, return_date, is_return, is_lent)
                 VALUES (:mid, :item, :loan, :due, :ret, :is_return, :is_lent)"
            );
            $stmt->execute(array(
                'mid'       => $memberId,
                'item'      => $itemCode,
                'loan'      => $loanDate,
                'due'       => $dueDate,
                'ret'       => $returnDate,
                'is_return' => $hasReturnDate ? 1 : 0,
                'is_lent'   => $isLent,
            ));

            // Independently compute overdue condition
            if ($isOverdueDue && $returnDate === null && $isLent === 1) {
                $expected['active_overdue_count']++;
            }
        }

        return $expected;
    }

    /**
     * Delete all rows from every SLiMS table so each iteration starts fresh.
     */
    private function clearTables(): void
    {
        foreach (array('visitor_count', 'loan', 'member', 'biblio', 'item', 'fines', 'reserve') as $table) {
            $this->db->exec("DELETE FROM $table");
        }
    }

    // =========================================================================
    // Random data generators
    // =========================================================================

    /**
     * Pick a date: 40% chance it equals $targetDate, 60% chance it is a random
     * date within ±30 days of target (may still coincidentally equal target).
     *
     * @param string $targetDate 'Y-m-d' format
     * @return string 'Y-m-d' format
     */
    private function pickDate(string $targetDate): string
    {
        if (random_int(1, 10) <= 4) {
            return $targetDate;
        }

        // Random offset ±30 days, excluding 0 to ensure different date
        $offsetSign = random_int(0, 1) === 0 ? 1 : -1;
        $offsetDays = $offsetSign * random_int(1, 30);

        return $this->addDays($targetDate, $offsetDays);
    }

    /**
     * Generate a random date between $start and $end (inclusive).
     *
     * @param string $start 'Y-m-d' format
     * @param string $end   'Y-m-d' format
     * @return string 'Y-m-d' format
     */
    private function randomDate(string $start, string $end): string
    {
        $startTs = strtotime($start);
        $endTs   = strtotime($end);
        $ts      = random_int($startTs, $endTs);

        return date('Y-m-d', $ts);
    }

    /**
     * Add (or subtract) a number of days to a date string.
     *
     * @param string $date 'Y-m-d' format
     * @param int    $days Positive to add, negative to subtract
     * @return string 'Y-m-d' format
     */
    private function addDays(string $date, int $days): string
    {
        $ts = strtotime($date);
        return date('Y-m-d', $ts + $days * 86400);
    }

    /**
     * Generate a random time string 'HH:MM:SS'.
     *
     * @return string
     */
    private function randomTime(): string
    {
        $h = str_pad((string) random_int(0, 23), 2, '0', STR_PAD_LEFT);
        $m = str_pad((string) random_int(0, 59), 2, '0', STR_PAD_LEFT);
        $s = str_pad((string) random_int(0, 59), 2, '0', STR_PAD_LEFT);

        return "$h:$m:$s";
    }
}
