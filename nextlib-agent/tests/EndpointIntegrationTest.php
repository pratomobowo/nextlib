<?php
/**
 * Integration tests for API endpoints with TokenValidator middleware.
 *
 * Tests all three endpoints (SearchBook, MemberCheck, ExtendBook) through
 * the full TokenValidator middleware validation flow, verifying:
 * - Valid tokens produce expected JSON responses
 * - Missing tokens return HTTP 401 with INVALID_TOKEN error
 * - Invalid/wrong-secret tokens return HTTP 401 with INVALID_TOKEN error
 * - Expired tokens return HTTP 401 with TOKEN_EXPIRED error
 *
 * These tests replicate the exact validation logic in TokenValidator::handle()
 * (extract token → validate signature → check expiry → call endpoint)
 * while using the endpoint handlers with a real SQLite database.
 *
 * **Validates: Requirements 2.4, 2.5**
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\Middleware\TokenValidator;
use NextLibAgent\Lib\HmacSigner;
use NextLibAgent\endpoints\SearchBook;
use NextLibAgent\endpoints\MemberCheck;
use NextLibAgent\endpoints\ExtendBook;
use PDO;

class EndpointIntegrationTest extends TestCase
{
    /** @var string Test secret key (same as what would be in config.php) */
    private $secretKey = 'integration-test-secret-key-hmac256';

    /** @var PDO In-memory SQLite database */
    private $db;

    /** @var TokenValidator */
    private $validator;

    protected function setUp(): void
    {
        $this->db = new PDO('sqlite::memory:');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        $this->validator = new TokenValidator($this->secretKey, 300);

        $this->createTables();
        $this->seedData();
    }

    // =========================================================================
    // Database setup
    // =========================================================================

    private function createTables(): void
    {
        $this->db->exec("
            CREATE TABLE biblio (
                biblio_id INTEGER PRIMARY KEY AUTOINCREMENT,
                title VARCHAR(255) NOT NULL,
                author VARCHAR(255) DEFAULT '',
                isbn_issn VARCHAR(50) DEFAULT '',
                publisher_id VARCHAR(100) DEFAULT ''
            )
        ");

        $this->db->exec("
            CREATE TABLE biblio_author (
                biblio_id INTEGER NOT NULL,
                author_id INTEGER NOT NULL,
                PRIMARY KEY (biblio_id, author_id)
            )
        ");

        $this->db->exec("
            CREATE TABLE mst_author (
                author_id INTEGER PRIMARY KEY AUTOINCREMENT,
                author_name VARCHAR(255) NOT NULL
            )
        ");

        $this->db->exec("
            CREATE TABLE member (
                member_id VARCHAR(20) PRIMARY KEY,
                member_name VARCHAR(100) NOT NULL,
                expire_date DATE DEFAULT NULL,
                is_pending INTEGER DEFAULT 0
            )
        ");

        $this->db->exec("
            CREATE TABLE fines (
                fines_id INTEGER PRIMARY KEY AUTOINCREMENT,
                member_id VARCHAR(20) NOT NULL,
                debet DECIMAL(10,2) DEFAULT 0,
                credit DECIMAL(10,2) DEFAULT 0,
                description TEXT DEFAULT '',
                fines_date DATE DEFAULT NULL
            )
        ");

        $this->db->exec("
            CREATE TABLE loan (
                loan_id INTEGER PRIMARY KEY AUTOINCREMENT,
                member_id VARCHAR(20) NOT NULL,
                item_code VARCHAR(20) DEFAULT '',
                due_date DATE NOT NULL,
                is_lent INTEGER DEFAULT 1,
                is_return INTEGER DEFAULT 0
            )
        ");
    }

    private function seedData(): void
    {
        $this->db->exec("
            INSERT INTO biblio (title, author, isbn_issn, publisher_id) VALUES
            ('Introduction to Algorithms', 'Thomas H. Cormen', '978-0262033848', '1'),
            ('Clean Code', 'Robert C. Martin', '978-0132350884', '2')
        ");

        $this->db->exec("
            INSERT INTO mst_author (author_name) VALUES
            ('Thomas H. Cormen'),
            ('Robert C. Martin')
        ");

        $this->db->exec("
            INSERT INTO biblio_author (biblio_id, author_id) VALUES
            (1, 1),
            (2, 2)
        ");

        $this->db->exec("
            INSERT INTO member (member_id, member_name, expire_date, is_pending) VALUES
            ('M001', 'John Doe', '2030-12-31', 0),
            ('M002', 'Jane Smith', '2020-01-01', 0)
        ");

        $this->db->exec("
            INSERT INTO fines (member_id, debet, credit, description, fines_date) VALUES
            ('M001', 5000, 0, 'Late return fee', '2025-01-15')
        ");

        $this->db->exec("
            INSERT INTO loan (member_id, item_code, due_date, is_lent, is_return) VALUES
            ('M001', 'ITEM001', '2025-07-01', 1, 0),
            ('M001', 'ITEM002', '2025-06-01', 1, 1)
        ");
    }

    // =========================================================================
    // Helper: simulate the full middleware + endpoint integration flow
    // =========================================================================

    /**
     * Simulate the TokenValidator::handle() flow and return structured response.
     *
     * This replicates the exact logic in TokenValidator::handle():
     * 1. Check if token is present (from header)
     * 2. Validate HMAC signature
     * 3. Check token expiry
     * 4. If all pass, invoke the endpoint handler
     *
     * @param string|null $token       The X-NextLib-Token value (null = missing)
     * @param string      $requestBody Raw request body
     * @param callable    $handler     Endpoint handler (receives $requestBody)
     * @return array{statusCode: int, body: array}
     */
    private function simulateRequest(?string $token, string $requestBody, callable $handler): array
    {
        // Step 1: Check token presence (mirrors TokenValidator::handle lines 111-118)
        if ($token === null || $token === '') {
            return array(
                'statusCode' => 401,
                'body' => array(
                    'error' => true,
                    'code' => 'INVALID_TOKEN',
                    'message' => 'Token tidak valid: header X-NextLib-Token tidak ditemukan',
                ),
            );
        }

        // Step 2: Validate HMAC signature (mirrors TokenValidator::handle lines 123-130)
        if (!$this->validator->validate($token, $requestBody)) {
            return array(
                'statusCode' => 401,
                'body' => array(
                    'error' => true,
                    'code' => 'INVALID_TOKEN',
                    'message' => 'Token tidak valid: signature HMAC-SHA256 tidak cocok',
                ),
            );
        }

        // Step 3: Check expiry (mirrors TokenValidator::handle lines 133-140)
        if ($this->validator->isExpired($token)) {
            return array(
                'statusCode' => 401,
                'body' => array(
                    'error' => true,
                    'code' => 'TOKEN_EXPIRED',
                    'message' => 'Token sudah kedaluwarsa: melebihi batas waktu 5 menit',
                ),
            );
        }

        // Step 4: Token valid — call endpoint (mirrors TokenValidator::handle lines 143-149)
        $result = call_user_func($handler, $requestBody);

        return array(
            'statusCode' => 200,
            'body' => $result,
        );
    }

    /**
     * Generate a valid token for the given request body.
     */
    private function generateValidToken(string $requestBody): string
    {
        return $this->validator->generateToken($requestBody);
    }

    /**
     * Generate an expired token (timestamp 400 seconds in the past).
     */
    private function generateExpiredToken(string $requestBody): string
    {
        $oldTimestamp = (string) (time() - 400);
        $signature = hash_hmac('sha256', $oldTimestamp . $requestBody, $this->secretKey);
        return $oldTimestamp . '.' . $signature;
    }

    /**
     * Generate a token signed with a wrong/different secret.
     */
    private function generateWrongSecretToken(string $requestBody): string
    {
        $signer = new HmacSigner('wrong-secret-key-totally-different');
        return $signer->generateToken($requestBody);
    }

    /**
     * Create a handler for SearchBook endpoint (same as index.php routing logic).
     */
    private function searchBookHandler(): callable
    {
        $db = $this->db;
        return function (string $requestBody) use ($db) {
            $params = json_decode($requestBody, true);
            if ($params === null) {
                $params = array();
            }
            $endpoint = new SearchBook($db);
            return $endpoint->handle($params);
        };
    }

    /**
     * Create a handler for MemberCheck endpoint (same as index.php routing logic).
     */
    private function memberCheckHandler(): callable
    {
        $db = $this->db;
        return function (string $requestBody) use ($db) {
            $params = json_decode($requestBody, true);
            if ($params === null) {
                $params = array();
            }
            $endpoint = new MemberCheck($db);
            return $endpoint->handle($params);
        };
    }

    /**
     * Create a handler for ExtendBook endpoint (same as index.php routing logic).
     */
    private function extendBookHandler(): callable
    {
        $db = $this->db;
        return function (string $requestBody) use ($db) {
            $params = json_decode($requestBody, true);
            if ($params === null) {
                $params = array();
            }
            $endpoint = new ExtendBook($db);
            return $endpoint->handle($params);
        };
    }

    // =========================================================================
    // SearchBook endpoint: valid token → success
    // =========================================================================

    public function testSearchBookWithValidTokenReturnsResults(): void
    {
        $body = '{"query":"Clean Code","limit":10}';
        $token = $this->generateValidToken($body);

        $response = $this->simulateRequest($token, $body, $this->searchBookHandler());

        $this->assertSame(200, $response['statusCode']);
        $this->assertArrayHasKey('results', $response['body']);
        $this->assertArrayHasKey('total', $response['body']);
        $this->assertSame(1, $response['body']['total']);
        $this->assertSame('Clean Code', $response['body']['results'][0]['title']);
    }

    // =========================================================================
    // SearchBook endpoint: missing token → 401 INVALID_TOKEN
    // =========================================================================

    public function testSearchBookWithoutTokenReturns401InvalidToken(): void
    {
        $body = '{"query":"Clean Code","limit":10}';

        $response = $this->simulateRequest(null, $body, $this->searchBookHandler());

        $this->assertSame(401, $response['statusCode']);
        $this->assertTrue($response['body']['error']);
        $this->assertSame('INVALID_TOKEN', $response['body']['code']);
    }

    // =========================================================================
    // SearchBook endpoint: wrong secret → 401 INVALID_TOKEN
    // =========================================================================

    public function testSearchBookWithWrongSecretReturns401InvalidToken(): void
    {
        $body = '{"query":"Clean Code","limit":10}';
        $token = $this->generateWrongSecretToken($body);

        $response = $this->simulateRequest($token, $body, $this->searchBookHandler());

        $this->assertSame(401, $response['statusCode']);
        $this->assertTrue($response['body']['error']);
        $this->assertSame('INVALID_TOKEN', $response['body']['code']);
    }

    // =========================================================================
    // SearchBook endpoint: expired token → 401 TOKEN_EXPIRED
    // =========================================================================

    public function testSearchBookWithExpiredTokenReturns401TokenExpired(): void
    {
        $body = '{"query":"Clean Code","limit":10}';
        $token = $this->generateExpiredToken($body);

        $response = $this->simulateRequest($token, $body, $this->searchBookHandler());

        $this->assertSame(401, $response['statusCode']);
        $this->assertTrue($response['body']['error']);
        $this->assertSame('TOKEN_EXPIRED', $response['body']['code']);
    }

    // =========================================================================
    // MemberCheck endpoint: valid token → success
    // =========================================================================

    public function testMemberCheckWithValidTokenReturnsStatus(): void
    {
        $body = '{"member_id":"M001"}';
        $token = $this->generateValidToken($body);

        $response = $this->simulateRequest($token, $body, $this->memberCheckHandler());

        $this->assertSame(200, $response['statusCode']);
        $this->assertArrayHasKey('status', $response['body']);
        $this->assertArrayHasKey('fines', $response['body']);
        $this->assertSame('active', $response['body']['status']);
        $this->assertCount(1, $response['body']['fines']);
    }

    // =========================================================================
    // MemberCheck endpoint: missing token → 401 INVALID_TOKEN
    // =========================================================================

    public function testMemberCheckWithoutTokenReturns401InvalidToken(): void
    {
        $body = '{"member_id":"M001"}';

        $response = $this->simulateRequest(null, $body, $this->memberCheckHandler());

        $this->assertSame(401, $response['statusCode']);
        $this->assertTrue($response['body']['error']);
        $this->assertSame('INVALID_TOKEN', $response['body']['code']);
    }

    // =========================================================================
    // MemberCheck endpoint: wrong secret → 401 INVALID_TOKEN
    // =========================================================================

    public function testMemberCheckWithWrongSecretReturns401InvalidToken(): void
    {
        $body = '{"member_id":"M001"}';
        $token = $this->generateWrongSecretToken($body);

        $response = $this->simulateRequest($token, $body, $this->memberCheckHandler());

        $this->assertSame(401, $response['statusCode']);
        $this->assertTrue($response['body']['error']);
        $this->assertSame('INVALID_TOKEN', $response['body']['code']);
    }

    // =========================================================================
    // MemberCheck endpoint: expired token → 401 TOKEN_EXPIRED
    // =========================================================================

    public function testMemberCheckWithExpiredTokenReturns401TokenExpired(): void
    {
        $body = '{"member_id":"M001"}';
        $token = $this->generateExpiredToken($body);

        $response = $this->simulateRequest($token, $body, $this->memberCheckHandler());

        $this->assertSame(401, $response['statusCode']);
        $this->assertTrue($response['body']['error']);
        $this->assertSame('TOKEN_EXPIRED', $response['body']['code']);
    }

    // =========================================================================
    // ExtendBook endpoint: valid token → success
    // =========================================================================

    public function testExtendBookWithValidTokenExtendsLoan(): void
    {
        $body = '{"loan_id":"1","days":7}';
        $token = $this->generateValidToken($body);

        $response = $this->simulateRequest($token, $body, $this->extendBookHandler());

        $this->assertSame(200, $response['statusCode']);
        $this->assertTrue($response['body']['success']);
        $this->assertArrayHasKey('new_due_date', $response['body']);
        // Original due_date is 2025-07-01, extended by 7 days = 2025-07-08
        $this->assertSame('2025-07-08', $response['body']['new_due_date']);
    }

    // =========================================================================
    // ExtendBook endpoint: missing token → 401 INVALID_TOKEN
    // =========================================================================

    public function testExtendBookWithoutTokenReturns401InvalidToken(): void
    {
        $body = '{"loan_id":"1","days":7}';

        $response = $this->simulateRequest(null, $body, $this->extendBookHandler());

        $this->assertSame(401, $response['statusCode']);
        $this->assertTrue($response['body']['error']);
        $this->assertSame('INVALID_TOKEN', $response['body']['code']);
    }

    // =========================================================================
    // ExtendBook endpoint: wrong secret → 401 INVALID_TOKEN
    // =========================================================================

    public function testExtendBookWithWrongSecretReturns401InvalidToken(): void
    {
        $body = '{"loan_id":"1","days":7}';
        $token = $this->generateWrongSecretToken($body);

        $response = $this->simulateRequest($token, $body, $this->extendBookHandler());

        $this->assertSame(401, $response['statusCode']);
        $this->assertTrue($response['body']['error']);
        $this->assertSame('INVALID_TOKEN', $response['body']['code']);
    }

    // =========================================================================
    // ExtendBook endpoint: expired token → 401 TOKEN_EXPIRED
    // =========================================================================

    public function testExtendBookWithExpiredTokenReturns401TokenExpired(): void
    {
        $body = '{"loan_id":"1","days":7}';
        $token = $this->generateExpiredToken($body);

        $response = $this->simulateRequest($token, $body, $this->extendBookHandler());

        $this->assertSame(401, $response['statusCode']);
        $this->assertTrue($response['body']['error']);
        $this->assertSame('TOKEN_EXPIRED', $response['body']['code']);
    }
}
