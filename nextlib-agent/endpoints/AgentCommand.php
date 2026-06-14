<?php
/**
 * Agent Command Endpoint
 *
 * Handles POST /api/v1/nextlib/agent-command requests.
 * Authenticated via TokenValidator (configured in index.php).
 *
 * Supported commands:
 * 1. backfill: starts historical export
 *    Parameters: { "command": "backfill", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" }
 * 2. backfill_status: queries progress
 *    Parameters: { "command": "backfill_status" }
 * 3. trigger_export: triggers export for a specific date (or today)
 *    Parameters: { "command": "trigger_export", "date": "YYYY-MM-DD" }
 *
 * @package    NextLib-Agent
 * @subpackage Endpoints
 * @version    2.0.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\endpoints;

use PDO;
use Exception;
use NextLibAgent\Exporter\MetricsCollector;
use NextLibAgent\Exporter\AnomalyTagger;
use NextLibAgent\Exporter\RetryScheduler;
use NextLibAgent\Exporter\EnhancedExporter;
use NextLibAgent\Exporter\BackfillEngine;
use NextLibAgent\Lib\HttpClient;
use NextLibAgent\Lib\HmacSigner;

class AgentCommand
{
    /** @var PDO|null Database connection */
    private $db;

    /** @var array|null Configuration array */
    private $config;

    /** @var string|null Directory path for state files */
    private $queuePath;

    /** @var HttpClient|null Mock http client for testing */
    private $httpClient;

    /**
     * @param PDO|null $db Optional PDO connection
     * @param array|null $config Optional config
     * @param string|null $queuePath Optional queue directory path
     * @param HttpClient|null $httpClient Optional HttpClient instance
     */
    public function __construct($db = null, $config = null, $queuePath = null, $httpClient = null)
    {
        $this->db = $db;
        $this->config = $config;
        $this->queuePath = $queuePath;
        $this->httpClient = $httpClient;
    }

    /**
     * Handle the incoming command.
     *
     * @param array $params Command parameters
     * @return array Response payload
     */
    public function handle(array $params): array
    {
        $command = isset($params['command']) ? trim((string) $params['command']) : '';

        if ($command === '') {
            return array(
                'error' => true,
                'code' => 'INVALID_PARAMS',
                'message' => 'Parameter command is required',
            );
        }

        $config = $this->getConfig();
        if ($config === null) {
            return array(
                'error' => true,
                'code' => 'CONFIG_ERROR',
                'message' => 'Configuration is not available',
            );
        }

        $db = $this->getConnection();
        if ($db === null) {
            return array(
                'error' => true,
                'code' => 'DB_CONNECTION_FAILED',
                'message' => 'Database connection is not available',
            );
        }

        $queuePath = $this->getQueuePath();

        // Instantiate exporter & backfill engine dependencies
        $collector = new MetricsCollector($db);
        $anomalyTagger = new AnomalyTagger($db, $collector);
        $retryScheduler = new RetryScheduler($queuePath);
        
        $httpClient = $this->getHttpClient($config);
        
        $exporter = new EnhancedExporter(
            $collector,
            $anomalyTagger,
            $retryScheduler,
            $httpClient,
            $config,
            $queuePath
        );

        $backfillEngine = new BackfillEngine($collector, $exporter, $queuePath);

        switch ($command) {
            case 'backfill':
                $startDate = isset($params['start_date']) ? trim((string) $params['start_date']) : '';
                $endDate = isset($params['end_date']) ? trim((string) $params['end_date']) : '';

                if ($startDate === '' || $endDate === '') {
                    return array(
                        'error' => true,
                        'code' => 'INVALID_PARAMS',
                        'message' => 'Parameters start_date and end_date are required for backfill command',
                    );
                }

                // Basic YYYY-MM-DD validation
                if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $startDate) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $endDate)) {
                    return array(
                        'error' => true,
                        'code' => 'INVALID_PARAMS',
                        'message' => 'Dates must be in YYYY-MM-DD format',
                    );
                }

                return $backfillEngine->start($startDate, $endDate);

            case 'backfill_status':
                return array(
                    'status' => 'success',
                    'progress' => $backfillEngine->getProgress(),
                );

            case 'trigger_export':
                $date = isset($params['date']) ? trim((string) $params['date']) : null;
                if ($date !== null && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
                    return array(
                        'error' => true,
                        'code' => 'INVALID_PARAMS',
                        'message' => 'Date must be in YYYY-MM-DD format',
                    );
                }

                $success = $exporter->export($date);

                return array(
                    'status' => $success ? 'success' : 'failed',
                    'message' => $success ? 'Export completed successfully' : 'Export failed (payload queued for retry)',
                );

            default:
                return array(
                    'error' => true,
                    'code' => 'UNKNOWN_COMMAND',
                    'message' => "Command '{$command}' is not supported",
                );
        }
    }

    /**
     * Get the database connection.
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
     * Get agent configuration.
     */
    private function getConfig()
    {
        if ($this->config !== null) {
            return $this->config;
        }

        $configPath = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'config.php';
        if (file_exists($configPath)) {
            $this->config = require $configPath;
            return $this->config;
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
     * Get HttpClient instance.
     */
    private function getHttpClient(array $config): HttpClient
    {
        if ($this->httpClient !== null) {
            return $this->httpClient;
        }

        $timeout = isset($config['http_timeout']) ? (int) $config['http_timeout'] : 10;
        $signer = new HmacSigner($config['api_secret']);
        $enforceHttps = strpos($config['cloud_base_url'], 'https://') === 0;

        return new HttpClient($config['cloud_base_url'], $timeout, $signer, $enforceHttps);
    }
}
