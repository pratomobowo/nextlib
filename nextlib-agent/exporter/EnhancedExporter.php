<?php
/**
 * Enhanced Exporter (Orchestrator)
 *
 * Coordinates MetricsCollector, AnomalyTagger, RetryScheduler, and HttpClient
 * to produce and deliver both v1 (legacy) and v2 (enhanced) payloads to
 * NextLib-Cloud.
 *
 * Payload v2 structure:
 * {
 *   "schema_version": "2.0",
 *   "tenant_id": "uuid",
 *   "date": "YYYY-MM-DD",
 *   "sent_at": "ISO-8601",
 *   "daily_metrics": { ...10 keys... },
 *   "snapshot_metrics": { ...3 keys... },
 *   "anomaly_flags": []
 * }
 *
 * Legacy v1 structure:
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
 * @version    2.0.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\Exporter;

use NextLibAgent\Lib\HttpClient;

class EnhancedExporter
{
    /**
     * Name of the last-export tracking file.
     */
    const LAST_EXPORT_FILE = 'last_export.json';

    /**
     * Supported export schedule values and their intervals in seconds.
     */
    const SCHEDULE_INTERVALS = array(
        'hourly'         => 3600,
        'every_6_hours'  => 21600,
        'every_12_hours' => 43200,
        'daily'          => 86400,
    );

    /**
     * Default schedule when config value is missing or invalid.
     */
    const DEFAULT_SCHEDULE = 'daily';

    /**
     * Allowed top-level keys in the v1 export payload.
     */
    const ALLOWED_V1_TOP_LEVEL_KEYS = array('tenant_id', 'date', 'stats', 'sent_at');

    /**
     * Allowed keys within the v1 stats sub-array.
     */
    const ALLOWED_V1_STATS_KEYS = array('visitor_count', 'loan_count', 'return_count');

    /**
     * Allowed top-level keys in the v2 export payload.
     */
    const ALLOWED_V2_TOP_LEVEL_KEYS = array(
        'schema_version',
        'tenant_id',
        'date',
        'sent_at',
        'daily_metrics',
        'snapshot_metrics',
        'anomaly_flags',
    );

    /**
     * Allowed keys within daily_metrics.
     */
    const ALLOWED_DAILY_METRICS_KEYS = array(
        'visitor_count',
        'unique_visitor_count',
        'loan_count',
        'return_count',
        'new_member_count',
        'new_biblio_count',
        'new_item_count',
        'fines_debet_total',
        'fines_credit_total',
        'reservation_count',
    );

    /**
     * Allowed keys within snapshot_metrics.
     */
    const ALLOWED_SNAPSHOT_METRICS_KEYS = array(
        'total_collection_size',
        'active_member_count',
        'active_overdue_count',
    );

    /**
     * @var MetricsCollector
     */
    private $collector;

    /**
     * @var AnomalyTagger
     */
    private $anomalyTagger;

    /**
     * @var RetryScheduler
     */
    private $retryScheduler;

    /**
     * @var HttpClient
     */
    private $httpClient;

    /**
     * @var array Configuration array:
     *   tenant_id       (string)
     *   cloud_base_url  (string)
     *   api_secret      (string)
     *   v2_enabled      (bool, default false)
     *   export_schedule (string, default "daily")
     */
    private $config;

    /**
     * @var string Absolute path to the queue directory
     */
    private $queuePath;

    /**
     * @param MetricsCollector $collector      Metrics collection component
     * @param AnomalyTagger    $anomalyTagger  Anomaly detection component
     * @param RetryScheduler   $retryScheduler Retry queue component
     * @param HttpClient       $httpClient     HTTP transport component
     * @param array            $config         Configuration array
     * @param string           $queuePath      Absolute path to the queue directory
     */
    public function __construct(
        MetricsCollector $collector,
        AnomalyTagger $anomalyTagger,
        RetryScheduler $retryScheduler,
        HttpClient $httpClient,
        array $config,
        string $queuePath
    ) {
        $this->collector      = $collector;
        $this->anomalyTagger  = $anomalyTagger;
        $this->retryScheduler = $retryScheduler;
        $this->httpClient     = $httpClient;
        $this->config         = $config;
        $this->queuePath      = rtrim($queuePath, DIRECTORY_SEPARATOR);
    }

    // =========================================================================
    // Payload Builders
    // =========================================================================

    /**
     * Build a complete v2 payload structure.
     *
     * Produces the payload that matches the v2 schema:
     * schema_version, tenant_id, date, sent_at, daily_metrics,
     * snapshot_metrics, and anomaly_flags.
     *
     * All numeric metric values are cast to int. The anomaly_flags
     * array is preserved as-is (strings only).
     *
     * @param array       $dailyMetrics    Daily metrics from MetricsCollector::collectDailyMetrics()
     * @param array       $snapshotMetrics Snapshot metrics from MetricsCollector::collectSnapshotMetrics()
     * @param array       $anomalyFlags    Flag strings from AnomalyTagger::detectAnomalies()
     * @param string|null $date            Optional date override (Y-m-d); defaults to today
     * @return array Complete v2 payload
     */
    public function buildPayloadV2(
        array $dailyMetrics,
        array $snapshotMetrics,
        array $anomalyFlags,
        $date = null
    ): array {
        $targetDate = ($date !== null && $date !== '') ? $date : date('Y-m-d');

        // Build daily_metrics with defaults for each expected key
        $builtDailyMetrics = array();
        foreach (self::ALLOWED_DAILY_METRICS_KEYS as $key) {
            $builtDailyMetrics[$key] = isset($dailyMetrics[$key])
                ? (int) $dailyMetrics[$key]
                : 0;
        }

        // Build snapshot_metrics with defaults for each expected key
        $builtSnapshotMetrics = array();
        foreach (self::ALLOWED_SNAPSHOT_METRICS_KEYS as $key) {
            $builtSnapshotMetrics[$key] = isset($snapshotMetrics[$key])
                ? (int) $snapshotMetrics[$key]
                : 0;
        }

        // Ensure anomaly_flags contains only strings
        $cleanFlags = array();
        foreach ($anomalyFlags as $flag) {
            if (is_string($flag)) {
                $cleanFlags[] = $flag;
            }
        }

        return array(
            'schema_version'   => '2.0',
            'tenant_id'        => isset($this->config['tenant_id']) ? $this->config['tenant_id'] : '',
            'date'             => $targetDate,
            'sent_at'          => date('c'),
            'daily_metrics'    => $builtDailyMetrics,
            'snapshot_metrics' => $builtSnapshotMetrics,
            'anomaly_flags'    => $cleanFlags,
        );
    }

    /**
     * Build a legacy v1 payload for backward compatibility.
     *
     * Produces the flat payload format consumed by /api/v1/aggregate:
     * tenant_id, date, stats (visitor_count, loan_count, return_count), sent_at.
     *
     * @param array       $dailyMetrics Daily metrics (only visitor_count, loan_count,
     *                                  return_count are used)
     * @param string|null $date         Optional date override (Y-m-d); defaults to today
     * @return array Legacy v1 payload
     */
    public function buildPayloadV1(array $dailyMetrics, $date = null): array
    {
        $targetDate = ($date !== null && $date !== '') ? $date : date('Y-m-d');

        return array(
            'tenant_id' => isset($this->config['tenant_id']) ? $this->config['tenant_id'] : '',
            'date'      => $targetDate,
            'stats'     => array(
                'visitor_count' => isset($dailyMetrics['visitor_count'])
                    ? (int) $dailyMetrics['visitor_count']
                    : 0,
                'loan_count'    => isset($dailyMetrics['loan_count'])
                    ? (int) $dailyMetrics['loan_count']
                    : 0,
                'return_count'  => isset($dailyMetrics['return_count'])
                    ? (int) $dailyMetrics['return_count']
                    : 0,
            ),
            'sent_at'   => date('c'),
        );
    }

    // =========================================================================
    // Export Schedule Management
    // =========================================================================

    /**
     * Record the current timestamp as the last successful export.
     *
     * Writes last_export.json to the queue directory with:
     *   - last_successful_export: ISO-8601 timestamp
     *   - last_export_date: Y-m-d date
     *   - export_schedule: the configured schedule value
     *
     * Uses write-to-temp-then-rename for atomicity.
     *
     * @return bool True if the file was written successfully
     */
    public function recordLastExport(): bool
    {
        $schedule = $this->resolveSchedule();

        $data = array(
            'last_successful_export' => date('c'),
            'last_export_date'       => date('Y-m-d'),
            'export_schedule'        => $schedule,
        );

        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        if ($json === false) {
            return false;
        }

        $filePath = $this->getLastExportFilePath();
        $dir      = dirname($filePath);

        if (!is_dir($dir)) {
            if (!mkdir($dir, 0755, true)) {
                return false;
            }
        }

        $tempFile = $filePath . '.tmp.' . getmypid();
        $written  = file_put_contents($tempFile, $json, LOCK_EX);

        if ($written === false) {
            return false;
        }

        $renamed = rename($tempFile, $filePath);
        if (!$renamed && file_exists($tempFile)) {
            unlink($tempFile);
        }

        return $renamed;
    }

    /**
     * Determine whether an export should run now based on the configured schedule.
     *
     * Reads last_export.json from the queue directory to find the last successful
     * export timestamp. Returns true if:
     *   - last_export.json does not exist (never exported)
     *   - the timestamp is missing or unparseable
     *   - the time elapsed since the last export >= the configured interval
     *
     * Schedule → interval mapping:
     *   "hourly"          →  3 600 s
     *   "every_6_hours"   → 21 600 s
     *   "every_12_hours"  → 43 200 s
     *   "daily"           → 86 400 s
     *   (any other value) → 86 400 s (treated as "daily")
     *
     * @return bool True if export should run now
     */
    public function shouldExportNow(): bool
    {
        $schedule         = $this->resolveSchedule();
        $intervalSeconds  = self::SCHEDULE_INTERVALS[$schedule];

        $filePath = $this->getLastExportFilePath();

        if (!file_exists($filePath)) {
            return true;
        }

        $content = file_get_contents($filePath);
        if ($content === false || $content === '') {
            return true;
        }

        $data = json_decode($content, true);
        if (!is_array($data) || empty($data['last_successful_export'])) {
            return true;
        }

        $lastExportTimestamp = strtotime($data['last_successful_export']);
        if ($lastExportTimestamp === false) {
            return true;
        }

        $elapsed = time() - $lastExportTimestamp;

        return $elapsed >= $intervalSeconds;
    }

    // =========================================================================
    // Export Orchestration
    // =========================================================================

    /**
     * Main export method.
     *
     * Full flow:
     *   1. Resolve target date ($date ?? today)
     *   2. Collect daily and snapshot metrics via MetricsCollector
     *   3. Detect anomalies via AnomalyTagger
     *   4. If v2_enabled: build v2 payload → sanitize → JSON-encode → compress
     *      → POST to /api/v2/aggregate with Content-Encoding: gzip
     *   5. Always: build v1 payload → sanitize → JSON-encode → compress
     *      → POST to /api/v1/aggregate with Content-Encoding: gzip
     *   6. On all required sends succeeded: call recordLastExport(), return true
     *   7. On any HTTP send failure: enqueue failed payload to RetryScheduler,
     *      return false
     *
     * Privacy: PII sanitization is applied before compression on every payload
     * per Requirements 10.2 and 10.3.
     *
     * @param string|null $date Optional date override in 'Y-m-d' format
     * @return bool True if all required sends succeeded
     */
    public function export($date = null): bool
    {
        $targetDate = ($date !== null && $date !== '') ? $date : date('Y-m-d');

        // Step 1: Collect metrics
        $dailyMetrics    = $this->collector->collectDailyMetrics($targetDate);
        $snapshotMetrics = $this->collector->collectSnapshotMetrics($targetDate);

        // Step 2: Detect anomalies
        $anomalyFlags = $this->anomalyTagger->detectAnomalies(
            $dailyMetrics,
            $snapshotMetrics,
            $targetDate
        );

        $v2Enabled = isset($this->config['v2_enabled']) ? (bool) $this->config['v2_enabled'] : false;

        // Step 3: Send v2 payload (if v2_enabled)
        if ($v2Enabled) {
            $payloadV2     = $this->buildPayloadV2($dailyMetrics, $snapshotMetrics, $anomalyFlags, $targetDate);
            $payloadV2     = $this->sanitizePayloadV2($payloadV2);
            $jsonV2        = json_encode($payloadV2);

            if ($jsonV2 === false) {
                $this->retryScheduler->enqueue($payloadV2, 'JSON encode failed for v2 payload');
                return false;
            }

            $compressedV2 = $this->compress($jsonV2);

            if ($compressedV2 === '') {
                $this->retryScheduler->enqueue($payloadV2, 'Gzip compression failed for v2 payload');
                return false;
            }

            $sentV2 = $this->sendPayload('/api/v2/aggregate', $jsonV2, $compressedV2);

            if (!$sentV2['success']) {
                $this->retryScheduler->enqueue($payloadV2, $sentV2['error']);
                return false;
            }
        }

        // Step 4: Always send v1 payload
        $payloadV1    = $this->buildPayloadV1($dailyMetrics, $targetDate);
        $payloadV1    = $this->sanitizePayloadV1($payloadV1);
        $jsonV1       = json_encode($payloadV1);

        if ($jsonV1 === false) {
            $this->retryScheduler->enqueue($payloadV1, 'JSON encode failed for v1 payload');
            return false;
        }

        $compressedV1 = $this->compress($jsonV1);

        if ($compressedV1 === '') {
            $this->retryScheduler->enqueue($payloadV1, 'Gzip compression failed for v1 payload');
            return false;
        }

        $sentV1 = $this->sendPayload('/api/v1/aggregate', $jsonV1, $compressedV1);

        if (!$sentV1['success']) {
            $this->retryScheduler->enqueue($payloadV1, $sentV1['error']);
            return false;
        }

        // Step 5: All required sends succeeded — record export timestamp
        $this->recordLastExport();

        return true;
    }

    /**
     * Process the retry queue: attempt to re-send all due items.
     *
     * Flow:
     *   1. Fetch due items from RetryScheduler::getDueItems()
     *   2. For each item: attempt sendPayload() using stored endpoint URL
     *      (determined by payload_version stored by RetryScheduler)
     *   3. On success: markSuccess(); on failure: markFailed()
     *   4. Return count of successfully sent items
     *
     * Items are processed in descending index order for safe splice-based
     * removal while iterating.
     *
     * @return int Number of successfully sent queued items
     */
    public function processRetryQueue(): int
    {
        $dueItems = $this->retryScheduler->getDueItems();

        if (empty($dueItems)) {
            return 0;
        }

        $successCount = 0;

        // Process in reverse index order to keep indices valid during removal
        // (markSuccess uses array_splice which shifts later indices)
        $reversedItems = array_reverse($dueItems);

        foreach ($reversedItems as $item) {
            $index   = isset($item['_queue_index']) ? (int) $item['_queue_index'] : -1;
            $payload = isset($item['payload']) ? $item['payload'] : array();

            // Determine endpoint by payload version
            $payloadVersion = isset($item['payload_version']) ? $item['payload_version'] : 'v1';
            $endpoint = ($payloadVersion === 'v2')
                ? '/api/v2/aggregate'
                : '/api/v1/aggregate';

            // Re-encode and compress the stored payload
            $json = json_encode($payload);
            if ($json === false) {
                $this->retryScheduler->markFailed($index, 'JSON encode failed during retry');
                continue;
            }

            $compressed = $this->compress($json);
            if ($compressed === '') {
                $this->retryScheduler->markFailed($index, 'Gzip compression failed during retry');
                continue;
            }

            $result = $this->sendPayload($endpoint, $json, $compressed);

            if ($result['success']) {
                $this->retryScheduler->markSuccess($index);
                $successCount++;
            } else {
                $this->retryScheduler->markFailed($index, $result['error']);
            }
        }

        return $successCount;
    }

    // =========================================================================
    // Private send helper
    // =========================================================================

    /**
     * Sign and POST a compressed payload to the given endpoint.
     *
     * Builds the required headers (Content-Type, Content-Encoding, X-NextLib-Token)
     * using HmacSigner and delegates to HttpClient::post().
     *
     * @param string $endpoint   API path, e.g. '/api/v1/aggregate'
     * @param string $compressed Gzip-compressed JSON payload
     * @return array{success: bool, error: string} Result of the send attempt
     */
    /**
     * Build the required headers (Content-Type, Content-Encoding, X-NextLib-Token)
     * and POST the compressed payload to the cloud.
     *
     * IMPORTANT: the HMAC token is computed over $rawJson (the logical payload),
     * NOT over $compressed. The cloud validates the signature against the
     * decompressed body — signing compressed bytes would break because the agent
     * and cloud would be signing/verifying different byte sequences. This also
     * keeps signing consistent with the uncompressed handshake endpoint.
     *
     * @param string $endpoint   API path, e.g. '/api/v1/aggregate'
     * @param string $rawJson    The uncompressed JSON payload (what is signed).
     * @param string $compressed The gzip-compressed payload (what is sent).
     * @return array{success: bool, error: string}
     */
    private function sendPayload(string $endpoint, string $rawJson, string $compressed): array
    {
        if ($compressed === '') {
            return array('success' => false, 'error' => 'Empty compressed payload');
        }

        $apiSecret = isset($this->config['api_secret']) ? $this->config['api_secret'] : '';
        if ($apiSecret === '') {
            return array('success' => false, 'error' => 'api_secret is not configured');
        }

        // Sign the logical (decompressed) JSON payload so the cloud can verify
        // after gunzipping. See /api/v1/aggregate route.ts line ~139.
        $signer = new \NextLibAgent\Lib\HmacSigner($apiSecret);
        $token  = $signer->generateToken($rawJson);

        // Cloud looks up the tenant by SHA-256(apiSecret) via the
        // X-NextLib-Secret-Hash header (see authenticateAgent in tenant-guard.ts).
        // The HMAC token only validates request integrity — it cannot identify
        // the tenant on its own.
        $secretHash = hash('sha256', $apiSecret);

        $headers = array(
            'Content-Type: application/octet-stream',
            'Content-Encoding: gzip',
            'X-NextLib-Token: ' . $token,
            'X-NextLib-Secret-Hash: ' . $secretHash,
        );

        $response = $this->httpClient->post($endpoint, $compressed, $headers);

        $status = isset($response['status']) ? (int) $response['status'] : 0;

        if ($status >= 200 && $status < 300) {
            return array('success' => true, 'error' => '');
        }

        $errorDetail = isset($response['error']) && $response['error'] !== null
            ? $response['error']
            : 'HTTP ' . $status;

        return array('success' => false, 'error' => $errorDetail);
    }

    // =========================================================================
    // PII Sanitization (mirrored from AggregateExporter)
    // =========================================================================

    /**
     * Sanitize a v1 payload to ensure it contains only allowed aggregate fields
     * and no PII patterns.
     *
     * Mirrors the logic in AggregateExporter::sanitizePayload() for v1 payloads.
     * Strips unexpected top-level keys and validates that allowed field values
     * do not contain PII.
     *
     * @param array $payload The v1 payload to sanitize
     * @return array Clean payload
     */
    public function sanitizePayloadV1(array $payload): array
    {
        $clean = array();

        foreach (self::ALLOWED_V1_TOP_LEVEL_KEYS as $key) {
            if (!array_key_exists($key, $payload)) {
                continue;
            }

            if ($key === 'stats') {
                $clean['stats'] = $this->sanitizeV1Stats(
                    is_array($payload['stats']) ? $payload['stats'] : array()
                );
            } else {
                $clean[$key] = $payload[$key];
            }
        }

        if (self::containsPII($clean)) {
            $clean = $this->stripPIIValues($clean);
        }

        return $clean;
    }

    /**
     * Sanitize the v1 stats sub-array to only include allowed keys.
     *
     * @param array $stats The stats array to sanitize
     * @return array Clean stats array
     */
    private function sanitizeV1Stats(array $stats): array
    {
        $clean = array();

        foreach (self::ALLOWED_V1_STATS_KEYS as $key) {
            $clean[$key] = array_key_exists($key, $stats) ? (int) $stats[$key] : 0;
        }

        return $clean;
    }

    /**
     * Sanitize a v2 payload to ensure it contains only allowed aggregate fields
     * and no PII patterns.
     *
     * @param array $payload The v2 payload to sanitize
     * @return array Clean payload
     */
    public function sanitizePayloadV2(array $payload): array
    {
        $clean = array();

        foreach (self::ALLOWED_V2_TOP_LEVEL_KEYS as $key) {
            if (!array_key_exists($key, $payload)) {
                continue;
            }

            if ($key === 'daily_metrics') {
                $clean['daily_metrics'] = $this->sanitizeMetricsSubArray(
                    is_array($payload['daily_metrics']) ? $payload['daily_metrics'] : array(),
                    self::ALLOWED_DAILY_METRICS_KEYS
                );
            } elseif ($key === 'snapshot_metrics') {
                $clean['snapshot_metrics'] = $this->sanitizeMetricsSubArray(
                    is_array($payload['snapshot_metrics']) ? $payload['snapshot_metrics'] : array(),
                    self::ALLOWED_SNAPSHOT_METRICS_KEYS
                );
            } elseif ($key === 'anomaly_flags') {
                // Keep only string values
                $flags = is_array($payload['anomaly_flags']) ? $payload['anomaly_flags'] : array();
                $clean['anomaly_flags'] = array_values(array_filter($flags, 'is_string'));
            } else {
                $clean[$key] = $payload[$key];
            }
        }

        if (self::containsPII($clean)) {
            $clean = $this->stripPIIValues($clean);
        }

        return $clean;
    }

    /**
     * Sanitize a metrics sub-array to include only the specified allowed keys.
     *
     * @param array    $metrics     The metrics array to sanitize
     * @param string[] $allowedKeys The keys to retain (others are dropped)
     * @return array Clean metrics array with integer values
     */
    private function sanitizeMetricsSubArray(array $metrics, array $allowedKeys): array
    {
        $clean = array();

        foreach ($allowedKeys as $key) {
            $clean[$key] = array_key_exists($key, $metrics) ? (int) $metrics[$key] : 0;
        }

        return $clean;
    }

    // =========================================================================
    // Compression (mirrored from AggregateExporter)
    // =========================================================================

    /**
     * Compress payload using gzip.
     *
     * Uses gzencode() which produces RFC 1952 compliant gzip data.
     * Returns empty string for empty input.
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

    // =========================================================================
    // PII Detection Helpers (mirrored from AggregateExporter)
    // =========================================================================

    /**
     * Check if any field values in the payload look like PII.
     *
     * Detects: email addresses, phone numbers (8+ digits), NIM/student IDs
     * (8+ consecutive digits), and long names (>3 alphabetic words).
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

            // Skip ISO dates/timestamps and UUIDs (not PII)
            if (preg_match('/^\d{4}-\d{2}-\d{2}/', $value)) {
                continue;
            }

            if (preg_match(
                '/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/',
                $value
            )) {
                continue;
            }

            // Email pattern
            if (preg_match('/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/', $value)) {
                return true;
            }

            // Phone number pattern (8+ digits with optional separators)
            $digitsOnly = preg_replace('/[^\d]/', '', $value);
            if (
                $digitsOnly !== null
                && strlen($digitsOnly) > 8
                && preg_match('/^\+?[\d\s\-()]{9,}$/', $value)
            ) {
                return true;
            }

            // NIM/student ID pattern (8+ consecutive digits)
            if (preg_match('/\b\d{8,}\b/', $value)) {
                return true;
            }

            // Long name pattern (alphabetic strings with >3 words)
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
     * Recursively flatten all values from a nested array.
     *
     * @param array $data The array to flatten
     * @return array Flat list of all leaf values
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
     * Strip field values that contain PII patterns from the payload.
     *
     * Replaces string values matching PII patterns with empty strings.
     * Integer values in stats/metrics sub-arrays are preserved as-is.
     *
     * @param array $payload The payload to strip PII from
     * @return array Payload with PII values replaced
     */
    private function stripPIIValues(array $payload): array
    {
        $clean = array();

        foreach ($payload as $key => $value) {
            if (is_array($value)) {
                // Recursively strip PII from sub-arrays; force integer for numeric-only sub-keys
                $isNumericSubArray = in_array(
                    $key,
                    array('stats', 'daily_metrics', 'snapshot_metrics'),
                    true
                );

                if ($isNumericSubArray) {
                    $cleanSub = array();
                    foreach ($value as $subKey => $subValue) {
                        $cleanSub[$subKey] = is_numeric($subValue) ? (int) $subValue : 0;
                    }
                    $clean[$key] = $cleanSub;
                } else {
                    $clean[$key] = $this->stripPIIValues($value);
                }
            } elseif (is_string($value) && self::containsPII(array($key => $value))) {
                $clean[$key] = '';
            } else {
                $clean[$key] = $value;
            }
        }

        return $clean;
    }

    // =========================================================================
    // Private Helpers
    // =========================================================================

    /**
     * Return the resolved, validated schedule name.
     *
     * If the config value is missing, empty, or not in the supported set,
     * returns the DEFAULT_SCHEDULE ("daily").
     *
     * @return string One of "hourly", "every_6_hours", "every_12_hours", "daily"
     */
    private function resolveSchedule(): string
    {
        $configured = isset($this->config['export_schedule'])
            ? (string) $this->config['export_schedule']
            : '';

        return array_key_exists($configured, self::SCHEDULE_INTERVALS)
            ? $configured
            : self::DEFAULT_SCHEDULE;
    }

    /**
     * Return the full path to last_export.json in the queue directory.
     *
     * @return string Absolute file path
     */
    private function getLastExportFilePath(): string
    {
        return $this->queuePath . DIRECTORY_SEPARATOR . self::LAST_EXPORT_FILE;
    }
}
