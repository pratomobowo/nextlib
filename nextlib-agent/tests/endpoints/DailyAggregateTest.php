<?php
namespace NextLibAgent\endpoints;

use PHPUnit\Framework\TestCase;

class DailyAggregateTest extends TestCase
{
    private $pdo;

    protected function setUp(): void
    {
        $this->pdo = new \PDO('sqlite::memory:');
        $this->pdo->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
        $this->pdo->exec("
            CREATE TABLE loan (
                loan_id INTEGER PRIMARY KEY,
                loan_date DATE,
                return_date DATE,
                member_id VARCHAR(50),
                item_code VARCHAR(50)
            );
            CREATE TABLE member (
                member_id VARCHAR(50) PRIMARY KEY,
                member_name VARCHAR(255),
                register_date DATE
            );
            CREATE TABLE biblio (
                biblio_id INTEGER PRIMARY KEY,
                classification VARCHAR(50),
                input_date DATE
            );
            CREATE TABLE item (
                item_id INTEGER PRIMARY KEY,
                biblio_id INTEGER,
                item_code VARCHAR(50) UNIQUE,
                input_date DATE,
                coll_type_id INTEGER
            );
            CREATE TABLE visitor_log (
                visitor_id INTEGER PRIMARY KEY,
                member_id VARCHAR(50),
                checkin_date DATE
            );
        ");
    }

    public function testReturnsEmptyDaysForEmptyRange(): void
    {
        $endpoint = new DailyAggregate($this->pdo);
        $result = $endpoint->handle(['start_date' => '2024-01-01', 'end_date' => '2024-01-01']);
        $this->assertEquals('2.0', $result['schema_version']);
        $this->assertCount(0, $result['days']);
    }

    public function testReturnsDailyMetricsForRange(): void
    {
        $this->pdo->exec("INSERT INTO loan (loan_date, return_date) VALUES ('2024-01-15', NULL), ('2024-01-15', '2024-01-15')");
        $this->pdo->exec("INSERT INTO visitor_log (member_id, checkin_date) VALUES ('m1', '2024-01-15')");

        $endpoint = new DailyAggregate($this->pdo);
        $result = $endpoint->handle(['start_date' => '2024-01-15', 'end_date' => '2024-01-15']);

        $this->assertCount(1, $result['days']);
        $day = $result['days'][0];
        $this->assertEquals('2024-01-15', $day['date']);
        $this->assertEquals(2, $day['daily_metrics']['loan_count']);
        $this->assertEquals(1, $day['daily_metrics']['return_count']);
        $this->assertEquals(1, $day['daily_metrics']['visitor_count']);
    }

    public function testRejectsRangeOver366Days(): void
    {
        $endpoint = new DailyAggregate($this->pdo);
        $result = $endpoint->handle(['start_date' => '2020-01-01', 'end_date' => '2024-01-01']);
        $this->assertEquals('INVALID_DATE_RANGE', $result['code']);
    }

    public function testRejectsMalformedDates(): void
    {
        $endpoint = new DailyAggregate($this->pdo);
        $result = $endpoint->handle(['start_date' => '2024-13-99', 'end_date' => '2024-01-01']);
        $this->assertEquals('INVALID_DATE_RANGE', $result['code']);
    }

    public function testRejectsInvertedRange(): void
    {
        $endpoint = new DailyAggregate($this->pdo);
        $result = $endpoint->handle(['start_date' => '2024-12-31', 'end_date' => '2024-01-01']);
        $this->assertEquals('INVALID_DATE_RANGE', $result['code']);
    }

    public function testReturnsDbUnavailableWhenConnectionMissing(): void
    {
        $endpoint = new DailyAggregate(null);
        $result = $endpoint->handle(['start_date' => '2024-01-01', 'end_date' => '2024-01-01']);
        $this->assertEquals('DB_CONNECTION_FAILED', $result['code']);
    }
}
