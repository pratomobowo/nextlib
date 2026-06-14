<?php
/**
 * NextLib-Agent Cron Entry Point
 *
 * This file is called by the system cron scheduler to trigger
 * the daily aggregate data export to NextLib-Cloud.
 *
 * Usage (crontab):
 *   0 23 * * * /usr/bin/php /path/to/plugins/nextlib-agent/cron.php
 *
 * Outputs results for cron logging (stdout).
 *
 * @package    NextLib-Agent
 * @version    1.0.0
 * @requires   PHP 7.4+
 */

// Define INDEX_AUTH to allow loading config and other plugin files
if (!defined('INDEX_AUTH')) {
    define('INDEX_AUTH', 1);
}

// Load Composer autoloader if available
$autoloadPath = __DIR__ . '/vendor/autoload.php';
if (file_exists($autoloadPath)) {
    require_once $autoloadPath;
}

// Load environment variables from .env (no-op if the file or loader is absent).
// createUnsafeImmutable() also calls putenv() so getenv() in config.php works.
if (class_exists('Dotenv\\Dotenv')) {
    Dotenv\Dotenv::createUnsafeImmutable(__DIR__)->safeLoad();
}

// Load configuration
$configPath = __DIR__ . '/config.php';
if (!file_exists($configPath)) {
    echo "[ERROR] Configuration file not found: {$configPath}\n";
    exit(1);
}

$config = require $configPath;

if (!is_array($config)) {
    echo "[ERROR] Invalid configuration file format\n";
    exit(1);
}

// Validate required configuration. Placeholders from config.php mean .env has
// not been populated yet — fail loudly rather than silently sending garbage.
$requiredKeys = array('api_secret', 'cloud_base_url', 'tenant_id');
foreach ($requiredKeys as $key) {
    if (!isset($config[$key]) || $config[$key] === '') {
        echo "[ERROR] Missing required configuration: {$key}\n";
        exit(1);
    }
    if (strpos($config[$key], 'change-me') === 0) {
        echo "[ERROR] Placeholder value detected for {$key}. Configure it in .env.\n";
        exit(1);
    }
}

use NextLibAgent\Exporter\MetricsCollector;
use NextLibAgent\Exporter\AnomalyTagger;
use NextLibAgent\Exporter\RetryScheduler;
use NextLibAgent\Exporter\EnhancedExporter;
use NextLibAgent\Lib\HttpClient;
use NextLibAgent\Lib\HmacSigner;

// Initialize database connection to SLiMS
// SLiMS typically uses MySQL/MariaDB - connection details come from SLiMS config
// In standalone cron mode, we need to provide DB connection
$dbHost = isset($config['db_host']) ? $config['db_host'] : 'localhost';
$dbName = isset($config['db_name']) ? $config['db_name'] : 'slims';
$dbUser = isset($config['db_user']) ? $config['db_user'] : 'root';
$dbPass = isset($config['db_pass']) ? $config['db_pass'] : '';
$dbPort = isset($config['db_port']) ? $config['db_port'] : '3306';

try {
    $dsn = "mysql:host={$dbHost};port={$dbPort};dbname={$dbName};charset=utf8mb4";
    $db = new PDO($dsn, $dbUser, $dbPass, array(
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ));
} catch (PDOException $e) {
    echo "[ERROR] Database connection failed: " . $e->getMessage() . "\n";
    exit(1);
}

// Initialize dependencies
$timeout = isset($config['http_timeout']) ? (int) $config['http_timeout'] : 10;
$signer = new HmacSigner($config['api_secret']);
// Disable HTTPS enforcement for local development (cloud_base_url is http://localhost)
$enforceHttps = strpos($config['cloud_base_url'], 'https://') === 0;
$httpClient = new HttpClient($config['cloud_base_url'], $timeout, $signer, $enforceHttps);
$queuePath = __DIR__ . '/queue';

// Create exporter instance
$collector = new MetricsCollector($db);
$anomalyTagger = new AnomalyTagger($db, $collector);
$retryScheduler = new RetryScheduler($queuePath);
$exporter = new EnhancedExporter($collector, $anomalyTagger, $retryScheduler, $httpClient, $config, $queuePath);

$timestamp = date('Y-m-d H:i:s');
echo "[{$timestamp}] NextLib-Agent Cron Export Starting\n";

// Step 1: Export today's aggregate data
echo "[INFO] Collecting and exporting daily aggregate stats...\n";
$exportSuccess = $exporter->export();

if ($exportSuccess) {
    echo "[OK] Daily aggregate data exported successfully\n";
} else {
    echo "[WARN] Daily export failed - payload queued for retry\n";
}

// Step 2: Process pending queue (retry previously failed exports)
echo "[INFO] Processing pending export queue...\n";
$retryCount = $exporter->processRetryQueue();

if ($retryCount > 0) {
    echo "[OK] Successfully sent {$retryCount} queued item(s)\n";
} else {
    echo "[INFO] No pending queue items processed\n";
}

$endTimestamp = date('Y-m-d H:i:s');
echo "[{$endTimestamp}] NextLib-Agent Cron Export Complete\n";

exit($exportSuccess ? 0 : 1);
