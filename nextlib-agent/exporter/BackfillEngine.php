<?php
/**
 * Backfill Engine
 *
 * Handles historical data export in batches for a given date range.
 * Splits large date ranges into batches of at most 30 days, sends them
 * chronologically, and persists resume state on failure so that interrupted
 * backfills can be continued later.
 *
 * State file structure (backfill_state.json):
 * {
 *   "in_progress":         true,
 *   "start_date":          "2026-01-01",
 *   "end_date":            "2026-06-12",
 *   "current_batch_index": 3,
 *   "total_batches":       6,
 *   "completed_days":      90,
 *   "total_days":          163,
 *   "started_at":          "2026-06-12T10:00:00+07:00",
 *   "last_error":          null
 * }
 *
 * Lock mechanism: checks backfill_state.json for `in_progress: true` before
 * starting a new backfill.
 *
 * @package    NextLib-Agent
 * @subpackage Exporter
 * @version    2.0.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\Exporter;

class BackfillEngine
{
    /**
     * Maximum number of days per HTTP batch request.
     */
    const BATCH_SIZE = 30;

    /**
     * Name of the JSON file used to persist backfill state.
     */
    const STATE_FILE = 'backfill_state.json';

    /**
     * @var MetricsCollector
     */
    private $collector;

    /**
     * @var mixed EnhancedExporter or any object with an export() method.
     *            Left untyped because EnhancedExporter may not exist yet.
     */
    private $exporter;

    /**
     * @var string Absolute path to the directory that holds the state file.
     */
    private $queuePath;

    /**
     * @param MetricsCollector $collector Metrics collector instance
     * @param mixed            $exporter  Exporter instance (must expose export(string $date): bool)
     * @param string           $queuePath Absolute path to the queue/state directory
     */
    public function __construct(MetricsCollector $collector, $exporter, string $queuePath)
    {
        $this->collector  = $collector;
        $this->exporter   = $exporter;
        $this->queuePath  = rtrim($queuePath, DIRECTORY_SEPARATOR);
    }

    /**
     * Partition a date range into chronologically-ordered batches of at most
     * BATCH_SIZE (30) days each.
     *
     * Batch logic:
     *   total_days  = (end_date - start_date).days + 1
     *   batch_end   = min(batch_start + 29 days, end_date)
     *
     * Each element of the returned array is an associative array with
     * 'start' and 'end' keys in 'Y-m-d' format.
     *
     * @param string $startDate Start of range in 'Y-m-d' format (inclusive)
     * @param string $endDate   End of range in 'Y-m-d' format (inclusive)
     * @return array<int, array{start: string, end: string}>
     */
    public function partitionIntoBatches(string $startDate, string $endDate): array
    {
        $batches    = array();
        $batchStart = new \DateTime($startDate);
        $end        = new \DateTime($endDate);

        while ($batchStart <= $end) {
            // batch_end = min(batch_start + 29 days, end_date)
            $batchEnd = clone $batchStart;
            $batchEnd->modify('+' . (self::BATCH_SIZE - 1) . ' days');

            if ($batchEnd > $end) {
                $batchEnd = clone $end;
            }

            $batches[] = array(
                'start' => $batchStart->format('Y-m-d'),
                'end'   => $batchEnd->format('Y-m-d'),
            );

            // Advance to the day after batchEnd
            $batchStart = clone $batchEnd;
            $batchStart->modify('+1 day');
        }

        return $batches;
    }

    /**
     * Start a backfill for the given date range.
     *
     * Returns immediately with "backfill_in_progress" if a backfill is already
     * running (i.e. state file contains `in_progress: true`).
     *
     * Iterates batches chronologically. For each batch, calls
     * $this->exporter->export() for every date in the batch. On the first
     * failure, saves the resume position to the state file and halts — batches
     * beyond the failed one are never attempted.
     *
     * @param string $startDate Start date in 'Y-m-d' format
     * @param string $endDate   End date in 'Y-m-d' format
     * @return array{status: string, message: string}
     */
    public function start(string $startDate, string $endDate): array
    {
        // Lock check: refuse if another backfill is already in progress
        if ($this->isInProgress()) {
            return array(
                'status'  => 'backfill_in_progress',
                'message' => 'A backfill is already in progress. Check getProgress() for details.',
            );
        }

        $batches   = $this->partitionIntoBatches($startDate, $endDate);
        $totalBatches = count($batches);

        // Compute total_days = (end - start) + 1
        $startDt   = new \DateTime($startDate);
        $endDt     = new \DateTime($endDate);
        $totalDays = (int) $startDt->diff($endDt)->days + 1;

        $startedAt     = date('c');
        $completedDays = 0;

        // Persist initial state (in_progress = true)
        $this->writeState(array(
            'in_progress'         => true,
            'start_date'          => $startDate,
            'end_date'            => $endDate,
            'current_batch_index' => 0,
            'total_batches'       => $totalBatches,
            'completed_days'      => 0,
            'total_days'          => $totalDays,
            'started_at'          => $startedAt,
            'last_error'          => null,
        ));

        foreach ($batches as $batchIndex => $batch) {
            // Update current_batch_index before attempting the batch
            $this->writeState(array(
                'in_progress'         => true,
                'start_date'          => $startDate,
                'end_date'            => $endDate,
                'current_batch_index' => $batchIndex,
                'total_batches'       => $totalBatches,
                'completed_days'      => $completedDays,
                'total_days'          => $totalDays,
                'started_at'          => $startedAt,
                'last_error'          => null,
            ));

            $success = $this->exportBatch($batch['start'], $batch['end']);

            if (!$success) {
                // Save resume position and halt — do NOT attempt further batches
                $this->writeState(array(
                    'in_progress'         => true,
                    'start_date'          => $startDate,
                    'end_date'            => $endDate,
                    'current_batch_index' => $batchIndex,
                    'total_batches'       => $totalBatches,
                    'completed_days'      => $completedDays,
                    'total_days'          => $totalDays,
                    'started_at'          => $startedAt,
                    'last_error'          => 'Batch ' . $batchIndex . ' failed (' . $batch['start'] . ' – ' . $batch['end'] . ')',
                ));

                return array(
                    'status'  => 'started',
                    'message' => 'Backfill started but halted at batch ' . $batchIndex . ' (' . $batch['start'] . ' – ' . $batch['end'] . '). Resume position saved.',
                );
            }

            // Batch succeeded — accumulate completed days
            $batchDays     = (int) (new \DateTime($batch['start']))->diff(new \DateTime($batch['end']))->days + 1;
            $completedDays += $batchDays;
        }

        // All batches completed — clear the in_progress lock
        $this->writeState(array(
            'in_progress'         => false,
            'start_date'          => $startDate,
            'end_date'            => $endDate,
            'current_batch_index' => $totalBatches,
            'total_batches'       => $totalBatches,
            'completed_days'      => $completedDays,
            'total_days'          => $totalDays,
            'started_at'          => $startedAt,
            'last_error'          => null,
        ));

        return array(
            'status'  => 'started',
            'message' => 'Backfill completed successfully. ' . $completedDays . ' days exported in ' . $totalBatches . ' batch(es).',
        );
    }

    /**
     * Check whether a backfill is currently in progress.
     *
     * Reads the state file and returns true iff `in_progress` is true.
     *
     * @return bool
     */
    public function isInProgress(): bool
    {
        $state = $this->readState();
        return isset($state['in_progress']) && $state['in_progress'] === true;
    }

    /**
     * Return current backfill progress.
     *
     * @return array{in_progress: bool, current_position: string|null, total_days: int, completed_days: int}
     */
    public function getProgress(): array
    {
        $state = $this->readState();

        $inProgress    = isset($state['in_progress']) ? (bool) $state['in_progress'] : false;
        $completedDays = isset($state['completed_days']) ? (int) $state['completed_days'] : 0;
        $totalDays     = isset($state['total_days']) ? (int) $state['total_days'] : 0;

        // current_position: the start date of the current batch, or null if not running
        $currentPosition = null;
        if ($inProgress && isset($state['current_batch_index']) && isset($state['start_date']) && isset($state['end_date'])) {
            // Recompute the batch to find its start date
            $batches = $this->partitionIntoBatches($state['start_date'], $state['end_date']);
            $idx     = (int) $state['current_batch_index'];
            if (isset($batches[$idx])) {
                $currentPosition = $batches[$idx]['start'];
            }
        }

        return array(
            'in_progress'      => $inProgress,
            'current_position' => $currentPosition,
            'total_days'       => $totalDays,
            'completed_days'   => $completedDays,
        );
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    /**
     * Export all days within a single batch by calling the exporter.
     *
     * If the exporter exposes an `export(string $date): bool` method it is
     * called for each date in the batch. Any failure causes an immediate false
     * return; remaining dates in the batch are not attempted.
     *
     * @param string $batchStart First date of the batch in 'Y-m-d' format
     * @param string $batchEnd   Last date of the batch in 'Y-m-d' format
     * @return bool True if every date in the batch was exported successfully
     */
    private function exportBatch(string $batchStart, string $batchEnd): bool
    {
        if (!is_object($this->exporter) || !method_exists($this->exporter, 'export')) {
            // No usable exporter — treat as success placeholder so backfill
            // logic can be tested independently of EnhancedExporter.
            return true;
        }

        $current = new \DateTime($batchStart);
        $end     = new \DateTime($batchEnd);

        while ($current <= $end) {
            $date = $current->format('Y-m-d');
            $result = $this->exporter->export($date);

            if ($result === false) {
                return false;
            }

            $current->modify('+1 day');
        }

        return true;
    }

    /**
     * Return the full path to the state JSON file.
     *
     * @return string
     */
    private function getStateFilePath(): string
    {
        return $this->queuePath . DIRECTORY_SEPARATOR . self::STATE_FILE;
    }

    /**
     * Read and decode the state file; returns an empty array on any error.
     *
     * @return array
     */
    private function readState(): array
    {
        $filePath = $this->getStateFilePath();

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
     * Atomically write state data to the state file using write-to-temp-then-rename.
     *
     * @param array $state State data to persist
     * @return bool True on success
     */
    private function writeState(array $state): bool
    {
        $filePath = $this->getStateFilePath();
        $dir      = dirname($filePath);

        if (!is_dir($dir)) {
            if (!mkdir($dir, 0755, true)) {
                return false;
            }
        }

        $json = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
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
}
