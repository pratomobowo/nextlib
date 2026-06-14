<?php
/**
 * Unit tests for AgentCommand endpoint.
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\endpoints\AgentCommand;
use NextLibAgent\lib\HttpClient;
use PDO;

class AgentCommandEndpointTest extends TestCase
{
    /** @var PDO */
    private $db;

    /** @var string */
    private $tempDir;

    /** @var array */
    private $mockConfig;

    protected function setUp(): void
    {
        $this->db = new PDO('sqlite::memory:');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        // Required tables for MetricsCollector queries inside AgentCommand
        $this->db->exec("CREATE TABLE visitor_count (id INTEGER PRIMARY KEY, member_id VARCHAR(20), checkin_date DATETIME)");
        $this->db->exec("CREATE TABLE loan (loan_id INTEGER PRIMARY KEY, member_id VARCHAR(20), loan_date DATE, return_date DATE, due_date DATE, is_return INTEGER DEFAULT 0, is_lent INTEGER DEFAULT 1)");
        $this->db->exec("CREATE TABLE member (member_id INTEGER PRIMARY KEY, register_date DATE, expire_date DATE)");
        $this->db->exec("CREATE TABLE biblio (biblio_id INTEGER PRIMARY KEY, input_date DATE)");
        $this->db->exec("CREATE TABLE item (item_id INTEGER PRIMARY KEY, input_date DATE)");
        $this->db->exec("CREATE TABLE fines (fines_id INTEGER PRIMARY KEY, fines_date DATE, debet INTEGER, credit INTEGER)");
        $this->db->exec("CREATE TABLE reserve (reserve_id INTEGER PRIMARY KEY, reserve_date DATE)");

        $this->tempDir = sys_get_temp_dir() . '/agent_cmd_test_' . getmypid() . '_' . mt_rand();
        mkdir($this->tempDir, 0755, true);

        $this->mockConfig = array(
            'tenant_id' => 'mock-tenant-id',
            'api_secret' => 'mock-api-secret',
            'cloud_base_url' => 'https://cloud.nextlib.test',
            'http_timeout' => 5,
        );
    }

    protected function tearDown(): void
    {
        $files = glob($this->tempDir . '/*');
        if (is_array($files)) {
            foreach ($files as $file) {
                if (is_file($file)) {
                    unlink($file);
                }
            }
        }
        if (is_dir($this->tempDir)) {
            rmdir($this->tempDir);
        }
    }

    public function testMissingCommandReturnsError(): void
    {
        $endpoint = new AgentCommand($this->db, $this->mockConfig, $this->tempDir);
        $result = $endpoint->handle(array());

        $this->assertTrue($result['error']);
        $this->assertSame('INVALID_PARAMS', $result['code']);
    }

    public function testUnknownCommandReturnsError(): void
    {
        $endpoint = new AgentCommand($this->db, $this->mockConfig, $this->tempDir);
        $result = $endpoint->handle(array('command' => 'unknown'));

        $this->assertTrue($result['error']);
        $this->assertSame('UNKNOWN_COMMAND', $result['code']);
    }

    public function testBackfillCommandValidatesDates(): void
    {
        $endpoint = new AgentCommand($this->db, $this->mockConfig, $this->tempDir);
        
        $result = $endpoint->handle(array('command' => 'backfill'));
        $this->assertTrue($result['error']);
        $this->assertSame('INVALID_PARAMS', $result['code']);

        $result = $endpoint->handle(array('command' => 'backfill', 'start_date' => 'invalid', 'end_date' => 'invalid'));
        $this->assertTrue($result['error']);
        $this->assertSame('INVALID_PARAMS', $result['code']);
    }

    public function testBackfillStatusCommandReturnsIdleProgressWhenNoState(): void
    {
        $endpoint = new AgentCommand($this->db, $this->mockConfig, $this->tempDir);
        $result = $endpoint->handle(array('command' => 'backfill_status'));

        $this->assertSame('success', $result['status']);
        $this->assertFalse($result['progress']['in_progress']);
        $this->assertNull($result['progress']['current_position']);
    }

    public function testTriggerExportDispatchesCorrectly(): void
    {
        $httpClient = $this->createMock(HttpClient::class);
        $httpClient->expects($this->once())
            ->method('post')
            ->willReturn(array('status' => 200, 'body' => '', 'error' => null));

        $endpoint = new AgentCommand($this->db, $this->mockConfig, $this->tempDir, $httpClient);
        $result = $endpoint->handle(array('command' => 'trigger_export', 'date' => '2026-06-12'));

        $this->assertSame('success', $result['status']);
        $this->assertStringContainsString('completed successfully', $result['message']);
    }
}
