<?php
/**
 * Aggregate Data Exporter (LEGACY v1)
 *
 * Cron-triggered data exporter that collects daily statistics
 * from SLiMS and sends compressed payload to NextLib-Cloud.
 *
 * NOTE: This is the original v1 exporter. The production cron (cron.php) wires
 * up EnhancedExporter instead, which adds v2 schema, anomaly tagging, and a
 * shared RetryScheduler. This class is intentionally retained because the test
 * suite encodes the v1 PII-sanitization, gzip-compression, and queue-retry
 * invariants against it — those contracts are still valid and must hold for
 * any exporter implementation. Do NOT wire this into the production cron path.
 *
 * Payload format:
 * {
 *   "tenant_id": "uuid",
 *   "date": "YYYY-MM-DD",
 *   "stats": { "visitor_count": int, "loan_count": int, "return_count": int },
 *   "sent_at": "ISO-8601"
 * }
 *
 * Privacy: Only aggregate statistics are exported. No PII is included.
 *
 * @package    NextLib-Agent
 * @subpackage Exporter
 * @version    1.0.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\Exporter;

use NextLibAgent\Lib\HttpClient;
use NextLibAgent\Lib\HmacSigner;
use PDO;

class AggregateExporter
{
    /**
     * @var PDO Database connection to SLiMS
     */
    private $db;

    /**
     * @var HttpClient HTTP client for cloud communication
     */
    private $httpClient;

    /**
     * @var array Configuration array (tenant_id, cloud_base_url, etc.)
     */
    private $config;

    /**
     * @var string Path to the queue directory for pending exports
     */
    private $queuePath;

    /**
     * @param PDO        $db         Database connection to SLiMS
     * @param HttpClient $httpClient HTTP client instance
     * @param array      $config     Configuration array with tenant_id and cloud_base_url
     * @param string     $queuePath  Path to queue directory
     */
    public function __construct(PDO $db, HttpClient $httpClient, array $config, string $queuePath = '')
    {
        $this->db = $db;
        $this->httpClient = $httpClient;
        $this->config = $config;
        $this->queuePath = $queuePath ?: __DIR__ . '/../queue';
    }

    /**
     * Collect daily statistics from SLiMS database.
     *
     * Queries the visitor and loan tables to get today's aggregate counts.
     * Uses CURDATE() for MySQL/MariaDB compatibility.
     *
     * @param string|null $date Optional date in 'Y-m-d' format. Defaults to today.
     * @return array Aggregate statistics (visitor_count, loan_count, return_count)
     */
    public function collectDailyStats(?string $date = null): array
    {
        $targetDate = $date !== null ? $date : date('Y-m-d');

        $visitorCount = $this->queryCount(
            "SELECT COUNT(*) FROM visitor_count WHERE DATE(checkin_date) = :target_date",
            $targetDate
        );

        $loanCount = $this->queryCount(
            "SELECT COUNT(*) FROM loan WHERE DATE(loan_date) = :target_date",
            $targetDate
        );

        $returnCount = $this->queryCount(
            "SELECT COUNT(*) FROM loan WHERE DATE(return_date) = :target_date",
            $targetDate
        );

        return array(
            'visitor_count' => $visitorCount,
            'loan_count' => $loanCount,
            'return_count' => $returnCount,
        );
    }

    /**
     * Build the export payload with aggregate data.
     *
     * Constructs a JSON-serializable payload containing tenant identification,
     * date, aggregate statistics, and timestamp. No PII is included.
     *
     * @param array       $stats Daily statistics from collectDailyStats()
     * @param string|null $date  Optional date override in 'Y-m-d' format
     * @return array Formatted payload ready for compression and sending
     */
    public function buildPayload(array $stats, ?string $date = null): array
    {
        $targetDate = $date !== null ? $date : date('Y-m-d');

        return array(
            'tenant_id' => isset($this->config['tenant_id']) ? $this->config['tenant_id'] : '',
            'date' => $targetDate,
            'stats' => array(
                'visitor_count' => isset($stats['visitor_count']) ? (int) $stats['visitor_count'] : 0,
                'loan_count' => isset($stats['loan_count']) ? (int) $stats['loan_count'] : 0,
                'return_count' => isset($stats['return_count']) ? (int) $stats['return_count'] : 0,
            ),
            'sent_at' => date('c'),
        );
    }

    /**
     * Compress payload using gzip.
     *
     * Uses gzencode() which produces RFC 1952 compliant gzip data.
     * Returns empty string for empty input (no compression needed).
     *
     * @param string $jsonPayload JSON-encoded payload
     * @return string Gzip-compressed data, or empty string on failure/empty input
     */
    public function compress(string $jsonPayload): string
    {
        if ($jsonPayload === '') {
            return '';
        }

        $compressed = gzencode($jsonPayload, 9);

        if ($compressed === false) {
            return '';
        }

        return $compressed;
    }

    /**
     * Decompress gzip-compressed data.
     *
     * Static utility method for verification and testing purposes.
     * Reverses the compress() operation using gzdecode().
     *
     * @param string $compressed Gzip-compressed data
     * @return string Decompressed original payload, or empty string on failure/empty input
     */
    public static function decompress(string $compressed): string
    {
        if ($compressed === '') {
            return '';
        }

        $decompressed = @gzdecode($compressed);

        if ($decompressed === false) {
            return '';
        }

        return $decompressed;
    }

    /**
     * Allowed top-level keys in the export payload.
     */
    const ALLOWED_TOP_LEVEL_KEYS = array('tenant_id', 'date', 'stats', 'sent_at');

    /**
     * Allowed keys within the stats sub-array.
     */
    const ALLOWED_STATS_KEYS = array('visitor_count', 'loan_count', 'return_count');

    /**
     * Sanitize payload to ensure it only contains allowed aggregate fields.
     *
     * Strips any unexpected fields that might contain PII. Only allows
     * the predefined set of top-level keys and stats keys.
     *
     * @param array $payload The payload to sanitize
     * @return array Clean payload with only aggregate data
     */
    public function sanitizePayload(array $payload): array
    {
        $clean = array();

        foreach (self::ALLOWED_TOP_LEVEL_KEYS as $key) {
            if (!array_key_exists($key, $payload)) {
                continue;
            }

            if ($key === 'stats') {
                $clean['stats'] = $this->sanitizeStats(
                    is_array($payload['stats']) ? $payload['stats'] : array()
                );
            } else {
                $clean[$key] = $payload[$key];
            }
        }

        // Validate no PII leaked into allowed field values
        if (self::containsPII($clean)) {
            // If PII is detected in values, strip the problematic fields
            $clean = $this->stripPIIValues($clean);
        }

        return $clean;
    }

    /**
     * Sanitize the stats sub-array to only include allowed keys.
     *
     * @param array $stats The stats array to sanitize
     * @return array Clean stats array with only allowed keys
     */
    private function sanitizeStats(array $stats): array
    {
        $clean = array();

        foreach (self::ALLOWED_STATS_KEYS as $key) {
            if (array_key_exists($key, $stats)) {
                $clean[$key] = (int) $stats[$key];
            } else {
                $clean[$key] = 0;
            }
        }

        return $clean;
    }

    /**
     * Check if any field values in the payload look like PII.
     *
     * Detects:
     * - Email addresses (contains @)
     * - Phone numbers (digits with optional + prefix, length > 8)
     * - NIM/student IDs (configurable pattern, default: 8+ digit numbers)
     * - Names (alphabetic strings with more than 3 words)
     *
     * @param array $payload The payload to check
     * @return bool True if PII patterns are detected
     */
    public static function containsPII(array $payload): bool
    {
        $values = self::flattenValues($payload);

        foreach ($values as $value) {
            if (!is_string($value)) {
                continue;
            }

            // Skip values that look like ISO dates or timestamps (not PII)
            if (preg_match('/^\d{4}-\d{2}-\d{2}/', $value)) {
                continue;
            }

            // Skip values that look like UUIDs (valid tenant identifiers)
            if (preg_match('/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/', $value)) {
                continue;
            }

            // Check for email pattern (contains @)
            if (preg_match('/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/', $value)) {
                return true;
            }

            // Check for phone number pattern (digits with optional + prefix, length > 8)
            // Requires mostly digits (at least 8 actual digits) with optional separators
            $digitsOnly = preg_replace('/[^\d]/', '', $value);
            if ($digitsOnly !== null && strlen($digitsOnly) > 8
                && preg_match('/^\+?[\d\s\-()]{9,}$/', $value)) {
                return true;
            }

            // Check for NIM/student ID pattern (8+ consecutive digits in a string context)
            if (preg_match('/\b\d{8,}\b/', $value)) {
                return true;
            }

            // Check for long names (alphabetic strings > 3 words)
            $trimmed = trim($value);
            if ($trimmed !== '' && preg_match('/^[a-zA-Z\s.\']+$/', $trimmed)) {
                $words = preg_split('/\s+/', $trimmed);
                if (count($words) > 3) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Recursively flatten all string values from a nested array.
     *
     * @param array $data The array to flatten
     * @return array Flat list of all values
     */
    private static function flattenValues(array $data): array
    {
        $values = array();

        foreach ($data as $value) {
            if (is_array($value)) {
                $values = array_merge($values, self::flattenValues($value));
            } else {
                $values[] = $value;
            }
        }

        return $values;
    }

    /**
     * Strip values that contain PII patterns from the payload.
     *
     * Replaces string values that match PII patterns with safe defaults.
     *
     * @param array $payload The payload to strip PII from
     * @return array Payload with PII values removed
     */
    private function stripPIIValues(array $payload): array
    {
        $clean = array();

        foreach ($payload as $key => $value) {
            if ($key === 'stats' && is_array($value)) {
                // Stats values should only be integers
                $cleanStats = array();
                foreach ($value as $statKey => $statValue) {
                    $cleanStats[$statKey] = is_numeric($statValue) ? (int) $statValue : 0;
                }
                $clean[$key] = $cleanStats;
            } elseif (is_string($value) && self::containsPII(array($key => $value))) {
                // Remove fields whose values contain PII
                $clean[$key] = '';
            } else {
                $clean[$key] = $value;
            }
        }

        return $clean;
    }

    /**
     * Send compressed payload to NextLib-Cloud.
     *
     * Uses HttpClient to POST compressed data to {cloud_base_url}/api/v1/aggregate.
     * Signs the request with HMAC-SHA256 token via HmacSigner.
     * Sets Content-Encoding: gzip header for the compressed payload.
     *
     * @param string $compressedPayload Gzip-compressed payload
     * @return bool True if sent successfully (HTTP 2xx response)
     */
    public function send(string $compressedPayload): bool
    {
        if ($compressedPayload === '') {
            return false;
        }

        $apiSecret = isset($this->config['api_secret']) ? $this->config['api_secret'] : '';
        if ($apiSecret === '') {
            return false;
        }

        // Sign the request body with HMAC-SHA256
        $signer = new HmacSigner($apiSecret);
        $token = $signer->generateToken($compressedPayload);

        // Build headers
        $headers = array(
            'Content-Type: application/octet-stream',
            'Content-Encoding: gzip',
            'X-NextLib-Token: ' . $token,
        );

        // Send POST request to /api/v1/aggregate
        $response = $this->httpClient->post('/api/v1/aggregate', $compressedPayload, $headers);

        // Check for HTTP 2xx success response
        $status = isset($response['status']) ? (int) $response['status'] : 0;

        return $status >= 200 && $status < 300;
    }

    /**
     * Main export method. Collects daily stats, builds payload, compresses,
     * and sends to NextLib-Cloud. If sending fails, queues for retry.
     *
     * @param string|null $date Optional date override in 'Y-m-d' format
     * @return bool True if export was sent successfully
     */
    public function export(?string $date = null): bool
    {
        $stats = $this->collectDailyStats($date);
        $payload = $this->buildPayload($stats, $date);

        // Sanitize payload to ensure no PII is included before sending
        $payload = $this->sanitizePayload($payload);

        $jsonPayload = json_encode($payload);

        if ($jsonPayload === false) {
            return false;
        }

        $compressed = $this->compress($jsonPayload);

        // Validate that compression produced valid output
        if ($compressed === '') {
            $this->queueForRetry($payload);
            return false;
        }

        $success = $this->send($compressed);

        if (!$success) {
            $this->queueForRetry($payload);
            return false;
        }

        return true;
    }

    /**
     * Maximum number of items allowed in the queue.
     * Oldest items are dropped when exceeded.
     */
    const MAX_QUEUE_SIZE = 100;

    /**
     * Maximum number of retry attempts before an item is discarded.
     */
    const MAX_RETRIES = 3;

    /**
     * Queue failed payload for retry on next cron cycle.
     *
     * Reads existing queue from pending_exports.json, appends the new payload
     * with retry metadata, enforces max queue size, and writes atomically.
     *
     * @param array $payload The payload that failed to send
     * @return bool True if queued successfully
     */
    public function queueForRetry(array $payload): bool
    {
        $queueFile = $this->getQueueFilePath();
        $queue = $this->readQueue($queueFile);

        // Append payload with retry metadata
        $queue[] = array(
            'payload' => $payload,
            'retry_count' => 0,
            'queued_at' => date('c'),
        );

        // Enforce max queue size by dropping oldest items
        if (count($queue) > self::MAX_QUEUE_SIZE) {
            $queue = array_slice($queue, count($queue) - self::MAX_QUEUE_SIZE);
        }

        return $this->writeQueueAtomically($queueFile, $queue);
    }

    /**
     * Process pending exports from the queue.
     *
     * Reads all pending items, attempts to send each one.
     * Successfully sent items are removed. Failed items have their
     * retry_count incremented. Items exceeding max retries are discarded.
     *
     * @return int Number of successfully sent queued items
     */
    public function processPendingQueue(): int
    {
        $queueFile = $this->getQueueFilePath();
        $queue = $this->readQueue($queueFile);

        if (empty($queue)) {
            return 0;
        }

        $successCount = 0;
        $remaining = array();

        foreach ($queue as $item) {
            $payload = isset($item['payload']) ? $item['payload'] : array();
            $retryCount = isset($item['retry_count']) ? (int) $item['retry_count'] : 0;

            $jsonPayload = json_encode($payload);
            if ($jsonPayload === false) {
                // Skip items that can't be serialized
                continue;
            }

            $compressed = $this->compress($jsonPayload);
            $sent = $this->send($compressed);

            if ($sent) {
                $successCount++;
            } else {
                $retryCount++;
                // Only keep if under max retries
                if ($retryCount < self::MAX_RETRIES) {
                    $remaining[] = array(
                        'payload' => $payload,
                        'retry_count' => $retryCount,
                        'queued_at' => isset($item['queued_at']) ? $item['queued_at'] : date('c'),
                    );
                }
                // Items exceeding max retries are silently discarded
            }
        }

        $this->writeQueueAtomically($queueFile, $remaining);

        return $successCount;
    }

    /**
     * Get the full path to the queue file.
     *
     * @return string Absolute path to pending_exports.json
     */
    private function getQueueFilePath(): string
    {
        return rtrim($this->queuePath, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'pending_exports.json';
    }

    /**
     * Read the queue from the JSON file.
     *
     * @param string $filePath Path to the queue file
     * @return array Array of queued items
     */
    private function readQueue(string $filePath): array
    {
        if (!file_exists($filePath)) {
            return array();
        }

        $content = file_get_contents($filePath);
        if ($content === false || $content === '') {
            return array();
        }

        $data = json_decode($content, true);
        if (!is_array($data)) {
            return array();
        }

        return $data;
    }

    /**
     * Write queue data atomically using write-to-temp-then-rename strategy.
     *
     * @param string $filePath Target file path
     * @param array  $data     Queue data to write
     * @return bool True if written successfully
     */
    private function writeQueueAtomically(string $filePath, array $data): bool
    {
        $dir = dirname($filePath);
        if (!is_dir($dir)) {
            if (!mkdir($dir, 0755, true)) {
                return false;
            }
        }

        $tempFile = $filePath . '.tmp.' . getmypid();
        $json = json_encode($data, JSON_PRETTY_PRINT);

        if ($json === false) {
            return false;
        }

        $written = file_put_contents($tempFile, $json, LOCK_EX);
        if ($written === false) {
            return false;
        }

        $renamed = rename($tempFile, $filePath);
        if (!$renamed) {
            // Clean up temp file on failure
            if (file_exists($tempFile)) {
                unlink($tempFile);
            }
            return false;
        }

        return true;
    }

    /**
     * Execute a COUNT query with a date parameter.
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
}
