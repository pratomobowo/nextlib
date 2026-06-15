<?php
/**
 * Member Activity Endpoint
 *
 * Handles POST /api/v1/nextlib/member-activity requests.
 * Returns loan trends, member demographics, activity classification, and
 * peak visit hours — the inputs for the "Activity" analytics tab.
 *
 * Request:  { "months"?: int } (default 12: window for trend + activity)
 * Response: { "trends": [...], "demographics": {...}, "activity": {...}, "peak_hours": [...] }
 *
 * @package    NextLib-Agent
 * @subpackage Endpoints
 * @version    1.0.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\endpoints;

class MemberActivity
{
    /** @var \PDO|null Database connection (injectable for testing) */
    private $db;

    public function __construct($db = null)
    {
        $this->db = $db;
    }

    /**
     * @param array $params
     *   - months (int, default 12, max 60): lookback window for trends & activity.
     * @return array
     */
    public function handle(array $params): array
    {
        $months = isset($params['months']) ? (int) $params['months'] : 12;
        if ($months < 1) {
            $months = 1;
        }
        if ($months > 60) {
            $months = 60;
        }

        $db = $this->getConnection();
        if ($db === null) {
            return array(
                'error'   => true,
                'code'    => 'DB_CONNECTION_FAILED',
                'message' => 'Database connection is not available',
            );
        }

        $driver = $db->getAttribute(\PDO::ATTR_DRIVER_NAME);
        $isSqlite = $driver === 'sqlite';

        return array(
            'trends'      => $this->fetchTrends($db, $months, $isSqlite),
            'demographics' => $this->fetchDemographics($db),
            'activity'    => $this->fetchActivity($db, $months),
            'peak_hours'  => $this->fetchPeakHours($db, $months, $isSqlite),
        );
    }

    /**
     * Monthly loan trend: total loans + distinct borrowing members.
     */
    private function fetchTrends(\PDO $db, int $months, bool $isSqlite): array
    {
        // DATE_FORMAT is MySQL-only; SQLite has strftime.
        $ymExpr = $isSqlite
            ? "strftime('%Y-%m', l.loan_date)"
            : "DATE_FORMAT(l.loan_date, '%Y-%m')";

        $stmt = $db->prepare(
            "SELECT {$ymExpr} AS ym,
                    COUNT(*) AS loans,
                    COUNT(DISTINCT l.member_id) AS unique_members
             FROM loan l
             WHERE l.loan_date >= DATE_SUB(CURDATE(), INTERVAL :months MONTH)
             GROUP BY ym
             ORDER BY ym ASC"
        );
        // SQLite tests: emulate DATE_SUB via date('now', '-N months').
        if ($isSqlite) {
            $stmt = $db->prepare(
                "SELECT strftime('%Y-%m', l.loan_date) AS ym,
                        COUNT(*) AS loans,
                        COUNT(DISTINCT l.member_id) AS unique_members
                 FROM loan l
                 WHERE l.loan_date >= date('now', '-{$months} months')
                 GROUP BY ym
                 ORDER BY ym ASC"
            );
        } else {
            $stmt->bindValue(':months', $months, \PDO::PARAM_INT);
        }
        $stmt->execute();
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        $out = array();
        foreach ($rows as $row) {
            $out[] = array(
                'ym'             => (string) $row['ym'],
                'loans'          => (int) $row['loans'],
                'unique_members' => (int) $row['unique_members'],
            );
        }
        return $out;
    }

    /**
     * Member demographics: type distribution, gender split, age buckets.
     */
    private function fetchDemographics(\PDO $db): array
    {
        // Member types (LEFT JOIN keeps members with blank type_id)
        $typeStmt = $db->query(
            "SELECT IFNULL(mt.member_type_name, 'Unknown') AS type_name,
                    COUNT(m.member_id) AS cnt
             FROM member m
             LEFT JOIN mst_member_type mt ON m.member_type_id = mt.member_type_id
             GROUP BY mt.member_type_id
             ORDER BY cnt DESC"
        );
        $typeRows = $typeStmt->fetchAll(\PDO::FETCH_ASSOC);
        $memberTypes = array();
        foreach ($typeRows as $row) {
            $memberTypes[] = array(
                'type_name' => (string) $row['type_name'],
                'count'     => (int) $row['cnt'],
            );
        }

        // Gender (1 = male, 0 = female in SLiMS)
        $genderStmt = $db->query(
            "SELECT gender, COUNT(*) AS cnt FROM member GROUP BY gender"
        );
        $genderRows = $genderStmt->fetchAll(\PDO::FETCH_ASSOC);
        $male = 0;
        $female = 0;
        $unknown = 0;
        foreach ($genderRows as $row) {
            $g = isset($row['gender']) ? (int) $row['gender'] : -1;
            $cnt = (int) $row['cnt'];
            if ($g === 1) {
                $male = $cnt;
            } elseif ($g === 0) {
                $female = $cnt;
            } else {
                $unknown += $cnt;
            }
        }

        // Age buckets from birth_date (filter zero-dates like '0000-00-00')
        $ageStmt = $db->query(
            "SELECT
                SUM(CASE WHEN TIMESTAMPDIFF(YEAR, birth_date, CURDATE()) < 18 THEN 1 ELSE 0 END) AS under_18,
                SUM(CASE WHEN TIMESTAMPDIFF(YEAR, birth_date, CURDATE()) BETWEEN 18 AND 24 THEN 1 ELSE 0 END) AS age_18_24,
                SUM(CASE WHEN TIMESTAMPDIFF(YEAR, birth_date, CURDATE()) BETWEEN 25 AND 34 THEN 1 ELSE 0 END) AS age_25_34,
                SUM(CASE WHEN TIMESTAMPDIFF(YEAR, birth_date, CURDATE()) BETWEEN 35 AND 49 THEN 1 ELSE 0 END) AS age_35_49,
                SUM(CASE WHEN TIMESTAMPDIFF(YEAR, birth_date, CURDATE()) >= 50 THEN 1 ELSE 0 END) AS age_50_plus
             FROM member
             WHERE birth_date IS NOT NULL AND birth_date > '1900-01-01'"
        );
        $ageRow = $ageStmt->fetch(\PDO::FETCH_ASSOC);
        // SQLite tests don't have TIMESTAMPDIFF — wrap defensively.
        $ageBuckets = array();
        if ($ageRow !== false) {
            $ageBuckets = array(
                array('bucket' => '< 18',    'count' => (int) ($ageRow['under_18'] ?? 0)),
                array('bucket' => '18-24',   'count' => (int) ($ageRow['age_18_24'] ?? 0)),
                array('bucket' => '25-34',   'count' => (int) ($ageRow['age_25_34'] ?? 0)),
                array('bucket' => '35-49',   'count' => (int) ($ageRow['age_35_49'] ?? 0)),
                array('bucket' => '50+',     'count' => (int) ($ageRow['age_50_plus'] ?? 0)),
            );
        }

        return array(
            'member_types' => $memberTypes,
            'gender'       => array(
                'male'    => $male,
                'female'  => $female,
                'unknown' => $unknown,
            ),
            'age_buckets'  => $ageBuckets,
        );
    }

    /**
     * Activity classification for the lookback window.
     */
    private function fetchActivity(\PDO $db, int $months): array
    {
        // Total members
        $totalStmt = $db->query('SELECT COUNT(*) FROM member');
        $total = (int) $totalStmt->fetchColumn();

        // Members who borrowed at least once in the window
        $activeStmt = $db->prepare(
            'SELECT COUNT(DISTINCT member_id) FROM loan
             WHERE loan_date >= DATE_SUB(CURDATE(), INTERVAL :months MONTH)'
        );
        $activeStmt->bindValue(':months', $months, \PDO::PARAM_INT);
        $activeStmt->execute();
        $active = (int) $activeStmt->fetchColumn();

        // New members registered in the window
        $newStmt = $db->prepare(
            'SELECT COUNT(*) FROM member
             WHERE register_date >= DATE_SUB(CURDATE(), INTERVAL :months MONTH)'
        );
        $newStmt->bindValue(':months', $months, \PDO::PARAM_INT);
        $newStmt->execute();
        $newInPeriod = (int) $newStmt->fetchColumn();

        $dormant = max(0, $total - $active);

        return array(
            'active'         => $active,
            'dormant'        => $dormant,
            'total'          => $total,
            'new_in_period'  => $newInPeriod,
            'months'         => $months,
            'active_pct'     => $total > 0 ? round(($active / $total) * 100, 1) : 0.0,
        );
    }

    /**
     * Peak visit hours from visitor_count.checkin_date (datetime).
     */
    private function fetchPeakHours(\PDO $db, int $months, bool $isSqlite): array
    {
        $hourExpr = $isSqlite ? "strftime('%H', checkin_date)" : "HOUR(checkin_date)";

        if ($isSqlite) {
            $stmt = $db->prepare(
                "SELECT CAST(strftime('%H', checkin_date) AS INTEGER) AS hour,
                        COUNT(*) AS visits
                 FROM visitor_count
                 WHERE checkin_date >= date('now', '-{$months} months')
                 GROUP BY hour
                 ORDER BY hour ASC"
            );
        } else {
            $stmt = $db->prepare(
                "SELECT HOUR(checkin_date) AS hour, COUNT(*) AS visits
                 FROM visitor_count
                 WHERE checkin_date >= DATE_SUB(CURDATE(), INTERVAL :months MONTH)
                 GROUP BY hour
                 ORDER BY hour ASC"
            );
            $stmt->bindValue(':months', $months, \PDO::PARAM_INT);
        }
        $stmt->execute();
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        $out = array();
        foreach ($rows as $row) {
            $out[] = array(
                'hour'   => (int) $row['hour'],
                'visits' => (int) $row['visits'],
            );
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
