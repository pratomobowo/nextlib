<?php
/**
 * Metrics Collector
 *
 * Collects all aggregate metrics from the SLiMS database for a given date.
 * Provides two categories of metrics:
 *   - Daily metrics: activity-based counts for a specific target date
 *   - Snapshot metrics: point-in-time state of the library as of the target date
 *
 * Privacy: Only aggregate statistics are collected. No PII is included.
 *
 * @package    NextLib-Agent
 * @subpackage Exporter
 * @version    2.0.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\Exporter;

use PDO;

class MetricsCollector
{
    /**
     * @var PDO Database connection to SLiMS
     */
    private $db;

    /**
     * @param PDO $db Database connection to SLiMS
     */
    public function __construct(PDO $db)
    {
        $this->db = $db;
    }

    /**
     * Collect all daily metrics for a target date.
     *
     * Executes 10 parameterized SQL queries against SLiMS tables to produce
     * aggregate counts and monetary sums for the given date. All values are
     * returned as integers (monetary totals use COALESCE to handle NULL).
     *
     * @param string $targetDate Date in 'Y-m-d' format
     * @return array{
     *   visitor_count: int,
     *   unique_visitor_count: int,
     *   loan_count: int,
     *   return_count: int,
     *   new_member_count: int,
     *   new_biblio_count: int,
     *   new_item_count: int,
     *   fines_debet_total: int,
     *   fines_credit_total: int,
     *   reservation_count: int
     * }
     */
    public function collectDailyMetrics(string $targetDate): array
    {
        // visitor_count: total checkin on target date
        $visitorCount = $this->queryCount(
            "SELECT COUNT(*) FROM visitor_count WHERE DATE(checkin_date) = :target_date",
            $targetDate
        );

        // unique_visitor_count: distinct members on target date
        $uniqueVisitorCount = $this->queryCount(
            "SELECT COUNT(DISTINCT member_id) FROM visitor_count WHERE DATE(checkin_date) = :target_date",
            $targetDate
        );

        // loan_count: new loans on target date
        $loanCount = $this->queryCount(
            "SELECT COUNT(*) FROM loan WHERE DATE(loan_date) = :target_date",
            $targetDate
        );

        // return_count: returns on target date
        $returnCount = $this->queryCount(
            "SELECT COUNT(*) FROM loan WHERE DATE(return_date) = :target_date AND is_return = 1",
            $targetDate
        );

        // new_member_count: new members registered on target date
        $newMemberCount = $this->queryCount(
            "SELECT COUNT(*) FROM member WHERE DATE(register_date) = :target_date",
            $targetDate
        );

        // new_biblio_count: new bibliographic records on target date
        $newBiblioCount = $this->queryCount(
            "SELECT COUNT(*) FROM biblio WHERE DATE(input_date) = :target_date",
            $targetDate
        );

        // new_item_count: new items/copies on target date
        $newItemCount = $this->queryCount(
            "SELECT COUNT(*) FROM item WHERE DATE(input_date) = :target_date",
            $targetDate
        );

        // fines_debet_total: total fines charged on target date
        $finesDebetTotal = $this->queryScalar(
            "SELECT COALESCE(SUM(debet), 0) FROM fines WHERE DATE(fines_date) = :target_date",
            $targetDate
        );

        // fines_credit_total: total fines paid on target date
        $finesCreditTotal = $this->queryScalar(
            "SELECT COALESCE(SUM(credit), 0) FROM fines WHERE DATE(fines_date) = :target_date",
            $targetDate
        );

        // reservation_count: reservations on target date
        $reservationCount = $this->queryCount(
            "SELECT COUNT(*) FROM reserve WHERE DATE(reserve_date) = :target_date",
            $targetDate
        );

        return array(
            'visitor_count'       => $visitorCount,
            'unique_visitor_count' => $uniqueVisitorCount,
            'loan_count'          => $loanCount,
            'return_count'        => $returnCount,
            'new_member_count'    => $newMemberCount,
            'new_biblio_count'    => $newBiblioCount,
            'new_item_count'      => $newItemCount,
            'fines_debet_total'   => $finesDebetTotal,
            'fines_credit_total'  => $finesCreditTotal,
            'reservation_count'   => $reservationCount,
        );
    }

    /**
     * Collect snapshot metrics (point-in-time state of the library).
     *
     * Unlike daily metrics, snapshot metrics reflect the current state of the
     * library as of the target date rather than activity on that specific day.
     *
     * @param string $targetDate Date in 'Y-m-d' format
     * @return array{
     *   total_collection_size: int,
     *   active_member_count: int,
     *   active_overdue_count: int
     * }
     */
    public function collectSnapshotMetrics(string $targetDate): array
    {
        // total_collection_size: total items in library (no date filter)
        $totalCollectionSize = $this->queryCountNoDate(
            "SELECT COUNT(*) FROM item"
        );

        // active_member_count: members whose membership has not expired as of target date
        $activeMemberCount = $this->queryCount(
            "SELECT COUNT(*) FROM member WHERE expire_date >= :target_date",
            $targetDate
        );

        // active_overdue_count: loans past due date and not yet returned
        $activeOverdueCount = $this->queryCount(
            "SELECT COUNT(*) FROM loan WHERE due_date < :target_date AND return_date IS NULL AND is_lent = 1",
            $targetDate
        );

        return array(
            'total_collection_size' => $totalCollectionSize,
            'active_member_count'   => $activeMemberCount,
            'active_overdue_count'  => $activeOverdueCount,
        );
    }

    /**
     * Execute a COUNT query with a :target_date parameter.
     *
     * @param string $sql        SQL query with :target_date placeholder
     * @param string $targetDate Date in 'Y-m-d' format
     * @return int The count result
     */
    private function queryCount(string $sql, string $targetDate): int
    {
        $stmt = $this->db->prepare($sql);
        $stmt->execute(array('target_date' => $targetDate));
        $result = $stmt->fetchColumn();

        return $result !== false ? (int) $result : 0;
    }

    /**
     * Execute a scalar query with a :target_date parameter and return integer result.
     *
     * Suitable for monetary totals that use COALESCE with SUM and a zero default.
     *
     * @param string $sql        SQL query with :target_date placeholder
     * @param string $targetDate Date in 'Y-m-d' format
     * @return int The scalar result cast to integer
     */
    private function queryScalar(string $sql, string $targetDate): int
    {
        $stmt = $this->db->prepare($sql);
        $stmt->execute(array('target_date' => $targetDate));
        $result = $stmt->fetchColumn();

        return $result !== false ? (int) $result : 0;
    }

    /**
     * Execute a COUNT query with no date parameter (for snapshot totals).
     *
     * @param string $sql SQL query with no parameters
     * @return int The count result
     */
    private function queryCountNoDate(string $sql): int
    {
        $stmt = $this->db->prepare($sql);
        $stmt->execute();
        $result = $stmt->fetchColumn();

        return $result !== false ? (int) $result : 0;
    }
}
