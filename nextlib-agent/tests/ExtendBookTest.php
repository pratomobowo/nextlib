<?php
/**
 * Unit tests for ExtendBook endpoint.
 *
 * Tests the ExtendBook::handle() method using an in-memory SQLite database
 * with a loan table matching SLiMS structure.
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\endpoints\ExtendBook;
use PDO;

class ExtendBookTest extends TestCase
{
    /**
     * @var PDO In-memory SQLite database
     */
    private $db;

    protected function setUp(): void
    {
        $this->db = new PDO('sqlite::memory:');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        // Create loan table matching SLiMS schema
        $this->db->exec("
            CREATE TABLE loan (
                loan_id INTEGER PRIMARY KEY AUTOINCREMENT,
                member_id VARCHAR(20) NOT NULL,
                item_code VARCHAR(20) NOT NULL,
                due_date DATE NOT NULL,
                is_lent INT DEFAULT 1,
                is_return INT DEFAULT 0
            )
        ");

        // Seed loan data
        $insertLoan = $this->db->prepare(
            "INSERT INTO loan (loan_id, member_id, item_code, due_date, is_lent, is_return) VALUES (:loan_id, :member_id, :item_code, :due_date, :is_lent, :is_return)"
        );

        // Active loan (not returned)
        $insertLoan->execute(array(
            'loan_id' => 1,
            'member_id' => 'M001',
            'item_code' => 'B001',
            'due_date' => '2025-07-01',
            'is_lent' => 1,
            'is_return' => 0,
        ));

        // Returned loan
        $insertLoan->execute(array(
            'loan_id' => 2,
            'member_id' => 'M002',
            'item_code' => 'B002',
            'due_date' => '2025-06-15',
            'is_lent' => 1,
            'is_return' => 1,
        ));

        // Another active loan
        $insertLoan->execute(array(
            'loan_id' => 3,
            'member_id' => 'M001',
            'item_code' => 'B003',
            'due_date' => '2025-08-10',
            'is_lent' => 1,
            'is_return' => 0,
        ));
    }

    // =========================================================================
    // Successful extension
    // =========================================================================

    public function testSuccessfulExtensionReturnsSuccess(): void
    {
        $endpoint = new ExtendBook($this->db);
        $result = $endpoint->handle(array('loan_id' => '1', 'days' => 7));

        $this->assertArrayHasKey('success', $result);
        $this->assertTrue($result['success']);
        $this->assertArrayHasKey('new_due_date', $result);
    }

    public function testExtensionCalculatesNewDueDateCorrectly(): void
    {
        $endpoint = new ExtendBook($this->db);
        $result = $endpoint->handle(array('loan_id' => '1', 'days' => 7));

        // Original due_date is 2025-07-01, extending 7 days -> 2025-07-08
        $this->assertSame('2025-07-08', $result['new_due_date']);
    }

    public function testExtensionUpdatesDatabase(): void
    {
        $endpoint = new ExtendBook($this->db);
        $endpoint->handle(array('loan_id' => '1', 'days' => 7));

        // Verify the database was updated
        $stmt = $this->db->prepare("SELECT due_date FROM loan WHERE loan_id = 1");
        $stmt->execute();
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        $this->assertSame('2025-07-08', $row['due_date']);
    }

    public function testExtensionWith14Days(): void
    {
        $endpoint = new ExtendBook($this->db);
        $result = $endpoint->handle(array('loan_id' => '3', 'days' => 14));

        // Original due_date is 2025-08-10, extending 14 days -> 2025-08-24
        $this->assertSame('2025-08-24', $result['new_due_date']);
        $this->assertTrue($result['success']);
    }

    public function testExtensionWith30Days(): void
    {
        $endpoint = new ExtendBook($this->db);
        $result = $endpoint->handle(array('loan_id' => '1', 'days' => 30));

        // Original due_date is 2025-07-01, extending 30 days -> 2025-07-31
        $this->assertSame('2025-07-31', $result['new_due_date']);
        $this->assertTrue($result['success']);
    }

    // =========================================================================
    // Input validation
    // =========================================================================

    public function testMissingLoanIdReturnsError(): void
    {
        $endpoint = new ExtendBook($this->db);
        $result = $endpoint->handle(array('days' => 7));

        $this->assertArrayHasKey('error', $result);
        $this->assertTrue($result['error']);
        $this->assertSame('INVALID_PARAMS', $result['code']);
    }

    public function testEmptyLoanIdReturnsError(): void
    {
        $endpoint = new ExtendBook($this->db);
        $result = $endpoint->handle(array('loan_id' => '', 'days' => 7));

        $this->assertArrayHasKey('error', $result);
        $this->assertTrue($result['error']);
        $this->assertSame('INVALID_PARAMS', $result['code']);
    }

    public function testWhitespaceOnlyLoanIdReturnsError(): void
    {
        $endpoint = new ExtendBook($this->db);
        $result = $endpoint->handle(array('loan_id' => '   ', 'days' => 7));

        $this->assertArrayHasKey('error', $result);
        $this->assertTrue($result['error']);
        $this->assertSame('INVALID_PARAMS', $result['code']);
    }

    public function testMissingDaysReturnsError(): void
    {
        $endpoint = new ExtendBook($this->db);
        $result = $endpoint->handle(array('loan_id' => '1'));

        $this->assertArrayHasKey('error', $result);
        $this->assertTrue($result['error']);
        $this->assertSame('INVALID_PARAMS', $result['code']);
    }

    public function testZeroDaysReturnsError(): void
    {
        $endpoint = new ExtendBook($this->db);
        $result = $endpoint->handle(array('loan_id' => '1', 'days' => 0));

        $this->assertArrayHasKey('error', $result);
        $this->assertTrue($result['error']);
        $this->assertSame('INVALID_PARAMS', $result['code']);
    }

    public function testNegativeDaysReturnsError(): void
    {
        $endpoint = new ExtendBook($this->db);
        $result = $endpoint->handle(array('loan_id' => '1', 'days' => -5));

        $this->assertArrayHasKey('error', $result);
        $this->assertTrue($result['error']);
        $this->assertSame('INVALID_PARAMS', $result['code']);
    }

    public function testDaysExceeding30ReturnsError(): void
    {
        $endpoint = new ExtendBook($this->db);
        $result = $endpoint->handle(array('loan_id' => '1', 'days' => 31));

        $this->assertArrayHasKey('error', $result);
        $this->assertTrue($result['error']);
        $this->assertSame('INVALID_PARAMS', $result['code']);
    }

    // =========================================================================
    // Loan not found / already returned
    // =========================================================================

    public function testNonExistentLoanReturnsError(): void
    {
        $endpoint = new ExtendBook($this->db);
        $result = $endpoint->handle(array('loan_id' => '999', 'days' => 7));

        $this->assertArrayHasKey('error', $result);
        $this->assertTrue($result['error']);
        $this->assertSame('LOAN_NOT_FOUND', $result['code']);
    }

    public function testReturnedLoanReturnsError(): void
    {
        $endpoint = new ExtendBook($this->db);
        $result = $endpoint->handle(array('loan_id' => '2', 'days' => 7));

        $this->assertArrayHasKey('error', $result);
        $this->assertTrue($result['error']);
        $this->assertSame('LOAN_ALREADY_RETURNED', $result['code']);
    }

    // =========================================================================
    // Database connection failure
    // =========================================================================

    public function testNullDatabaseReturnsError(): void
    {
        $endpoint = new ExtendBook(null);
        $result = $endpoint->handle(array('loan_id' => '1', 'days' => 7));

        $this->assertArrayHasKey('error', $result);
        $this->assertTrue($result['error']);
        $this->assertSame('DB_CONNECTION_FAILED', $result['code']);
    }
}
