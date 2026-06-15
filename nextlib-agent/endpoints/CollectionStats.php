<?php
/**
 * Collection Statistics Endpoint
 *
 * Handles POST /api/v1/nextlib/collection-stats requests.
 * Returns the distribution of the collection across DDC main classes and
 * collection types, plus headline totals (titles, items, borrowed, etc).
 *
 * Request:  {} (no params)
 * Response: { "ddc": [...], "totals": {...}, "collection_types": [...] }
 *
 * @package    NextLib-Agent
 * @subpackage Endpoints
 * @version    1.0.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\endpoints;

class CollectionStats
{
    /** @var \PDO|null Database connection (injectable for testing) */
    private $db;

    public function __construct($db = null)
    {
        $this->db = $db;
    }

    public function handle(array $params): array
    {
        $db = $this->getConnection();
        if ($db === null) {
            return array(
                'error'   => true,
                'code'    => 'DB_CONNECTION_FAILED',
                'message' => 'Database connection is not available',
            );
        }

        // ---- 1. DDC main-class distribution ----
        // Bucket non-numeric / null / empty classification into "Other".
        // Driver-specific REGEXP: MySQL uses REGEXP, SQLite has no native
        // REGEXP — fall back to a GLOB-free approach for tests (treat all
        // as Other in SQLite).
        $driver = $db->getAttribute(\PDO::ATTR_DRIVER_NAME);
        if ($driver === 'sqlite') {
            $ddcExpr = "CASE WHEN substr(b.classification,1,1) BETWEEN '0' AND '9'
                            THEN substr(b.classification,1,1) ELSE 'Other' END";
        } else {
            $ddcExpr = "CASE WHEN b.classification REGEXP '^[0-9]'
                            THEN LEFT(b.classification, 1) ELSE 'Other' END";
        }

        $ddcStmt = $db->prepare(
            "SELECT {$ddcExpr} AS ddc_class,
                    COUNT(DISTINCT b.biblio_id) AS titles,
                    COUNT(i.item_id) AS items
             FROM biblio b
             LEFT JOIN item i ON b.biblio_id = i.biblio_id
             GROUP BY ddc_class
             ORDER BY titles DESC"
        );
        $ddcStmt->execute();
        $ddcRows = $ddcStmt->fetchAll(\PDO::FETCH_ASSOC);

        $ddcLabels = self::DDC_LABELS;
        $ddc = array();
        foreach ($ddcRows as $row) {
            $class = (string) $row['ddc_class'];
            $ddc[] = array(
                'class'  => $class,
                'label'  => array_key_exists($class, $ddcLabels) ? $ddcLabels[$class] : 'Other / Uncategorized',
                'titles' => (int) $row['titles'],
                'items'  => (int) $row['items'],
            );
        }

        // ---- 2. Headline totals ----
        $totalsStmt = $db->query(
            "SELECT
                (SELECT COUNT(DISTINCT biblio_id) FROM biblio) AS total_titles,
                (SELECT COUNT(*) FROM item) AS total_items,
                (SELECT COUNT(DISTINCT i.biblio_id) FROM item i
                    JOIN loan l ON l.item_code = i.item_code) AS borrowed_titles,
                (SELECT COUNT(*) FROM item i WHERE EXISTS
                    (SELECT 1 FROM loan l WHERE l.item_code = i.item_code)) AS borrowed_items,
                (SELECT COUNT(*) FROM item i WHERE NOT EXISTS
                    (SELECT 1 FROM loan l WHERE l.item_code = i.item_code)) AS never_borrowed_items"
        );
        $totalsRow = $totalsStmt->fetch(\PDO::FETCH_ASSOC);
        $totals = array(
            'total_titles'          => (int) $totalsRow['total_titles'],
            'total_items'           => (int) $totalsRow['total_items'],
            'borrowed_titles'       => (int) $totalsRow['borrowed_titles'],
            'borrowed_items'        => (int) $totalsRow['borrowed_items'],
            'never_borrowed_items'  => (int) $totalsRow['never_borrowed_items'],
        );
        $totals['borrowed_titles_pct'] = $totals['total_titles'] > 0
            ? round(($totals['borrowed_titles'] / $totals['total_titles']) * 100, 1)
            : 0.0;

        // ---- 3. Collection type distribution ----
        $typeStmt = $db->query(
            "SELECT IFNULL(ct.coll_type_name, 'Unknown') AS type_name,
                    COUNT(i.item_id) AS items
             FROM item i
             LEFT JOIN mst_coll_type ct ON i.coll_type_id = ct.coll_type_id
             GROUP BY ct.coll_type_id
             ORDER BY items DESC"
        );
        $typeRows = $typeStmt->fetchAll(\PDO::FETCH_ASSOC);
        $collectionTypes = array();
        foreach ($typeRows as $row) {
            $collectionTypes[] = array(
                'type_name' => (string) $row['type_name'],
                'items'     => (int) $row['items'],
            );
        }

        return array(
            'ddc'             => $ddc,
            'totals'          => $totals,
            'collection_types' => $collectionTypes,
        );
    }

    /**
     * Human-readable labels for the 10 DDC main classes.
     * "Other" is appended by the query for non-numeric classifications.
     */
    const DDC_LABELS = array(
        '0' => 'Computer science, information & general works',
        '1' => 'Philosophy & psychology',
        '2' => 'Religion',
        '3' => 'Social sciences',
        '4' => 'Language',
        '5' => 'Science',
        '6' => 'Applied sciences / Technology',
        '7' => 'Arts & recreation',
        '8' => 'Literature',
        '9' => 'History & geography',
    );

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
