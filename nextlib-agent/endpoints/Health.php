<?php
/**
 * Health Check Endpoint
 *
 * Handles GET/POST /api/v1/nextlib/health requests.
 * Returns connection status, SLiMS DB connectivity, last export, backfill status, and system metrics.
 *
 * @package    NextLib-Agent
 * @subpackage Endpoints
 * @version    2.0.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\endpoints;

use PDO;
use Exception;

class Health
{
    /** @var PDO|null Database connection */
    private $db;

    /** @var string|null Directory path for state files */
    private $queuePath;

    /**
     * @param PDO|null $db Optional PDO connection
     * @param string|null $queuePath Optional queue directory path
     */
    public function __construct($db = null, $queuePath = null)
    {
        $this->db = $db;
        $this->queuePath = $queuePath;
    }

    /**
     * Handle the health check request.
     *
     * @param array $params Request parameters
     * @return array Health metrics response
     */
    public function handle(array $params): array
    {
        $dbConnected = false;
        $dbError = null;

        try {
            $db = $this->getConnection();
            if ($db !== null) {
                // Perform a simple query to verify database is functional
                $stmt = $db->query("SELECT 1");
                if ($stmt !== false) {
                    $dbConnected = true;
                }
            }
        } catch (Exception $e) {
            $dbError = $e->getMessage();
        }

        $queuePath = $this->getQueuePath();
        
        // Read last export status
        $lastExport = null;
        $lastExportFile = $queuePath . DIRECTORY_SEPARATOR . 'last_export.json';
        if (file_exists($lastExportFile)) {
            $content = file_get_contents($lastExportFile);
            if ($content !== false) {
                $lastExport = json_decode($content, true);
            }
        }

        // Read backfill status
        $backfillProgress = array(
            'in_progress' => false,
            'current_position' => null,
            'total_days' => 0,
            'completed_days' => 0
        );
        $backfillFile = $queuePath . DIRECTORY_SEPARATOR . 'backfill_state.json';
        if (file_exists($backfillFile)) {
            $content = file_get_contents($backfillFile);
            if ($content !== false) {
                $backfillState = json_decode($content, true);
                if (is_array($backfillState)) {
                    $backfillProgress['in_progress'] = isset($backfillState['in_progress']) ? (bool) $backfillState['in_progress'] : false;
                    $backfillProgress['total_days'] = isset($backfillState['total_days']) ? (int) $backfillState['total_days'] : 0;
                    $backfillProgress['completed_days'] = isset($backfillState['completed_days']) ? (int) $backfillState['completed_days'] : 0;
                    
                    // Recompute current position if in progress
                    if ($backfillProgress['in_progress'] && isset($backfillState['current_batch_index']) && isset($backfillState['start_date']) && isset($backfillState['end_date'])) {
                        // Use inline simple date partitioner to find current batch start
                        $batches = $this->partitionDates($backfillState['start_date'], $backfillState['end_date']);
                        $idx = (int) $backfillState['current_batch_index'];
                        if (isset($batches[$idx])) {
                            $backfillProgress['current_position'] = $batches[$idx]['start'];
                        }
                    }
                }
            }
        }

        // System metrics
        $freeDisk = function_exists('disk_free_space') ? @disk_free_space(__DIR__) : null;
        $totalDisk = function_exists('disk_total_space') ? @disk_total_space(__DIR__) : null;
        
        $systemMetrics = array(
            'php_version' => PHP_VERSION,
            'memory_limit' => ini_get('memory_limit'),
            'memory_usage' => function_exists('memory_get_usage') ? memory_get_usage() : null,
            'disk_free_bytes' => $freeDisk !== false ? $freeDisk : null,
            'disk_total_bytes' => $totalDisk !== false ? $totalDisk : null,
        );

        return array(
            'status' => ($dbConnected) ? 'healthy' : 'degraded',
            'database' => array(
                'connected' => $dbConnected,
                'error' => $dbError,
            ),
            'last_export' => $lastExport,
            'backfill' => $backfillProgress,
            'system' => $systemMetrics,
        );
    }

    /**
     * Get database connection.
     */
    private function getConnection()
    {
        if ($this->db !== null) {
            return $this->db;
        }

        global $dbs;
        if (isset($dbs) && $dbs instanceof PDO) {
            return $dbs;
        }

        return null;
    }

    /**
     * Get queue path.
     */
    private function getQueuePath(): string
    {
        if ($this->queuePath !== null) {
            return rtrim($this->queuePath, DIRECTORY_SEPARATOR);
        }

        return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'queue';
    }

    /**
     * Partitions date range into 30-day batches.
     */
    private function partitionDates(string $startDate, string $endDate): array
    {
        $batches = array();
        $batchStart = new \DateTime($startDate);
        $end = new \DateTime($endDate);

        while ($batchStart <= $end) {
            $batchEnd = clone $batchStart;
            $batchEnd->modify('+29 days');

            if ($batchEnd > $end) {
                $batchEnd = clone $end;
            }

            $batches[] = array(
                'start' => $batchStart->format('Y-m-d'),
                'end' => $batchEnd->format('Y-m-d'),
            );

            $batchStart = clone $batchEnd;
            $batchStart->modify('+1 day');
        }

        return $batches;
    }
}
