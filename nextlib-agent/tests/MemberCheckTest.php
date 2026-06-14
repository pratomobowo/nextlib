<?php
/**
 * Unit tests for MemberCheck endpoint.
 *
 * Tests the MemberCheck::handle() method using an in-memory SQLite database
 * with member and fines tables matching SLiMS structure.
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\endpoints\MemberCheck;
use PDO;

class MemberCheckTest extends TestCase
{
    /**
     * @var PDO In-memory SQLite database
     */
    private $db;

    protected function setUp(): void
    {
        $this->db = new PDO('sqlite::memory:');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        // Create member table matching SLiMS schema
        $this->db->exec("
            CREATE TABLE member (
                member_id VARCHAR(20) PRIMARY KEY,
                member_name VARCHAR(100) NOT NULL,
                member_email VARCHAR(100) DEFAULT '',
                member_type_id INT DEFAULT 0,
                expire_date DATE DEFAULT NULL,
                is_pending INT DEFAULT 0
            )
        ");

        // Create fines table matching SLiMS schema
        $this->db->exec("
            CREATE TABLE fines (
                fines_id INTEGER PRIMARY KEY AUTOINCREMENT,
                member_id VARCHAR(20) NOT NULL,
                debet DECIMAL(10,2) DEFAULT 0,
                credit DECIMAL(10,2) DEFAULT 0,
                description VARCHAR(255) DEFAULT '',
                fines_date DATE DEFAULT NULL
            )
        ");

        // Seed member data
        $insertMember = $this->db->prepare(
            "INSERT INTO member (member_id, member_name, member_email, member_type_id, expire_date, is_pending) VALUES (:id, :name, :email, :type, :expire, :pending)"
        );

        // Active member (expire date in the future)
        $insertMember->execute(array(
            'id' => 'M001',
            'name' => 'John Doe',
            'email' => 'john@example.com',
            'type' => 1,
            'expire' => '2030-12-31',
            'pending' => 0,
        ));

        // Expired member
        $insertMember->execute(array(
            'id' => 'M002',
            'name' => 'Jane Smith',
            'email' => 'jane@example.com',
            'type' => 1,
            'expire' => '2020-01-01',
            'pending' => 0,
        ));

        // Pending member
        $insertMember->execute(array(
            'id' => 'M003',
            'name' => 'Bob Wilson',
            'email' => 'bob@example.com',
            'type' => 2,
            'expire' => '2030-12-31',
            'pending' => 1,
        ));

        // Active member with no fines
        $insertMember->execute(array(
            'id' => 'M004',
            'name' => 'Alice Brown',
            'email' => 'alice@example.com',
            'type' => 1,
            'expire' => '2030-06-30',
            'pending' => 0,
        ));

        // Seed fines data
        $insertFine = $this->db->prepare(
            "INSERT INTO fines (member_id, debet, credit, description, fines_date) VALUES (:member_id, :debet, :credit, :description, :fines_date)"
        );

        // Active fine for M001 (debet > credit)
        $insertFine->execute(array(
            'member_id' => 'M001',
            'debet' => 5000.00,
            'credit' => 2000.00,
            'description' => 'Late return - Introduction to Algorithms',
            'fines_date' => '2025-06-01',
        ));

        // Paid fine for M001 (debet == credit, should NOT appear)
        $insertFine->execute(array(
            'member_id' => 'M001',
            'debet' => 3000.00,
            'credit' => 3000.00,
            'description' => 'Late return - Clean Code',
            'fines_date' => '2025-05-15',
        ));

        // Another active fine for M001
        $insertFine->execute(array(
            'member_id' => 'M001',
            'debet' => 10000.00,
            'credit' => 0.00,
            'description' => 'Lost book - Design Patterns',
            'fines_date' => '2025-06-10',
        ));

        // Active fine for M002
        $insertFine->execute(array(
            'member_id' => 'M002',
            'debet' => 7500.00,
            'credit' => 5000.00,
            'description' => 'Late return - Database Systems',
            'fines_date' => '2025-04-20',
        ));
    }

    // =========================================================================
    // Member status detection
    // =========================================================================

    public function testActiveMemberReturnsActiveStatus(): void
    {
        $endpoint = new MemberCheck($this->db);
        $result = $endpoint->handle(array('member_id' => 'M001'));

        $this->assertArrayHasKey('status', $result);
        $this->assertSame('active', $result['status']);
    }

    public function testExpiredMemberReturnsExpiredStatus(): void
    {
        $endpoint = new MemberCheck($this->db);
        $result = $endpoint->handle(array('member_id' => 'M002'));

        $this->assertSame('expired', $result['status']);
    }

    public function testPendingMemberReturnsPendingStatus(): void
    {
        $endpoint = new MemberCheck($this->db);
        $result = $endpoint->handle(array('member_id' => 'M003'));

        $this->assertSame('pending', $result['status']);
    }

    // =========================================================================
    // Fines query
    // =========================================================================

    public function testActiveFinesReturnedForMember(): void
    {
        $endpoint = new MemberCheck($this->db);
        $result = $endpoint->handle(array('member_id' => 'M001'));

        $this->assertArrayHasKey('fines', $result);
        $this->assertCount(2, $result['fines']);
    }

    public function testPaidFinesAreExcluded(): void
    {
        $endpoint = new MemberCheck($this->db);
        $result = $endpoint->handle(array('member_id' => 'M001'));

        // The paid fine (debet == credit) should not appear
        foreach ($result['fines'] as $fine) {
            $this->assertGreaterThan(0, $fine['amount']);
        }
    }

    public function testFineAmountCalculatedCorrectly(): void
    {
        $endpoint = new MemberCheck($this->db);
        $result = $endpoint->handle(array('member_id' => 'M001'));

        // Find the fine for "Late return - Introduction to Algorithms"
        $lateReturnFine = null;
        foreach ($result['fines'] as $fine) {
            if ($fine['description'] === 'Late return - Introduction to Algorithms') {
                $lateReturnFine = $fine;
                break;
            }
        }

        $this->assertNotNull($lateReturnFine);
        // debet 5000 - credit 2000 = 3000
        $this->assertEquals(3000.0, $lateReturnFine['amount']);
    }

    public function testFineContainsExpectedFields(): void
    {
        $endpoint = new MemberCheck($this->db);
        $result = $endpoint->handle(array('member_id' => 'M001'));

        $fine = $result['fines'][0];
        $this->assertArrayHasKey('id', $fine);
        $this->assertArrayHasKey('amount', $fine);
        $this->assertArrayHasKey('description', $fine);
        $this->assertArrayHasKey('date', $fine);
    }

    public function testFineFieldTypesAreCorrect(): void
    {
        $endpoint = new MemberCheck($this->db);
        $result = $endpoint->handle(array('member_id' => 'M001'));

        $fine = $result['fines'][0];
        $this->assertIsInt($fine['id']);
        $this->assertIsFloat($fine['amount']);
        $this->assertIsString($fine['description']);
        $this->assertIsString($fine['date']);
    }

    public function testMemberWithNoFinesReturnsEmptyArray(): void
    {
        $endpoint = new MemberCheck($this->db);
        $result = $endpoint->handle(array('member_id' => 'M004'));

        $this->assertSame('active', $result['status']);
        $this->assertEmpty($result['fines']);
    }

    // =========================================================================
    // Input validation
    // =========================================================================

    public function testMissingMemberIdReturnsError(): void
    {
        $endpoint = new MemberCheck($this->db);
        $result = $endpoint->handle(array());

        $this->assertArrayHasKey('error', $result);
        $this->assertTrue($result['error']);
        $this->assertSame('INVALID_PARAMS', $result['code']);
    }

    public function testEmptyMemberIdReturnsError(): void
    {
        $endpoint = new MemberCheck($this->db);
        $result = $endpoint->handle(array('member_id' => ''));

        $this->assertArrayHasKey('error', $result);
        $this->assertTrue($result['error']);
        $this->assertSame('INVALID_PARAMS', $result['code']);
    }

    public function testWhitespaceOnlyMemberIdReturnsError(): void
    {
        $endpoint = new MemberCheck($this->db);
        $result = $endpoint->handle(array('member_id' => '   '));

        $this->assertArrayHasKey('error', $result);
        $this->assertTrue($result['error']);
        $this->assertSame('INVALID_PARAMS', $result['code']);
    }

    public function testNonExistentMemberReturnsNotFoundError(): void
    {
        $endpoint = new MemberCheck($this->db);
        $result = $endpoint->handle(array('member_id' => 'NONEXISTENT'));

        $this->assertArrayHasKey('error', $result);
        $this->assertTrue($result['error']);
        $this->assertSame('MEMBER_NOT_FOUND', $result['code']);
    }

    // =========================================================================
    // Database connection failure
    // =========================================================================

    public function testNullDatabaseReturnsError(): void
    {
        $endpoint = new MemberCheck(null);
        $result = $endpoint->handle(array('member_id' => 'M001'));

        $this->assertArrayHasKey('error', $result);
        $this->assertTrue($result['error']);
        $this->assertSame('DB_CONNECTION_FAILED', $result['code']);
    }
}
