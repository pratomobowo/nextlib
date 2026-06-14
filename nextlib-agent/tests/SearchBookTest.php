<?php
/**
 * Unit tests for SearchBook endpoint.
 *
 * Tests the SearchBook::handle() method using an in-memory SQLite database
 * with a biblio table schema matching SLiMS structure.
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use NextLibAgent\endpoints\SearchBook;
use PDO;

class SearchBookTest extends TestCase
{
    /**
     * @var PDO In-memory SQLite database
     */
    private $db;

    protected function setUp(): void
    {
        $this->db = new PDO('sqlite::memory:');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        // Create biblio table matching SLiMS schema (keep author column for insert compatibility)
        $this->db->exec("
            CREATE TABLE biblio (
                biblio_id INTEGER PRIMARY KEY AUTOINCREMENT,
                title VARCHAR(255) NOT NULL,
                author VARCHAR(255) DEFAULT '',
                isbn_issn VARCHAR(50) DEFAULT '',
                publisher_id VARCHAR(100) DEFAULT ''
            )
        ");

        // Create biblio_author table
        $this->db->exec("
            CREATE TABLE biblio_author (
                biblio_id INTEGER NOT NULL,
                author_id INTEGER NOT NULL,
                PRIMARY KEY (biblio_id, author_id)
            )
        ");

        // Create mst_author table
        $this->db->exec("
            CREATE TABLE mst_author (
                author_id INTEGER PRIMARY KEY AUTOINCREMENT,
                author_name VARCHAR(255) NOT NULL
            )
        ");

        // Seed test data
        $insertBook = $this->db->prepare(
            "INSERT INTO biblio (title, author, isbn_issn, publisher_id) VALUES (:title, :author, :isbn, :publisher)"
        );
        $insertAuthor = $this->db->prepare(
            "INSERT INTO mst_author (author_name) VALUES (:author)"
        );
        $insertRelation = $this->db->prepare(
            "INSERT INTO biblio_author (biblio_id, author_id) VALUES (:biblio_id, :author_id)"
        );

        $books = array(
            array('title' => 'Introduction to Algorithms', 'author' => 'Thomas H. Cormen', 'isbn' => '978-0262033848', 'publisher' => '1'),
            array('title' => 'Clean Code', 'author' => 'Robert C. Martin', 'isbn' => '978-0132350884', 'publisher' => '2'),
            array('title' => 'Design Patterns', 'author' => 'Erich Gamma', 'isbn' => '978-0201633610', 'publisher' => '3'),
            array('title' => 'The Pragmatic Programmer', 'author' => 'David Thomas', 'isbn' => '978-0135957059', 'publisher' => '2'),
            array('title' => 'Database Systems', 'author' => 'Thomas Connolly', 'isbn' => '978-0321523068', 'publisher' => '4'),
        );

        foreach ($books as $book) {
            $insertBook->execute($book);
            $biblioId = $this->db->lastInsertId();

            $insertAuthor->execute(array('author' => $book['author']));
            $authorId = $this->db->lastInsertId();

            $insertRelation->execute(array(
                'biblio_id' => $biblioId,
                'author_id' => $authorId,
            ));
        }
    }

    // =========================================================================
    // Basic search functionality
    // =========================================================================

    public function testSearchByTitleReturnsMatchingBooks(): void
    {
        $endpoint = new SearchBook($this->db);
        $result = $endpoint->handle(array('query' => 'Clean Code'));

        $this->assertArrayHasKey('results', $result);
        $this->assertArrayHasKey('total', $result);
        $this->assertSame(1, $result['total']);
        $this->assertCount(1, $result['results']);
        $this->assertSame('Clean Code', $result['results'][0]['title']);
    }

    public function testSearchByAuthorReturnsMatchingBooks(): void
    {
        $endpoint = new SearchBook($this->db);
        $result = $endpoint->handle(array('query' => 'Thomas'));

        // Should match Thomas H. Cormen, David Thomas, Thomas Connolly
        $this->assertSame(3, $result['total']);
        $this->assertCount(3, $result['results']);
    }

    public function testSearchReturnsPartialMatches(): void
    {
        $endpoint = new SearchBook($this->db);
        $result = $endpoint->handle(array('query' => 'Algo'));

        $this->assertSame(1, $result['total']);
        $this->assertSame('Introduction to Algorithms', $result['results'][0]['title']);
    }

    // =========================================================================
    // Result format verification
    // =========================================================================

    public function testResultContainsExpectedFields(): void
    {
        $endpoint = new SearchBook($this->db);
        $result = $endpoint->handle(array('query' => 'Clean Code'));

        $book = $result['results'][0];
        $this->assertArrayHasKey('id', $book);
        $this->assertArrayHasKey('title', $book);
        $this->assertArrayHasKey('author', $book);
        $this->assertArrayHasKey('isbn', $book);
        $this->assertArrayHasKey('publisher', $book);
    }

    public function testResultFieldTypesAreCorrect(): void
    {
        $endpoint = new SearchBook($this->db);
        $result = $endpoint->handle(array('query' => 'Clean Code'));

        $book = $result['results'][0];
        $this->assertIsInt($book['id']);
        $this->assertIsString($book['title']);
        $this->assertIsString($book['author']);
        $this->assertIsString($book['isbn']);
        $this->assertIsString($book['publisher']);
    }

    // =========================================================================
    // Limit parameter
    // =========================================================================

    public function testLimitDefaultsTo10(): void
    {
        // Insert more than 10 books
        $insert = $this->db->prepare(
            "INSERT INTO biblio (title, author, isbn_issn, publisher_id) VALUES (:title, :author, :isbn, :publisher)"
        );
        for ($i = 0; $i < 15; $i++) {
            $insert->execute(array(
                'title' => 'Test Book ' . $i,
                'author' => 'Author ' . $i,
                'isbn' => '000-000000000' . $i,
                'publisher' => '1',
            ));
        }

        $endpoint = new SearchBook($this->db);
        $result = $endpoint->handle(array('query' => 'Test Book'));

        $this->assertCount(10, $result['results']);
        $this->assertSame(15, $result['total']);
    }

    public function testLimitParameterIsRespected(): void
    {
        $endpoint = new SearchBook($this->db);
        $result = $endpoint->handle(array('query' => 'Thomas', 'limit' => 2));

        $this->assertCount(2, $result['results']);
        $this->assertSame(3, $result['total']);
    }

    public function testLimitClampedToMaximum100(): void
    {
        $endpoint = new SearchBook($this->db);
        $result = $endpoint->handle(array('query' => 'Thomas', 'limit' => 200));

        // Should not exceed 100, but with only 3 results, count is 3
        $this->assertCount(3, $result['results']);
    }

    public function testLimitClampedToMinimum1(): void
    {
        $endpoint = new SearchBook($this->db);
        $result = $endpoint->handle(array('query' => 'Thomas', 'limit' => 0));

        $this->assertCount(1, $result['results']);
    }

    // =========================================================================
    // Empty / invalid input handling
    // =========================================================================

    public function testEmptyQueryReturnsEmptyResults(): void
    {
        $endpoint = new SearchBook($this->db);
        $result = $endpoint->handle(array('query' => ''));

        $this->assertSame(0, $result['total']);
        $this->assertEmpty($result['results']);
    }

    public function testMissingQueryParamReturnsEmptyResults(): void
    {
        $endpoint = new SearchBook($this->db);
        $result = $endpoint->handle(array());

        $this->assertSame(0, $result['total']);
        $this->assertEmpty($result['results']);
    }

    public function testWhitespaceOnlyQueryReturnsEmptyResults(): void
    {
        $endpoint = new SearchBook($this->db);
        $result = $endpoint->handle(array('query' => '   '));

        $this->assertSame(0, $result['total']);
        $this->assertEmpty($result['results']);
    }

    public function testNoMatchReturnsEmptyResults(): void
    {
        $endpoint = new SearchBook($this->db);
        $result = $endpoint->handle(array('query' => 'NonExistentBookXYZ'));

        $this->assertSame(0, $result['total']);
        $this->assertEmpty($result['results']);
    }

    // =========================================================================
    // Database connection failure
    // =========================================================================

    public function testNullDatabaseReturnsError(): void
    {
        $endpoint = new SearchBook(null);
        $result = $endpoint->handle(array('query' => 'test'));

        $this->assertArrayHasKey('error', $result);
        $this->assertTrue($result['error']);
        $this->assertSame('DB_CONNECTION_FAILED', $result['code']);
    }
}
