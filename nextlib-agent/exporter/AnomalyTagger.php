<?php
/**
 * Anomaly Tagger
 *
 * Detects anomalous patterns in daily and snapshot metrics by comparing
 * them against a 30-day rolling baseline. Adds flag strings to payloads
 * when thresholds are exceeded.
 *
 * Detection rules:
 *   - visitor_spike: visitor_count > 2× 30-day baseline
 *   - zero_visitors_weekday: visitor_count = 0 on a weekday (Mon–Fri)
 *   - loan_spike: loan_count > 2× 30-day baseline
 *   - overdue_spike: active_overdue_count > 3× 30-day baseline
 *
 * Privacy: Only aggregate statistics are examined. No PII is processed.
 *
 * @package    NextLib-Agent
 * @subpackage Exporter
 * @version    2.0.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\Exporter;

class AnomalyTagger
{
    /**
     * @var \PDO Database connection to SLiMS
     */
    private $db;

    /**
     * @var MetricsCollector Collector used to fetch historical metrics
     */
    private $collector;

    /**
     * @param \PDO             $db        Database connection to SLiMS
     * @param MetricsCollector $collector Metrics collector instance
     */
    public function __construct(\PDO $db, MetricsCollector $collector)
    {
        $this->db        = $db;
        $this->collector = $collector;
    }

    /**
     * Compute the 30-day rolling arithmetic mean for a metric.
     *
     * Window: the 30 days immediately preceding $targetDate (days -30 to -1,
     * exclusive of $targetDate itself). For 'active_overdue_count' the value
     * is fetched from collectSnapshotMetrics(); all other metrics are fetched
     * from collectDailyMetrics(), defaulting to 0 when the key is absent.
     *
     * Returns 0.0 when $metricName is not one of the recognised metrics.
     *
     * @param string $metricName  Metric key (e.g. 'visitor_count')
     * @param string $targetDate  Reference date in 'Y-m-d' format
     * @return float              Arithmetic mean over the 30-day window
     */
    public function computeBaseline(string $metricName, string $targetDate): float
    {
        $recognisedDailyMetrics    = array(
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
        $recognisedSnapshotMetrics = array(
            'active_overdue_count',
            'total_collection_size',
            'active_member_count',
        );

        $isSnapshot = in_array($metricName, $recognisedSnapshotMetrics, true);
        $isDaily    = in_array($metricName, $recognisedDailyMetrics, true);

        if (!$isSnapshot && !$isDaily) {
            return 0.0;
        }

        $baseTimestamp = strtotime($targetDate);
        $sum           = 0;

        for ($offset = 1; $offset <= 30; $offset++) {
            $day = date('Y-m-d', strtotime("-{$offset} day", $baseTimestamp));

            if ($metricName === 'active_overdue_count') {
                $metrics = $this->collector->collectSnapshotMetrics($day);
                $value   = isset($metrics['active_overdue_count'])
                    ? (int) $metrics['active_overdue_count']
                    : 0;
            } elseif ($isSnapshot) {
                $metrics = $this->collector->collectSnapshotMetrics($day);
                $value   = isset($metrics[$metricName])
                    ? (int) $metrics[$metricName]
                    : 0;
            } else {
                $metrics = $this->collector->collectDailyMetrics($day);
                $value   = isset($metrics[$metricName])
                    ? (int) $metrics[$metricName]
                    : 0;
            }

            $sum += $value;
        }

        return (float) ($sum / 30);
    }

    /**
     * Determine whether a date falls on a weekday (Monday–Friday).
     *
     * Uses PHP's date('N') convention: 1 = Monday … 5 = Friday,
     * 6 = Saturday, 7 = Sunday.
     *
     * @param string $date Date in 'Y-m-d' format
     * @return bool True for Monday through Friday, false for Saturday/Sunday
     */
    public function isWeekday(string $date): bool
    {
        $dayNumber = (int) date('N', strtotime($date));
        return $dayNumber >= 1 && $dayNumber <= 5;
    }

    /**
     * Detect anomalies in a day's metrics and return flag strings.
     *
     * Computes 30-day baselines for visitor_count, loan_count, and
     * active_overdue_count, then evaluates each rule:
     *
     *   1. visitor_count > 2 × baseline_visitor  → "visitor_spike"
     *   2. visitor_count === 0 AND weekday        → "zero_visitors_weekday"
     *   3. loan_count > 2 × baseline_loan         → "loan_spike"
     *   4. active_overdue_count > 3 × baseline_overdue → "overdue_spike"
     *
     * @param array  $dailyMetrics    Daily metrics for $targetDate
     * @param array  $snapshotMetrics Snapshot metrics for $targetDate
     * @param string $targetDate      Date being analysed in 'Y-m-d' format
     * @return array                  List of anomaly flag strings (may be empty)
     */
    public function detectAnomalies(
        array $dailyMetrics,
        array $snapshotMetrics,
        string $targetDate
    ): array {
        $flags = array();

        $baselineVisitor = $this->computeBaseline('visitor_count', $targetDate);
        $baselineLoan    = $this->computeBaseline('loan_count', $targetDate);
        $baselineOverdue = $this->computeBaseline('active_overdue_count', $targetDate);

        $visitorCount   = isset($dailyMetrics['visitor_count'])
            ? (int) $dailyMetrics['visitor_count']
            : 0;
        $loanCount      = isset($dailyMetrics['loan_count'])
            ? (int) $dailyMetrics['loan_count']
            : 0;
        $overdueCount   = isset($snapshotMetrics['active_overdue_count'])
            ? (int) $snapshotMetrics['active_overdue_count']
            : 0;

        // Rule 1: visitor spike
        if ($visitorCount > 2 * $baselineVisitor) {
            $flags[] = 'visitor_spike';
        }

        // Rule 2: zero visitors on a weekday
        if ($visitorCount === 0 && $this->isWeekday($targetDate)) {
            $flags[] = 'zero_visitors_weekday';
        }

        // Rule 3: loan spike
        if ($loanCount > 2 * $baselineLoan) {
            $flags[] = 'loan_spike';
        }

        // Rule 4: overdue spike
        if ($overdueCount > 3 * $baselineOverdue) {
            $flags[] = 'overdue_spike';
        }

        return $flags;
    }
}
