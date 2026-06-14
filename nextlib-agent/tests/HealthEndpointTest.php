<?php
/**
 * Unit tests for Health check endpoint.
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\endpoints\Health;
use PDO;

class HealthEndpointTest extends TestCase
{
    /** @var PDO */
    private $db;

    /** @var string */
    private $tempDir;

    protected function setUp(): void
    {
        $this->db = new PDO('sqlite::memory:');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        $this->tempDir = sys_get_temp_dir() . '/health_test_' . getmypid() . '_' . mt_rand();
        mkdir($this->tempDir, 0755, true);
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

    public function testHealthReturnsHealthyWhenDbConnectedAndNoStateFiles(): void
    {
        $endpoint = new Health($this->db, $this->tempDir);
        $result = $endpoint->handle(array());

        $this->assertSame('healthy', $result['status']);
        $this->assertTrue($result['database']['connected']);
        $this->assertNull($result['database']['error']);
        $this->assertNull($result['last_export']);
        $this->assertFalse($result['backfill']['in_progress']);
        $this->assertArrayHasKey('system', $result);
        $this->assertSame(PHP_VERSION, $result['system']['php_version']);
    }

    public function testHealthReturnsDegradedWhenDbNotConnected(): void
    {
        $endpoint = new Health(null, $this->tempDir);
        $result = $endpoint->handle(array());

        $this->assertSame('degraded', $result['status']);
        $this->assertFalse($result['database']['connected']);
        $this->assertNull($result['last_export']);
    }

    public function testHealthReadsStateFilesCorrectly(): void
    {
        // Write mock last_export.json
        $lastExportData = array(
            'last_successful_export' => '2026-06-12T10:00:00+07:00',
            'last_export_date' => '2026-06-12',
            'export_schedule' => 'daily',
        );
        file_put_contents($this->tempDir . '/last_export.json', json_encode($lastExportData));

        // Write mock backfill_state.json (in progress)
        $backfillData = array(
            'in_progress' => true,
            'start_date' => '2026-01-01',
            'end_date' => '2026-01-31',
            'current_batch_index' => 0,
            'total_batches' => 1,
            'completed_days' => 0,
            'total_days' => 31,
            'started_at' => '2026-06-12T10:00:00+07:00',
            'last_error' => null,
        );
        file_put_contents($this->tempDir . '/backfill_state.json', json_encode($backfillData));

        $endpoint = new Health($this->db, $this->tempDir);
        $result = $endpoint->handle(array());

        $this->assertSame('healthy', $result['status']);
        $this->assertEquals($lastExportData, $result['last_export']);
        
        $this->assertTrue($result['backfill']['in_progress']);
        $this->assertEquals('2026-01-01', $result['backfill']['current_position']);
        $this->assertEquals(31, $result['backfill']['total_days']);
        $this->assertEquals(0, $result['backfill']['completed_days']);
    }
}
