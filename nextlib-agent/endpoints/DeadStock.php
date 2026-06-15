<?php
/**
 * Dead Stock Endpoint
 *
 * Handles POST /api/v1/nextlib/dead-stock requests.
 * Identifies items that are never borrowed or idle beyond a threshold —
 * useful for collection weeding / culling decisions.
 *
 * Request:  { "months_idle"?: int, "limit"?: int, "include_never"?: bool }
 * Response: { "items": [...], "summary": {...} }
 *
 * @package    NextLib-Agent
 * @subpackage Endpoints
 * @version    1.0.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\endpoints;

class DeadStock
{
    /** @var \PDO|null Database connection (injectable for testing) */
    private $db;

    public function __construct($db = null)
    {
        $this->db = $db;
    }

    /**
     * @param array $params
     *   - months_idle  (int, default 12): an item whose last loan is older than
     *     this many months is considered "idle".
     *   - limit        (int, default 50, max 500)
     *   - include_never (bool, default true): include items that were never loaned at all.
     * @return array
     */
    public function handle(array $params): array
    {
        $monthsIdle = isset($params['months_idle']) ? (int) $params['months_idle'] : 12;
        if ($monthsIdle < 1) {
            $monthsIdle = 1;
        }
        if ($monthsIdle > 120) {
            $monthsIdle = 120; // cap at 10 years
        }

        $limit = isset($params['limit']) ? (int) $params['limit'] : 50;
        if ($limit < 1) {
            $limit = 1;
        }
        if ($limit > 500) {
            $limit = 500;
        }

        $includeNever = isset($params['include_never'])
            ? filter_var($params['include_never'], FILTER_VALIDATE_BOOLEAN)
            : true;

        $db = $this->getConnection();
        if ($db === null) {
            return array(
                'error'   => true,
                'code'    => 'DB_CONNECTION_FAILED',
                'message' => 'Database connection is not available',
            );
        }

        // Per-item last loan date, joined with biblio for the title.
        // An item is "dead" if it was never loaned OR its last loan is older
        // than months_idle months ago.
        $neverCondition = $includeNever ? 'OR last_loan IS NULL' : '';
        $sql = "SELECT i.item_code, i.biblio_id, b.title, b.classification,
                       last.last_loan AS last_loan_date
                FROM item i
                JOIN biblio b ON i.biblio_id = b.biblio_id
                LEFT JOIN (
                    SELECT item_code, MAX(loan_date) AS last_loan
                    FROM loan GROUP BY item_code
                ) last ON last.item_code = i.item_code
                WHERE (last.last_loan < DATE_SUB(CURDATE(), INTERVAL :months MONTH) {$neverCondition})
                ORDER BY last.last_loan ASC
                LIMIT :limit";

        $stmt = $db->prepare($sql);
        $stmt->bindValue(':months', $monthsIdle, \PDO::PARAM_INT);
        $stmt->bindValue(':limit', $limit, \PDO::PARAM_INT);
        $stmt->execute();
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        $items = array();
        foreach ($rows as $row) {
            $lastLoan = isset($row['last_loan_date']) ? (string) $row['last_loan_date'] : null;
            // Compute idle months for display. Never-borrowed items get null.
            $idleMonths = null;
            $status = 'never';
            if ($lastLoan !== null) {
                $status = 'idle';
                $idleMonths = $this->monthsSince($lastLoan);
            }
            $items[] = array(
                'item_code'     => (string) $row['item_code'],
                'biblio_id'     => (int) $row['biblio_id'],
                'title'         => (string) $row['title'],
                'classification' => isset($row['classification']) ? (string) $row['classification'] : '',
                'last_loan_date' => $lastLoan,
                'status'         => $status,
                'idle_months'    => $idleMonths,
            );
        }

        // Summary counts (independent of the limited items list).
        $summary = $this->computeSummary($db, $monthsIdle);

        return array(
            'items'   => $items,
            'summary' => $summary,
        );
    }

    /**
     * Compute summary counts for the dead-stock overview cards.
     */
    private function computeSummary(\PDO $db, int $monthsIdle): array
    {
        // Total items in the collection
        $totalStmt = $db->query('SELECT COUNT(*) FROM item');
        $totalItems = (int) $totalStmt->fetchColumn();

        // Items never loaned at all
        $neverStmt = $db->query(
            'SELECT COUNT(*) FROM item i WHERE NOT EXISTS '
            . '(SELECT 1 FROM loan l WHERE l.item_code = i.item_code)'
        );
        $neverBorrowed = (int) $neverStmt->fetchColumn();

        // Items idle beyond the threshold (loaned at least once but stale)
        $idleStmt = $db->prepare(
            'SELECT COUNT(*) FROM item i '
            . 'JOIN (SELECT item_code, MAX(loan_date) AS last_loan FROM loan GROUP BY item_code) x '
            . 'ON x.item_code = i.item_code '
            . 'WHERE x.last_loan < DATE_SUB(CURDATE(), INTERVAL :months MONTH)'
        );
        $idleStmt->bindValue(':months', $monthsIdle, \PDO::PARAM_INT);
        $idleStmt->execute();
        $idleCount = (int) $idleStmt->fetchColumn();

        $totalDead = $neverBorrowed + $idleCount;
        $percentage = $totalItems > 0 ? round(($totalDead / $totalItems) * 100, 1) : 0.0;

        return array(
            'total_dead'     => $totalDead,
            'never_borrowed' => $neverBorrowed,
            'idle_count'     => $idleCount,
            'total_items'    => $totalItems,
            'percentage'     => $percentage,
            'months_idle'    => $monthsIdle,
        );
    }

    /**
     * Whole-months difference between a past date and today.
     */
    private function monthsSince(string $dateStr): ?int
    {
        $ts = strtotime($dateStr);
        if ($ts === false) {
            return null;
        }
        $diff = (int) floor((time() - $ts) / (30 * 86400));
        return $diff > 0 ? $diff : 0;
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
