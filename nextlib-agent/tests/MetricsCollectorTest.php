<?php
/**
 * Unit tests for MetricsCollector.
 *
 * Uses an in-memory SQLite database seeded with known records to verify
 * that each SQL query in collectDailyMetrics() and collectSnapshotMetrics()
 * returns values that exactly match the expected aggregates.
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\Exporter\MetricsCollector;
use PDO;

class MetricsCollectorTest extends TestCase
{
    /** @var PDO */
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
        // visitor_count table (SLiMS uses this name)
        $this->db->exec("
            CREATE TABLE visitor_count (
                visitor_id INTEGER PRIMARY KEY AUTOINCREMENT,
                member_id  VARCHAR(20),
                checkin_date DATETIME NOT NULL
            )
        ");

        // loan table
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

        // member table
        $this->db->exec("
            CREATE TABLE member (
                member_id     VARCHAR(20) PRIMARY KEY,
                register_date DATE,
                expire_date   DATE
            )
        ");

        // biblio table
        $this->db->exec("
            CREATE TABLE biblio (
                biblio_id  INTEGER PRIMARY KEY AUTOINCREMENT,
                input_date DATE
            )
        ");

        // item table
        $this->db->exec("
            CREATE TABLE item (
                item_id    INTEGER PRIMARY KEY AUTOINCREMENT,
                input_date DATE
            )
        ");

        // fines table
        $this->db->exec("
            CREATE TABLE fines (
                fines_id   INTEGER PRIMARY KEY AUTOINCREMENT,
                fines_date DATE,
                debet      INTEGER DEFAULT 0,
                credit     INTEGER DEFAULT 0
            )
        ");

        // reserve table
        $this->db->exec("
            CREATE TABLE reserve (
                reserve_id   INTEGER PRIMARY KEY AUTOINCREMENT,
                reserve_date DATE
            )
        ");
    }

    // =========================================================================
    // collectDailyMetrics() — all metrics return zero on empty tables
    // =========================================================================

    public function testCollectDailyMetricsReturnsZeroForEmptyTables(): void
    {
        $collector = new MetricsCollector($this->db);

        $metrics = $collector->collectDailyMetrics('2026-06-12');

        $this->assertSame(0, $metrics['visitor_count']);
        $this->assertSame(0, $metrics['unique_visitor_count']);
        $this->assertSame(0, $metrics['loan_count']);
        $this->assertSame(0, $metrics['return_count']);
        $this->assertSame(0, $metrics['new_member_count']);
        $this->assertSame(0, $metrics['new_biblio_count']);
        $this->assertSame(0, $metrics['new_item_count']);
        $this->assertSame(0, $metrics['fines_debet_total']);
        $this->assertSame(0, $metrics['fines_credit_total']);
        $this->assertSame(0, $metrics['reservation_count']);
    }

    public function testCollectDailyMetricsReturnsAllRequiredKeys(): void
    {
        $collector = new MetricsCollector($this->db);

        $metrics = $collector->collectDailyMetrics('2026-06-12');

        $this->assertArrayHasKey('visitor_count', $metrics);
        $this->assertArrayHasKey('unique_visitor_count', $metrics);
        $this->assertArrayHasKey('loan_count', $metrics);
        $this->assertArrayHasKey('return_count', $metrics);
        $this->assertArrayHasKey('new_member_count', $metrics);
        $this->assertArrayHasKey('new_biblio_count', $metrics);
        $this->assertArrayHasKey('new_item_count', $metrics);
        $this->assertArrayHasKey('fines_debet_total', $metrics);
        $this->assertArrayHasKey('fines_credit_total', $metrics);
        $this->assertArrayHasKey('reservation_count', $metrics);
    }

    // =========================================================================
    // visitor_count (Requirement 1.1)
    // =========================================================================

    public function testVisitorCountMatchesCheckinsOnTargetDate(): void
    {
        $this->insertVisitor('M001', '2026-06-12 08:00:00');
        $this->insertVisitor('M002', '2026-06-12 09:30:00');
        $this->insertVisitor('M003', '2026-06-12 14:00:00');
        $this->insertVisitor('M004', '2026-06-11 10:00:00'); // different date

        $collector = new MetricsCollector($this->db);
        $metrics = $collector->collectDailyMetrics('2026-06-12');

        $this->assertSame(3, $metrics['visitor_count']);
    }

    public function testVisitorCountExcludesOtherDates(): void
    {
        $this->insertVisitor('M001', '2026-06-11 08:00:00');
        $this->insertVisitor('M002', '2026-06-13 09:00:00');

        $collector = new MetricsCollector($this->db);
        $metrics = $collector->collectDailyMetrics('2026-06-12');

        $this->assertSame(0, $metrics['visitor_count']);
    }

    // =========================================================================
    // unique_visitor_count (Requirement 1.2)
    // =========================================================================

    public function testUniqueVisitorCountDeduplicatesMemberId(): void
    {
        // Member M001 checks in twice on the same day
        $this->insertVisitor('M001', '2026-06-12 08:00:00');
        $this->insertVisitor('M001', '2026-06-12 13:00:00');
        $this->insertVisitor('M002', '2026-06-12 09:00:00');
        $this->insertVisitor('M003', '2026-06-12 11:00:00');

        $collector = new MetricsCollector($this->db);
        $metrics = $collector->collectDailyMetrics('2026-06-12');

        $this->assertSame(4, $metrics['visitor_count']);      // total check-ins
        $this->assertSame(3, $metrics['unique_visitor_count']); // distinct members
    }

    public function testUniqueVisitorCountEqualsVisitorCountWhenAllUnique(): void
    {
        $this->insertVisitor('M001', '2026-06-12 08:00:00');
        $this->insertVisitor('M002', '2026-06-12 09:00:00');

        $collector = new MetricsCollector($this->db);
        $metrics = $collector->collectDailyMetrics('2026-06-12');

        $this->assertSame(2, $metrics['visitor_count']);
        $this->assertSame(2, $metrics['unique_visitor_count']);
    }

    // =========================================================================
    // loan_count (Requirement 1.3)
    // =========================================================================

    public function testLoanCountMatchesNewLoansOnTargetDate(): void
    {
        $this->insertLoan('M001', '2026-06-12', null, 0, 1);
        $this->insertLoan('M002', '2026-06-12', null, 0, 1);
        $this->insertLoan('M003', '2026-06-11', null, 0, 1); // different date

        $collector = new MetricsCollector($this->db);
        $metrics = $collector->collectDailyMetrics('2026-06-12');

        $this->assertSame(2, $metrics['loan_count']);
    }

    // =========================================================================
    // return_count (Requirement 1.4)
    // =========================================================================

    public function testReturnCountMatchesReturnsOnTargetDate(): void
    {
        // Returned on target date with is_return=1
        $this->insertLoan('M001', '2026-06-01', '2026-06-12', 1, 0);
        $this->insertLoan('M002', '2026-06-02', '2026-06-12', 1, 0);
        // Returned on different date
        $this->insertLoan('M003', '2026-06-01', '2026-06-11', 1, 0);
        // Return date matches but is_return=0 (not counted)
        $this->insertLoan('M004', '2026-06-01', '2026-06-12', 0, 1);

        $collector = new MetricsCollector($this->db);
        $metrics = $collector->collectDailyMetrics('2026-06-12');

        $this->assertSame(2, $metrics['return_count']);
    }

    public function testReturnCountOnlyCountsIsReturnFlag(): void
    {
        // is_return = 0 even though return_date is set — should not count
        $this->insertLoan('M001', '2026-06-01', '2026-06-12', 0, 1);

        $collector = new MetricsCollector($this->db);
        $metrics = $collector->collectDailyMetrics('2026-06-12');

        $this->assertSame(0, $metrics['return_count']);
    }

    // =========================================================================
    // new_member_count (Requirement 1.5)
    // =========================================================================

    public function testNewMemberCountMatchesRegistrationsOnTargetDate(): void
    {
        $this->insertMember('M001', '2026-06-12', '2027-06-12');
        $this->insertMember('M002', '2026-06-12', '2027-06-12');
        $this->insertMember('M003', '2026-06-11', '2027-06-11'); // different date

        $collector = new MetricsCollector($this->db);
        $metrics = $collector->collectDailyMetrics('2026-06-12');

        $this->assertSame(2, $metrics['new_member_count']);
    }

    // =========================================================================
    // new_biblio_count (Requirement 1.6)
    // =========================================================================

    public function testNewBiblioCountMatchesRecordsOnTargetDate(): void
    {
        $this->insertBiblio('2026-06-12');
        $this->insertBiblio('2026-06-12');
        $this->insertBiblio('2026-06-12');
        $this->insertBiblio('2026-06-11'); // different date

        $collector = new MetricsCollector($this->db);
        $metrics = $collector->collectDailyMetrics('2026-06-12');

        $this->assertSame(3, $metrics['new_biblio_count']);
    }

    // =========================================================================
    // new_item_count (Requirement 1.7)
    // =========================================================================

    public function testNewItemCountMatchesItemsOnTargetDate(): void
    {
        $this->insertItem('2026-06-12');
        $this->insertItem('2026-06-12');
        $this->insertItem('2026-06-13'); // different date

        $collector = new MetricsCollector($this->db);
        $metrics = $collector->collectDailyMetrics('2026-06-12');

        $this->assertSame(2, $metrics['new_item_count']);
    }

    // =========================================================================
    // fines_debet_total (Requirement 1.8)
    // =========================================================================

    public function testFinesDebetTotalSumsDebetOnTargetDate(): void
    {
        $this->insertFine('2026-06-12', 5000, 0);
        $this->insertFine('2026-06-12', 10000, 0);
        $this->insertFine('2026-06-11', 3000, 0); // different date

        $collector = new MetricsCollector($this->db);
        $metrics = $collector->collectDailyMetrics('2026-06-12');

        $this->assertSame(15000, $metrics['fines_debet_total']);
    }

    public function testFinesDebetTotalReturnsZeroWhenNoFines(): void
    {
        $collector = new MetricsCollector($this->db);
        $metrics = $collector->collectDailyMetrics('2026-06-12');

        $this->assertSame(0, $metrics['fines_debet_total']);
    }

    public function testFinesDebetTotalIsIntegerType(): void
    {
        $this->insertFine('2026-06-12', 7500, 0);

        $collector = new MetricsCollector($this->db);
        $metrics = $collector->collectDailyMetrics('2026-06-12');

        $this->assertIsInt($metrics['fines_debet_total']);
    }

    // =========================================================================
    // fines_credit_total (Requirement 1.9)
    // =========================================================================

    public function testFinesCreditTotalSumsCreditOnTargetDate(): void
    {
        $this->insertFine('2026-06-12', 0, 5000);
        $this->insertFine('2026-06-12', 0, 8000);
        $this->insertFine('2026-06-11', 0, 2000); // different date

        $collector = new MetricsCollector($this->db);
        $metrics = $collector->collectDailyMetrics('2026-06-12');

        $this->assertSame(13000, $metrics['fines_credit_total']);
    }

    public function testFinesDebetAndCreditAreTrackedSeparately(): void
    {
        $this->insertFine('2026-06-12', 5000, 3000);

        $collector = new MetricsCollector($this->db);
        $metrics = $collector->collectDailyMetrics('2026-06-12');

        $this->assertSame(5000, $metrics['fines_debet_total']);
        $this->assertSame(3000, $metrics['fines_credit_total']);
    }

    // =========================================================================
    // reservation_count (Requirement 1.10)
    // =========================================================================

    public function testReservationCountMatchesReservationsOnTargetDate(): void
    {
        $this->insertReservation('2026-06-12');
        $this->insertReservation('2026-06-12');
        $this->insertReservation('2026-06-12');
        $this->insertReservation('2026-06-11'); // different date

        $collector = new MetricsCollector($this->db);
        $metrics = $collector->collectDailyMetrics('2026-06-12');

        $this->assertSame(3, $metrics['reservation_count']);
    }

    // =========================================================================
    // collectSnapshotMetrics() (Requirements 2.1, 2.2, 2.3)
    // =========================================================================

    public function testCollectSnapshotMetricsReturnsZeroForEmptyTables(): void
    {
        $collector = new MetricsCollector($this->db);
        $snapshot = $collector->collectSnapshotMetrics('2026-06-12');

        $this->assertSame(0, $snapshot['total_collection_size']);
        $this->assertSame(0, $snapshot['active_member_count']);
        $this->assertSame(0, $snapshot['active_overdue_count']);
    }

    public function testCollectSnapshotMetricsReturnsAllRequiredKeys(): void
    {
        $collector = new MetricsCollector($this->db);
        $snapshot = $collector->collectSnapshotMetrics('2026-06-12');

        $this->assertArrayHasKey('total_collection_size', $snapshot);
        $this->assertArrayHasKey('active_member_count', $snapshot);
        $this->assertArrayHasKey('active_overdue_count', $snapshot);
    }

    public function testTotalCollectionSizeCountsAllItems(): void
    {
        // total_collection_size has no date filter
        $this->insertItem('2024-01-01');
        $this->insertItem('2025-03-15');
        $this->insertItem('2026-06-12');

        $collector = new MetricsCollector($this->db);
        $snapshot = $collector->collectSnapshotMetrics('2026-06-12');

        $this->assertSame(3, $snapshot['total_collection_size']);
    }

    public function testActiveMemberCountExcludesExpiredMembers(): void
    {
        // Active: expire_date >= target_date
        $this->insertMember('M001', '2025-01-01', '2026-12-31');
        $this->insertMember('M002', '2025-01-01', '2026-06-12'); // expires on target date (still active)
        // Expired: expire_date < target_date
        $this->insertMember('M003', '2025-01-01', '2026-06-11');
        $this->insertMember('M004', '2025-01-01', '2025-12-31');

        $collector = new MetricsCollector($this->db);
        $snapshot = $collector->collectSnapshotMetrics('2026-06-12');

        $this->assertSame(2, $snapshot['active_member_count']);
    }

    public function testActiveOverdueCountOnlyCountsUnreturnedOverdueLoans(): void
    {
        // Overdue and not returned (due_date < target, return_date IS NULL, is_lent=1)
        $this->insertOverdueLoan('M001', '2026-06-10', null, 1);
        $this->insertOverdueLoan('M002', '2026-06-11', null, 1);
        // Not overdue (due_date >= target_date)
        $this->insertOverdueLoan('M003', '2026-06-13', null, 1);
        // Overdue but already returned
        $this->insertOverdueLoan('M004', '2026-06-10', '2026-06-11', 0);
        // Overdue but is_lent=0
        $this->insertOverdueLoan('M005', '2026-06-10', null, 0);

        $collector = new MetricsCollector($this->db);
        $snapshot = $collector->collectSnapshotMetrics('2026-06-12');

        $this->assertSame(2, $snapshot['active_overdue_count']);
    }

    // =========================================================================
    // All values are integer type
    // =========================================================================

    public function testAllDailyMetricValuesAreIntegers(): void
    {
        $this->insertVisitor('M001', '2026-06-12 08:00:00');
        $this->insertFine('2026-06-12', 5000, 3000);

        $collector = new MetricsCollector($this->db);
        $metrics = $collector->collectDailyMetrics('2026-06-12');

        foreach ($metrics as $key => $value) {
            $this->assertIsInt($value, "Metric '$key' should be an integer");
        }
    }

    public function testAllSnapshotMetricValuesAreIntegers(): void
    {
        $this->insertItem('2026-06-12');
        $this->insertMember('M001', '2025-01-01', '2027-01-01');

        $collector = new MetricsCollector($this->db);
        $snapshot = $collector->collectSnapshotMetrics('2026-06-12');

        foreach ($snapshot as $key => $value) {
            $this->assertIsInt($value, "Snapshot metric '$key' should be an integer");
        }
    }

    // =========================================================================
    // Date isolation: metrics for one date do not affect another date
    // =========================================================================

    public function testDailyMetricsAreIsolatedByDate(): void
    {
        // Seed data for multiple dates
        $this->insertVisitor('M001', '2026-06-10 08:00:00');
        $this->insertVisitor('M002', '2026-06-11 08:00:00');
        $this->insertVisitor('M003', '2026-06-12 08:00:00');
        $this->insertVisitor('M004', '2026-06-12 09:00:00');

        $collector = new MetricsCollector($this->db);

        $metricsJun10 = $collector->collectDailyMetrics('2026-06-10');
        $metricsJun11 = $collector->collectDailyMetrics('2026-06-11');
        $metricsJun12 = $collector->collectDailyMetrics('2026-06-12');

        $this->assertSame(1, $metricsJun10['visitor_count']);
        $this->assertSame(1, $metricsJun11['visitor_count']);
        $this->assertSame(2, $metricsJun12['visitor_count']);
    }

    // =========================================================================
    // Helper methods
    // =========================================================================

    private function insertVisitor(string $memberId, string $checkinDate): void
    {
        $stmt = $this->db->prepare(
            "INSERT INTO visitor_count (member_id, checkin_date) VALUES (:mid, :date)"
        );
        $stmt->execute(array('mid' => $memberId, 'date' => $checkinDate));
    }

    private function insertLoan(
        string $memberId,
        string $loanDate,
        ?string $returnDate,
        int $isReturn,
        int $isLent
    ): void {
        $stmt = $this->db->prepare(
            "INSERT INTO loan (member_id, item_code, loan_date, due_date, return_date, is_return, is_lent)
             VALUES (:mid, :item, :loan, :due, :ret, :is_return, :is_lent)"
        );
        $stmt->execute(array(
            'mid'       => $memberId,
            'item'      => 'B' . rand(10000, 99999),
            'loan'      => $loanDate,
            'due'       => date('Y-m-d', strtotime($loanDate . ' +14 days')),
            'ret'       => $returnDate,
            'is_return' => $isReturn,
            'is_lent'   => $isLent,
        ));
    }

    private function insertMember(string $memberId, string $registerDate, string $expireDate): void
    {
        $stmt = $this->db->prepare(
            "INSERT INTO member (member_id, register_date, expire_date) VALUES (:mid, :reg, :exp)"
        );
        $stmt->execute(array('mid' => $memberId, 'reg' => $registerDate, 'exp' => $expireDate));
    }

    private function insertBiblio(string $inputDate): void
    {
        $stmt = $this->db->prepare("INSERT INTO biblio (input_date) VALUES (:date)");
        $stmt->execute(array('date' => $inputDate));
    }

    private function insertItem(string $inputDate): void
    {
        $stmt = $this->db->prepare("INSERT INTO item (input_date) VALUES (:date)");
        $stmt->execute(array('date' => $inputDate));
    }

    private function insertFine(string $finesDate, int $debet, int $credit): void
    {
        $stmt = $this->db->prepare(
            "INSERT INTO fines (fines_date, debet, credit) VALUES (:date, :debet, :credit)"
        );
        $stmt->execute(array('date' => $finesDate, 'debet' => $debet, 'credit' => $credit));
    }

    private function insertReservation(string $reserveDate): void
    {
        $stmt = $this->db->prepare("INSERT INTO reserve (reserve_date) VALUES (:date)");
        $stmt->execute(array('date' => $reserveDate));
    }

    private function insertOverdueLoan(
        string $memberId,
        string $dueDate,
        ?string $returnDate,
        int $isLent
    ): void {
        $stmt = $this->db->prepare(
            "INSERT INTO loan (member_id, item_code, loan_date, due_date, return_date, is_return, is_lent)
             VALUES (:mid, :item, :loan, :due, :ret, :is_return, :is_lent)"
        );
        $stmt->execute(array(
            'mid'       => $memberId,
            'item'      => 'B' . rand(10000, 99999),
            'loan'      => date('Y-m-d', strtotime($dueDate . ' -14 days')),
            'due'       => $dueDate,
            'ret'       => $returnDate,
            'is_return' => $returnDate !== null ? 1 : 0,
            'is_lent'   => $isLent,
        ));
    }
}
