<?php
/**
 * Daily Aggregate Endpoint
 *
 * Handles POST /api/v1/nextlib/daily-aggregate requests.
 * Returns daily metrics for a date range in v1/v2 schema format.
 * Uses SLiMS's $dbs global (no plugin-side DB credentials).
 *
 * Request:  { "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" }
 * Response: { "schema_version": "2.0", "days": [...], ... }
 *
 * @package    NextLib-Agent
 * @subpackage Endpoints
 * @version    2.2.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\endpoints;

class DailyAggregate
{
    const MAX_RANGE_DAYS = 366;

    private $db;

    public function __construct($db = null)
    {
        $this->db = $db;
    }

    public function handle(array $params): array
    {
        $startDate = isset($params['start_date']) ? trim((string) $params['start_date']) : '';
        $endDate   = isset($params['end_date']) ? trim((string) $params['end_date']) : '';
        $validation = $this->validateRange($startDate, $endDate);
        if ($validation !== null) {
            return $validation;
        }

        $db = $this->getConnection();
        if ($db === null) {
            return array(
                'error'   => true,
                'code'    => 'DB_CONNECTION_FAILED',
                'message' => 'Database connection is not available',
            );
        }

        $snapshot = $this->computeSnapshotMetrics($db, $endDate);
        $dates = $this->enumerateDates($startDate, $endDate);

        $days = array();
        foreach ($dates as $date) {
            $daily = $this->computeDailyMetricsForDate($db, $date);
            if (!$this->dayHasActivity($daily)) {
                continue;
            }
            $days[] = array(
                'date'            => $date,
                'daily_metrics'   => $daily,
                'snapshot_metrics' => $snapshot,
                'anomaly_flags'   => array(),
            );
        }

        return array(
            'schema_version' => '2.0',
            'start_date'     => $startDate,
            'end_date'       => $endDate,
            'days'           => $days,
        );
    }

    private function validateRange(string $startDate, string $endDate): ?array
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $startDate) ||
            !preg_match('/^\d{4}-\d{2}-\d{2}$/', $endDate)) {
            return array(
                'error' => true,
                'code'  => 'INVALID_DATE_RANGE',
                'message' => 'Dates must be in YYYY-MM-DD format',
            );
        }
        try {
            $s = new \DateTimeImmutable($startDate);
            $e = new \DateTimeImmutable($endDate);
        } catch (\Exception $e) {
            return array(
                'error' => true,
                'code'  => 'INVALID_DATE_RANGE',
                'message' => 'Dates must be valid calendar dates',
            );
        }
        if ($s > $e) {
            return array(
                'error' => true,
                'code'  => 'INVALID_DATE_RANGE',
                'message' => 'start_date must be <= end_date',
            );
        }
        $diff = $s->diff($e)->days;
        if ($diff > self::MAX_RANGE_DAYS) {
            return array(
                'error' => true,
                'code'  => 'INVALID_DATE_RANGE',
                'message' => 'Range must be <= ' . self::MAX_RANGE_DAYS . ' days',
            );
        }
        return null;
    }

    private function dayHasActivity(array $daily): bool
    {
        $activityKeys = array(
            'visitor_count',
            'unique_visitor_count',
            'loan_count',
            'return_count',
            'new_member_count',
            'new_biblio_count',
            'new_item_count',
            'reservation_count',
        );
        foreach ($activityKeys as $key) {
            if (isset($daily[$key]) && $daily[$key] > 0) {
                return true;
            }
        }
        return false;
    }

    private function computeDailyMetricsForDate(\PDO $db, string $date): array
    {
        $stmt = $db->prepare("SELECT COUNT(*) FROM visitor_log WHERE checkin_date = :d");
        $stmt->execute([':d' => $date]);
        $visitorCount = (int) $stmt->fetchColumn();

        $stmt = $db->prepare("SELECT COUNT(DISTINCT member_id) FROM visitor_log WHERE checkin_date = :d AND member_id IS NOT NULL");
        $stmt->execute([':d' => $date]);
        $uniqueVisitorCount = (int) $stmt->fetchColumn();

        $stmt = $db->prepare("SELECT COUNT(*) FROM loan WHERE loan_date = :d");
        $stmt->execute([':d' => $date]);
        $loanCount = (int) $stmt->fetchColumn();

        $stmt = $db->prepare("SELECT COUNT(*) FROM loan WHERE return_date = :d");
        $stmt->execute([':d' => $date]);
        $returnCount = (int) $stmt->fetchColumn();

        $stmt = $db->prepare("SELECT COUNT(*) FROM member WHERE register_date = :d");
        $stmt->execute([':d' => $date]);
        $newMemberCount = (int) $stmt->fetchColumn();

        $stmt = $db->prepare("SELECT COUNT(*) FROM biblio WHERE input_date = :d");
        $stmt->execute([':d' => $date]);
        $newBiblioCount = (int) $stmt->fetchColumn();

        $stmt = $db->prepare("SELECT COUNT(*) FROM item WHERE input_date = :d");
        $stmt->execute([':d' => $date]);
        $newItemCount = (int) $stmt->fetchColumn();

        return array(
            'visitor_count'        => $visitorCount,
            'unique_visitor_count' => $uniqueVisitorCount,
            'loan_count'           => $loanCount,
            'return_count'         => $returnCount,
            'new_member_count'     => $newMemberCount,
            'new_biblio_count'     => $newBiblioCount,
            'new_item_count'       => $newItemCount,
            'fines_debet_total'    => 0,
            'fines_credit_total'   => 0,
            'reservation_count'    => 0,
        );
    }

    private function computeSnapshotMetrics(\PDO $db, string $asOfDate): array
    {
        $stmt = $db->query("SELECT COUNT(*) FROM item");
        $totalCollectionSize = (int) $stmt->fetchColumn();

        $stmt = $db->prepare("
            SELECT COUNT(DISTINCT member_id) FROM loan
            WHERE loan_date >= date(:d, '-365 days') AND member_id IS NOT NULL
        ");
        $stmt->execute([':d' => $asOfDate]);
        $activeMemberCount = (int) $stmt->fetchColumn();

        $stmt = $db->prepare("
            SELECT COUNT(*) FROM loan
            WHERE loan_date < :d AND return_date IS NULL
        ");
        $stmt->execute([':d' => $asOfDate]);
        $activeOverdueCount = (int) $stmt->fetchColumn();

        return array(
            'total_collection_size' => $totalCollectionSize,
            'active_member_count'   => $activeMemberCount,
            'active_overdue_count'  => $activeOverdueCount,
        );
    }

    private function enumerateDates(string $start, string $end): array
    {
        $out = array();
        $s = new \DateTimeImmutable($start);
        $e = new \DateTimeImmutable($end);
        for ($d = $s; $d <= $e; $d = $d->modify('+1 day')) {
            $out[] = $d->format('Y-m-d');
        }
        return $out;
    }

    private function getConnection()
    {
        if ($this->db !== null) {
            return $this->db;
        }
        global $dbs;
        if (isset($dbs) && $dbs instanceof \PDO) {
            return $dbs;
        }
        return null;
    }
}
