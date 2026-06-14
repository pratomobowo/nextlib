<?php
/**
 * Search Book Endpoint
 *
 * Handles POST /api/v1/nextlib/search-book requests.
 * Queries the SLiMS biblio table for real-time book search.
 *
 * Request:  { "query": string, "limit": int }
 * Response: { "results": Book[], "total": int }
 *
 * @package    NextLib-Agent
 * @subpackage Endpoints
 * @version    1.0.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\endpoints;

class SearchBook
{
    /** @var \PDO|null Database connection (injectable for testing) */
    private $db;

    /**
     * @param \PDO|null $db Optional PDO connection. If null, uses SLiMS global $dbs.
     */
    public function __construct($db = null)
    {
        $this->db = $db;
    }

    /**
     * Handle the search book request.
     *
     * Searches the SLiMS biblio table by title and author fields
     * using a LIKE query and returns matching book records.
     *
     * @param array $params Parsed request parameters:
     *   - query (string): Search term to match against title/author
     *   - limit (int): Maximum number of results (default 10, max 100)
     * @return array Response data with results and total count
     */
    public function handle(array $params): array
    {
        $query = isset($params['query']) ? trim((string) $params['query']) : '';
        $limit = isset($params['limit']) ? (int) $params['limit'] : 10;

        // Validate query parameter
        if ($query === '') {
            return array(
                'results' => array(),
                'total' => 0,
            );
        }

        // Clamp limit to a safe range
        if ($limit < 1) {
            $limit = 1;
        }
        if ($limit > 100) {
            $limit = 100;
        }

        $db = $this->getConnection();
        if ($db === null) {
            return array(
                'error' => true,
                'code' => 'DB_CONNECTION_FAILED',
                'message' => 'Database connection is not available',
            );
        }

        $searchTerm = '%' . $query . '%';

        // Count total matching records (join with mst_author via biblio_author for author search)
        $countSql = "SELECT COUNT(DISTINCT b.biblio_id) as total FROM biblio b "
            . "LEFT JOIN biblio_author ba ON b.biblio_id = ba.biblio_id "
            . "LEFT JOIN mst_author a ON ba.author_id = a.author_id "
            . "WHERE b.title LIKE :query1 OR a.author_name LIKE :query2";
        $countStmt = $db->prepare($countSql);
        $countStmt->bindValue(':query1', $searchTerm, \PDO::PARAM_STR);
        $countStmt->bindValue(':query2', $searchTerm, \PDO::PARAM_STR);
        $countStmt->execute();
        $totalRow = $countStmt->fetch(\PDO::FETCH_ASSOC);
        $total = (int) $totalRow['total'];

        // Fetch matching records with limit
        $driver = $db->getAttribute(\PDO::ATTR_DRIVER_NAME);
        $groupConcatSql = $driver === 'sqlite'
            ? "GROUP_CONCAT(a.author_name, '; ') as author_names "
            : "GROUP_CONCAT(a.author_name SEPARATOR '; ') as author_names ";

        $searchSql = "SELECT DISTINCT b.biblio_id, b.title, b.isbn_issn, b.publisher_id, "
            . $groupConcatSql
            . "FROM biblio b "
            . "LEFT JOIN biblio_author ba ON b.biblio_id = ba.biblio_id "
            . "LEFT JOIN mst_author a ON ba.author_id = a.author_id "
            . "WHERE b.title LIKE :query1 OR a.author_name LIKE :query2 "
            . "GROUP BY b.biblio_id, b.title, b.isbn_issn, b.publisher_id "
            . "LIMIT :limit";
        $searchStmt = $db->prepare($searchSql);
        $searchStmt->bindValue(':query1', $searchTerm, \PDO::PARAM_STR);
        $searchStmt->bindValue(':query2', $searchTerm, \PDO::PARAM_STR);
        $searchStmt->bindValue(':limit', $limit, \PDO::PARAM_INT);
        $searchStmt->execute();
        $rows = $searchStmt->fetchAll(\PDO::FETCH_ASSOC);

        // Map database rows to response format
        $results = array();
        foreach ($rows as $row) {
            $results[] = array(
                'id' => (int) $row['biblio_id'],
                'title' => (string) $row['title'],
                'author' => isset($row['author_names']) ? (string) $row['author_names'] : '',
                'isbn' => isset($row['isbn_issn']) ? (string) $row['isbn_issn'] : '',
                'publisher' => isset($row['publisher_id']) ? (string) $row['publisher_id'] : '',
            );
        }

        return array(
            'results' => $results,
            'total' => $total,
        );
    }

    /**
     * Get the database connection.
     *
     * Uses the injected PDO instance if available, otherwise
     * falls back to the SLiMS global $dbs connection.
     *
     * @return \PDO|null
     */
    private function getConnection()
    {
        if ($this->db !== null) {
            return $this->db;
        }

        // SLiMS uses a global $dbs variable for the database connection
        global $dbs;
        if (isset($dbs) && $dbs instanceof \PDO) {
            return $dbs;
        }

        return null;
    }
}
