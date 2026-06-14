<?php
/**
 * Property-based tests for RetryScheduler.
 *
 * Tests Properties 7, 8, and 9 for the RetryScheduler component.
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\Exporter\RetryScheduler;

class RetrySchedulerPropertyTest extends TestCase
{
    /**
     * Temp directories created during tests, cleaned up in tearDown.
     *
     * @var string[]
     */
    private $tempDirs = array();

    protected function tearDown(): void
    {
        foreach ($this->tempDirs as $dir) {
            $queueFile = $dir . DIRECTORY_SEPARATOR . RetryScheduler::QUEUE_FILE;
            if (file_exists($queueFile)) {
                unlink($queueFile);
            }
            if (is_dir($dir)) {
                rmdir($dir);
            }
        }
        $this->tempDirs = array();
    }

    // =========================================================================
    // Property 7: Exponential Backoff Interval Computation
    // For any attempt n in [0, MAX_RETRIES), interval = min(2^n, 300) + jitter
    // where jitter ∈ [0, 1.0] seconds.
    // **Validates: Requirements 5.1, 5.2, 5.4**
    // =========================================================================

    /**
     * Feature: enhanced-agent-exporter, Property 7: Exponential Backoff Interval Computation
     *
     * For any attempt number 0–4, computeBackoffInterval() must return a value
     * in the range [base, base + 1.0 + epsilon) where base = min(2^attempt, 300).
     */
    public function testExponentialBackoffIntervalComputation(): void
    {
        $scheduler = new RetryScheduler(sys_get_temp_dir());
        $epsilon = 0.001;

        for ($i = 0; $i < 100; $i++) {
            $attempt = random_int(0, 4);

            $result = $scheduler->computeBackoffInterval($attempt);

            $base = min(pow(2, $attempt), 300);

            $this->assertGreaterThanOrEqual(
                $base,
                $result,
                "Attempt $attempt: interval $result must be >= base $base (iteration $i)"
            );

            $this->assertLessThan(
                $base + 1.0 + $epsilon,
                $result,
                "Attempt $attempt: interval $result must be < base + 1.0 + epsilon = " . ($base + 1.0 + $epsilon) . " (iteration $i)"
            );
        }
    }

    // =========================================================================
    // Property 8: Max Retry Limit Enforcement
    // After 5 markFailed calls the item is removed from the queue.
    // Each enqueued item must contain attempt_count, next_retry_at, last_error.
    // **Validates: Requirements 5.3, 5.6**
    // =========================================================================

    /**
     * Feature: enhanced-agent-exporter, Property 8: Max Retry Limit Enforcement
     *
     * After exactly MAX_RETRIES (5) markFailed calls, the RetryScheduler SHALL
     * remove the item from the queue. Each queued item SHALL contain the metadata
     * fields: attempt_count, next_retry_at, last_error.
     */
    public function testMaxRetryLimitEnforcement(): void
    {
        for ($i = 0; $i < 100; $i++) {
            // Fresh temp directory per iteration
            $tmpDir = $this->createTempDir();

            $scheduler = new RetryScheduler($tmpDir);

            // Enqueue a random payload
            $payload = $this->generateRandomPayload();
            $error = 'HTTP 503 error iteration ' . $i;
            $result = $scheduler->enqueue($payload, $error);

            $this->assertTrue($result, "enqueue() should return true (iteration $i)");

            // Verify the enqueued item has the required metadata fields
            $queueData = $this->readQueueJson($tmpDir);
            $this->assertCount(1, $queueData, "Queue should have 1 item after enqueue (iteration $i)");

            $item = $queueData[0];
            $this->assertArrayHasKey('attempt_count', $item, "Queue item must have attempt_count (iteration $i)");
            $this->assertArrayHasKey('next_retry_at', $item, "Queue item must have next_retry_at (iteration $i)");
            $this->assertArrayHasKey('last_error', $item, "Queue item must have last_error (iteration $i)");

            // Call markFailed 5 times — after the 5th call the item must be gone.
            // markFailed(index=0, error) — item stays at index 0 until removed.
            for ($call = 1; $call <= 5; $call++) {
                $failError = 'retry error ' . $call . ' iteration ' . $i;
                $scheduler->markFailed(0, $failError);

                if ($call < 5) {
                    // Item should still be in the queue (attempt_count < MAX_RETRIES)
                    $queueAfter = $this->readQueueJson($tmpDir);
                    $this->assertCount(
                        1,
                        $queueAfter,
                        "Queue should still have 1 item after markFailed call $call (iteration $i)"
                    );
                }
            }

            // After 5 markFailed calls: attempt_count reached MAX_RETRIES → removed
            $finalQueue = $this->readQueueJson($tmpDir);
            $this->assertCount(
                0,
                $finalQueue,
                "Queue must be empty after 5 markFailed calls (iteration $i)"
            );

            // Clean up temp file for next iteration
            $this->cleanTempDir($tmpDir);
        }
    }

    // =========================================================================
    // Property 9: Successful Retry Removes from Queue
    // After markSuccess, the item no longer appears in getDueItems().
    // **Validates: Requirements 5.5**
    // =========================================================================

    /**
     * Feature: enhanced-agent-exporter, Property 9: Successful Retry Removes from Queue
     *
     * For any payload in the retry queue that is successfully sent, markSuccess()
     * SHALL remove that payload from the queue such that it no longer appears
     * in subsequent getDueItems() calls.
     */
    public function testSuccessfulRetryRemovesFromQueue(): void
    {
        $tmpDir = $this->createTempDir();

        for ($i = 0; $i < 100; $i++) {
            // Enqueue 1–5 random payloads
            $count = random_int(1, 5);
            $scheduler = new RetryScheduler($tmpDir);

            $payloads = array();
            for ($j = 0; $j < $count; $j++) {
                $payload = $this->generateRandomPayload($i * 100 + $j);
                $payloads[] = $payload;
                $scheduler->enqueue($payload, 'initial error ' . $j);
            }

            // Force all next_retry_at to the past so getDueItems() returns them all
            $this->forceAllItemsPast($tmpDir);

            // Get all due items — should be all $count items
            $dueItems = $scheduler->getDueItems();
            $this->assertCount(
                $count,
                $dueItems,
                "getDueItems() should return all $count items (iteration $i)"
            );

            // Pick a random due item to mark as successful
            $pickedIndex = random_int(0, count($dueItems) - 1);
            $pickedItem = $dueItems[$pickedIndex];
            $pickedQueueIndex = $pickedItem['_queue_index'];
            $pickedPayload = $pickedItem['payload'];

            $scheduler->markSuccess($pickedQueueIndex);

            // Force remaining items to past again and get due items
            $this->forceAllItemsPast($tmpDir);
            $remainingDueItems = $scheduler->getDueItems();

            // The marked-success item must NOT appear in the new due items list
            foreach ($remainingDueItems as $remaining) {
                $this->assertNotEquals(
                    $pickedPayload,
                    $remaining['payload'],
                    "The marked-success payload must not appear in getDueItems() after markSuccess (iteration $i)"
                );
            }

            // Remaining count should be $count - 1
            $this->assertCount(
                $count - 1,
                $remainingDueItems,
                "After markSuccess, getDueItems() should return " . ($count - 1) . " items (iteration $i)"
            );

            // Clean up for the next iteration
            $this->cleanTempDir($tmpDir);
        }

        // Remove the temp directory at the very end
        if (is_dir($tmpDir)) {
            rmdir($tmpDir);
        }
        // Remove from the list so tearDown doesn't double-rmdir
        $this->tempDirs = array_filter($this->tempDirs, function ($d) use ($tmpDir) {
            return $d !== $tmpDir;
        });
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    /**
     * Create a unique temporary directory and register it for cleanup.
     *
     * @return string Absolute path to the newly created directory.
     */
    private function createTempDir(): string
    {
        $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'retry_test_' . uniqid('', true);
        mkdir($dir, 0755, true);
        $this->tempDirs[] = $dir;
        return $dir;
    }

    /**
     * Delete only the queue JSON file inside $dir (keep the directory for reuse).
     *
     * @param string $dir Path returned by createTempDir().
     */
    private function cleanTempDir(string $dir): void
    {
        $queueFile = $dir . DIRECTORY_SEPARATOR . RetryScheduler::QUEUE_FILE;
        if (file_exists($queueFile)) {
            unlink($queueFile);
        }
    }

    /**
     * Read and decode the pending_exports.json inside $dir.
     *
     * @param  string $dir Queue directory path.
     * @return array  Decoded queue array (empty array if file missing or invalid).
     */
    private function readQueueJson(string $dir): array
    {
        $path = $dir . DIRECTORY_SEPARATOR . RetryScheduler::QUEUE_FILE;
        if (!file_exists($path)) {
            return array();
        }
        $content = file_get_contents($path);
        if ($content === false || $content === '') {
            return array();
        }
        $data = json_decode($content, true);
        return is_array($data) ? $data : array();
    }

    /**
     * Rewrite all next_retry_at values to a timestamp in the past so that
     * getDueItems() returns every item in the queue.
     *
     * @param string $dir Queue directory path.
     */
    private function forceAllItemsPast(string $dir): void
    {
        $data = $this->readQueueJson($dir);
        $past = date('c', strtotime('-1 hour'));
        foreach ($data as &$item) {
            $item['next_retry_at'] = $past;
        }
        unset($item);
        $path = $dir . DIRECTORY_SEPARATOR . RetryScheduler::QUEUE_FILE;
        file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }

    /**
     * Generate a random associative payload for testing.
     *
     * @param  int   $seed Optional seed value to vary payloads across iterations.
     * @return array Random payload array.
     */
    private function generateRandomPayload(int $seed = 0): array
    {
        return array(
            'tenant_id'   => 'tenant-' . $seed . '-' . random_int(1000, 9999),
            'date'        => sprintf(
                '%04d-%02d-%02d',
                random_int(2020, 2030),
                random_int(1, 12),
                random_int(1, 28)
            ),
            'visitor_count' => random_int(0, 500),
            'loan_count'    => random_int(0, 200),
            'return_count'  => random_int(0, 200),
            'seed'          => $seed,
        );
    }
}
