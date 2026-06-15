<?php
/**
 * Top Books Endpoint
 *
 * Handles POST /api/v1/nextlib/top-books requests.
 * Returns the most-borrowed titles within an optional date range.
 *
 * Request:  { "start_date"?: "YYYY-MM-DD", "end_date"?: "YYYY-MM-DD", "limit"?: int }
 * Response: { "books": [...], "period": { "start": ?, "end": ? }, "total_loans_in_period": int }
 *
 * @package    NextLib-Agent
 * @subpackage Endpoints
 * @version    1.0.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\endpoints;

class TopBooks
{
    /** @var \PDO|null Database connection (injectable for testing) */
    private $db;

    public function __construct($db = null)
    {
        $this->db = $db;
    }

    /**
     * Handle the top-books request.
     *
     * @param array $params
     *   - start_date (string, optional): inclusive YYYY-MM-DD filter on loan_date
     *   - end_date   (string, optional): inclusive YYYY-MM-DD filter on loan_date
     *   - limit      (int, optional, default 20, max 100)
     * @return array
     */
    public function handle(array $params): array
    {
        $limit = isset($params['limit']) ? (int) $params['limit'] : 20;
        if ($limit < 1) {
            $limit = 1;
        }
        if ($limit > 100) {
            $limit = 100;
        }

        $startDate = isset($params['start_date']) ? trim((string) $params['start_date']) : '';
        $endDate   = isset($params['end_date']) ? trim((string) $params['end_date']) : '';

        $db = $this->getConnection();
        if ($db === null) {
            return array(
                'error'   => true,
                'code'    => 'DB_CONNECTION_FAILED',
                'message' => 'Database connection is not available',
            );
        }

        // Build optional date filter. When omitted, the query covers all-time.
        $dateClause = '';
        $bindings = array();
        if ($startDate !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $startDate)) {
            $dateClause .= ' AND l.loan_date >= :start_date';
            $bindings[':start_date'] = $startDate;
        }
        if ($endDate !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $endDate)) {
            $dateClause .= ' AND l.loan_date <= :end_date';
            $bindings[':end_date'] = $endDate;
        }

        // GROUP_CONCAT dialect: SQLite uses a different separator syntax.
        $driver = $db->getAttribute(\PDO::ATTR_DRIVER_NAME);
        $groupConcatAuthors = $driver === 'sqlite'
            ? "GROUP_CONCAT(DISTINCT a.author_name, '; ') AS author_names"
            : "GROUP_CONCAT(DISTINCT a.author_name SEPARATOR '; ') AS author_names";

        // Top books by loan count in the period.
        $sql = "SELECT b.biblio_id, b.title, b.classification, b.isbn_issn, b.image, "
            . $groupConcatAuthors . ", "
            . "COUNT(l.loan_id) AS loan_count "
            . "FROM loan l "
            . "JOIN item i ON l.item_code = i.item_code "
            . "JOIN biblio b ON i.biblio_id = b.biblio_id "
            . "LEFT JOIN biblio_author ba ON b.biblio_id = ba.biblio_id "
            . "LEFT JOIN mst_author a ON ba.author_id = a.author_id "
            . "WHERE 1=1" . $dateClause . " "
            . "GROUP BY b.biblio_id, b.title, b.classification, b.isbn_issn, b.image "
            . "ORDER BY loan_count DESC "
            . "LIMIT :limit";

        $stmt = $db->prepare($sql);
        foreach ($bindings as $key => $value) {
            $stmt->bindValue($key, $value, \PDO::PARAM_STR);
        }
        $stmt->bindValue(':limit', $limit, \PDO::PARAM_INT);
        $stmt->execute();
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        $books = array();
        foreach ($rows as $row) {
            $books[] = array(
                'biblio_id'      => (int) $row['biblio_id'],
                'title'          => (string) $row['title'],
                'classification' => isset($row['classification']) ? (string) $row['classification'] : '',
                'isbn_issn'      => isset($row['isbn_issn']) ? (string) $row['isbn_issn'] : '',
                'author_names'   => isset($row['author_names']) ? (string) $row['author_names'] : '',
                'cover_image'    => isset($row['image']) && $row['image'] !== '' ? (string) $row['image'] : null,
                'loan_count'     => (int) $row['loan_count'],
            );
        }

        // Total loans in the same period (denominator for context).
        $totalSql = "SELECT COUNT(*) AS total FROM loan l WHERE 1=1" . $dateClause;
        $totalStmt = $db->prepare($totalSql);
        foreach ($bindings as $key => $value) {
            $totalStmt->bindValue($key, $value, \PDO::PARAM_STR);
        }
        $totalStmt->execute();
        $totalRow = $totalStmt->fetch(\PDO::FETCH_ASSOC);
        $totalLoans = (int) $totalRow['total'];

        return array(
            'books'      => $books,
            'period'     => array(
                'start' => $startDate !== '' ? $startDate : null,
                'end'   => $endDate !== '' ? $endDate : null,
            ),
            'total_loans_in_period' => $totalLoans,
        );
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
