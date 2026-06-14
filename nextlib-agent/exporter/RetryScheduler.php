<?php
/**
 * Retry Scheduler with Exponential Backoff
 *
 * Manages re-delivery of failed payloads using exponential backoff with jitter.
 * Persists the retry queue atomically to a JSON file.
 *
 * Queue item structure:
 * {
 *   "payload":        { "...": "v2 payload" },
 *   "attempt_count":  2,
 *   "next_retry_at":  "2026-06-12T23:05:04+07:00",
 *   "last_error":     "HTTP 503 Service Unavailable",
 *   "queued_at":      "2026-06-12T23:00:00+07:00",
 *   "payload_version":"v2"
 * }
 *
 * Backoff formula: min(2^attempt, MAX_BACKOFF_SECONDS) + jitter
 * where jitter is a random value in [0, MAX_JITTER_MS / 1000] seconds.
 *
 * @package    NextLib-Agent
 * @subpackage Exporter
 * @version    2.0.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\Exporter;

class RetryScheduler
{
    /**
     * Maximum number of retry attempts per payload before discarding.
     */
    const MAX_RETRIES = 5;

    /**
     * Maximum backoff interval in seconds (caps the exponential growth).
     */
    const MAX_BACKOFF_SECONDS = 300;

    /**
     * Maximum random jitter in milliseconds added to each backoff interval.
     */
    const MAX_JITTER_MS = 1000;

    /**
     * Name of the JSON file used to persist the retry queue.
     */
    const QUEUE_FILE = 'pending_exports.json';

    /**
     * @var string Path to the directory that holds the queue file.
     */
    private $queuePath;

    /**
     * @param string $queuePath Absolute path to the queue directory.
     */
    public function __construct(string $queuePath)
    {
        $this->queuePath = rtrim($queuePath, DIRECTORY_SEPARATOR);
    }

    /**
     * Add a failed payload to the retry queue.
     *
     * The item is stored with attempt_count = 0 and next_retry_at computed
     * using computeBackoffInterval(0), meaning the first retry fires ~1-2 s
     * after enqueuing.
     *
     * @param array  $payload The payload that failed to send.
     * @param string $error   Human-readable error from the failed attempt.
     * @return bool True if the item was written to the queue successfully.
     */
    public function enqueue(array $payload, string $error): bool
    {
        $queue = $this->readQueue();

        $firstInterval = $this->computeBackoffInterval(0);
        $nextRetryAt = $this->addSecondsToNow($firstInterval);

        $queue[] = array(
            'payload'         => $payload,
            'attempt_count'   => 0,
            'next_retry_at'   => $nextRetryAt,
            'last_error'      => $error,
            'queued_at'       => date('c'),
            'payload_version' => isset($payload['schema_version']) ? 'v2' : 'v1',
        );

        return $this->writeQueue($queue);
    }

    /**
     * Return all queue items whose next_retry_at timestamp is <= now.
     *
     * Each returned element contains the original item plus a synthetic
     * `_queue_index` key that must be used with markSuccess() / markFailed()
     * to identify the item in the queue.
     *
     * @return array<int, array> Due items, each with an injected `_queue_index`.
     */
    public function getDueItems(): array
    {
        $queue = $this->readQueue();
        $now = time();
        $due = array();

        foreach ($queue as $index => $item) {
            $nextRetry = isset($item['next_retry_at'])
                ? strtotime($item['next_retry_at'])
                : 0;

            if ($nextRetry !== false && $nextRetry <= $now) {
                $item['_queue_index'] = $index;
                $due[] = $item;
            }
        }

        return $due;
    }

    /**
     * Remove a successfully sent item from the queue.
     *
     * Uses array_splice so that remaining indices stay valid for items
     * retrieved in the same getDueItems() call (process indices
     * in descending order when removing multiple items).
     *
     * @param int $index The `_queue_index` value returned by getDueItems().
     * @return bool True if the item was found and removed.
     */
    public function markSuccess(int $index): bool
    {
        $queue = $this->readQueue();

        if (!isset($queue[$index])) {
            return false;
        }

        array_splice($queue, $index, 1);

        return $this->writeQueue(array_values($queue));
    }

    /**
     * Record a new failure for a queued item.
     *
     * Increments attempt_count and computes the next retry timestamp using
     * the updated attempt number. If attempt_count reaches MAX_RETRIES the
     * item is removed from the queue (silently discarded).
     *
     * @param int    $index The `_queue_index` value returned by getDueItems().
     * @param string $error New error message from the latest failure.
     * @return bool True if the queue was written successfully.
     */
    public function markFailed(int $index, string $error): bool
    {
        $queue = $this->readQueue();

        if (!isset($queue[$index])) {
            return false;
        }

        $attempt = (int) (isset($queue[$index]['attempt_count']) ? $queue[$index]['attempt_count'] : 0);
        $attempt++;

        if ($attempt >= self::MAX_RETRIES) {
            // Discard: max retries exhausted
            array_splice($queue, $index, 1);
            return $this->writeQueue(array_values($queue));
        }

        $interval = $this->computeBackoffInterval($attempt);
        $queue[$index]['attempt_count'] = $attempt;
        $queue[$index]['next_retry_at'] = $this->addSecondsToNow($interval);
        $queue[$index]['last_error']    = $error;

        return $this->writeQueue($queue);
    }

    /**
     * Compute the retry interval for a given attempt number.
     *
     * Formula: min(2^attempt, MAX_BACKOFF_SECONDS) + jitter
     * where jitter is a uniformly random float in [0, MAX_JITTER_MS / 1000].
     *
     * Examples:
     *   attempt 0 → min(1,  300) + [0-1] → ~1–2  s
     *   attempt 1 → min(2,  300) + [0-1] → ~2–3  s
     *   attempt 2 → min(4,  300) + [0-1] → ~4–5  s
     *   attempt 3 → min(8,  300) + [0-1] → ~8–9  s
     *   attempt 4 → min(16, 300) + [0-1] → ~16–17 s
     *
     * @param int $attempt Zero-based attempt number.
     * @return float Interval in seconds (base + jitter).
     */
    public function computeBackoffInterval(int $attempt): float
    {
        $base   = min(pow(2, $attempt), self::MAX_BACKOFF_SECONDS);
        $jitter = mt_rand(0, self::MAX_JITTER_MS) / 1000.0;

        return (float) $base + $jitter;
    }

    /**
     * Return the current number of items in the retry queue.
     *
     * @return int Queue length.
     */
    public function getQueueSize(): int
    {
        return count($this->readQueue());
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    /**
     * Return the full path to the queue JSON file.
     */
    private function getQueueFilePath(): string
    {
        return $this->queuePath . DIRECTORY_SEPARATOR . self::QUEUE_FILE;
    }

    /**
     * Read and decode the queue file; returns an empty array on any error.
     *
     * @return array<int, array>
     */
    private function readQueue(): array
    {
        $filePath = $this->getQueueFilePath();

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
     * Atomically write the queue to disk using write-to-temp-then-rename.
     *
     * @param array $queue Queue data to persist.
     * @return bool True on success.
     */
    private function writeQueue(array $queue): bool
    {
        $filePath = $this->getQueueFilePath();
        $dir      = dirname($filePath);

        if (!is_dir($dir)) {
            if (!mkdir($dir, 0755, true)) {
                return false;
            }
        }

        $json = json_encode($queue, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        if ($json === false) {
            return false;
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
     * Return an ISO-8601 timestamp $seconds in the future.
     *
     * @param float $seconds Offset from now in seconds (may be fractional).
     * @return string ISO-8601 datetime string.
     */
    private function addSecondsToNow(float $seconds): string
    {
        // Use integer seconds for DateTime arithmetic; sub-second precision
        // is not meaningful for a retry scheduler.
        $future = new \DateTime();
        $future->modify('+' . (int) ceil($seconds) . ' seconds');
        return $future->format('c');
    }
}
