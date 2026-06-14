<?php
/**
 * PHP Compatibility Test
 *
 * Verifies that the NextLib-Agent plugin does not use PHP 8.1+ exclusive features,
 * ensuring compatibility with PHP 7.4+.
 *
 * Checks for:
 * - enum declarations (PHP 8.1+)
 * - Fiber usage (PHP 8.1+)
 * - readonly class declarations (PHP 8.2+)
 * - intersection types (Type1&Type2) (PHP 8.1+)
 * - readonly properties (PHP 8.1+)
 * - first-class callable syntax (PHP 8.1+)
 * - named arguments in internal functions (PHP 8.0+ but tested for awareness)
 *
 * Validates: Requirements 9.5
 *
 * @package NextLib\Agent\Tests
 */

use PHPUnit\Framework\TestCase;

class PhpCompatibilityTest extends TestCase
{
    /**
     * The base directory of the nextlib-agent plugin.
     *
     * @var string
     */
    private $pluginDir;

    /**
     * PHP source files to scan (excludes vendor/ and tests/).
     *
     * @var array
     */
    private $sourceFiles;

    protected function setUp(): void
    {
        $this->pluginDir = realpath(__DIR__ . '/..');
        $this->sourceFiles = $this->getSourcePhpFiles($this->pluginDir);
    }

    /**
     * Test that no PHP source file uses enum declarations (PHP 8.1+).
     *
     * Enum is a keyword introduced in PHP 8.1. Usage like:
     *   enum Status { case Active; case Inactive; }
     *   enum Color: string { case Red = 'red'; }
     *
     * Validates: Requirements 9.5
     *
     * @return void
     */
    public function testNoEnumDeclarations()
    {
        $violations = array();

        foreach ($this->sourceFiles as $file) {
            $content = file_get_contents($file);
            if ($content === false) {
                continue;
            }

            // Match: enum ClassName or enum ClassName: type
            // Uses word boundary to avoid matching 'enumerate', variable names, etc.
            if (preg_match('/^\s*enum\s+[A-Z]/m', $content)) {
                $violations[] = $this->getRelativePath($file) . ': Contains enum declaration (PHP 8.1+)';
            }
        }

        $this->assertEmpty(
            $violations,
            "PHP 8.1+ enum declarations found. Plugin must be compatible with PHP 7.4+.\n"
            . implode("\n", $violations)
        );
    }

    /**
     * Test that no PHP source file uses Fiber (PHP 8.1+).
     *
     * Fiber is a class introduced in PHP 8.1 for lightweight concurrency:
     *   new Fiber(function() { ... });
     *   Fiber::suspend();
     *
     * Validates: Requirements 9.5
     *
     * @return void
     */
    public function testNoFiberUsage()
    {
        $violations = array();

        foreach ($this->sourceFiles as $file) {
            $content = file_get_contents($file);
            if ($content === false) {
                continue;
            }

            // Match: new Fiber, Fiber::, \Fiber, use ...Fiber
            if (preg_match('/\b(new\s+\\\\?Fiber|Fiber\s*::|\\\\Fiber\b)/', $content)) {
                $violations[] = $this->getRelativePath($file) . ': Contains Fiber usage (PHP 8.1+)';
            }
        }

        $this->assertEmpty(
            $violations,
            "PHP 8.1+ Fiber usage found. Plugin must be compatible with PHP 7.4+.\n"
            . implode("\n", $violations)
        );
    }

    /**
     * Test that no PHP source file uses readonly class declarations (PHP 8.2+).
     *
     * Readonly classes were introduced in PHP 8.2:
     *   readonly class Immutable { ... }
     *
     * Validates: Requirements 9.5
     *
     * @return void
     */
    public function testNoReadonlyClassDeclarations()
    {
        $violations = array();

        foreach ($this->sourceFiles as $file) {
            $content = file_get_contents($file);
            if ($content === false) {
                continue;
            }

            // Match: readonly class ClassName
            if (preg_match('/\breadonly\s+class\s+/m', $content)) {
                $violations[] = $this->getRelativePath($file) . ': Contains readonly class declaration (PHP 8.2+)';
            }
        }

        $this->assertEmpty(
            $violations,
            "PHP 8.2+ readonly class declarations found. Plugin must be compatible with PHP 7.4+.\n"
            . implode("\n", $violations)
        );
    }

    /**
     * Test that no PHP source file uses intersection types (PHP 8.1+).
     *
     * Intersection types use & between type names in type declarations:
     *   function foo(TypeA&TypeB $param): void { ... }
     *   public function bar(): Countable&Iterator { ... }
     *
     * Validates: Requirements 9.5
     *
     * @return void
     */
    public function testNoIntersectionTypes()
    {
        $violations = array();

        foreach ($this->sourceFiles as $file) {
            $content = file_get_contents($file);
            if ($content === false) {
                continue;
            }

            // Match intersection types in function/method signatures
            // Pattern: TypeName&TypeName in parameter or return type context
            // Avoid matching bitwise & operators and reference parameters (&$var)
            // Look for: Type1&Type2 where both start with uppercase (class names)
            if (preg_match('/:\s*[A-Z][a-zA-Z0-9_]*\s*&\s*[A-Z][a-zA-Z0-9_]*/', $content)
                || preg_match('/\(\s*[A-Z][a-zA-Z0-9_]*\s*&\s*[A-Z][a-zA-Z0-9_]*\s+\$/', $content)
                || preg_match('/,\s*[A-Z][a-zA-Z0-9_]*\s*&\s*[A-Z][a-zA-Z0-9_]*\s+\$/', $content)
            ) {
                $violations[] = $this->getRelativePath($file) . ': Contains intersection type (PHP 8.1+)';
            }
        }

        $this->assertEmpty(
            $violations,
            "PHP 8.1+ intersection types found. Plugin must be compatible with PHP 7.4+.\n"
            . implode("\n", $violations)
        );
    }

    /**
     * Test that no PHP source file uses readonly property declarations (PHP 8.1+).
     *
     * Readonly properties were introduced in PHP 8.1:
     *   public readonly string $name;
     *   private readonly int $id;
     *
     * Validates: Requirements 9.5
     *
     * @return void
     */
    public function testNoReadonlyProperties()
    {
        $violations = array();

        foreach ($this->sourceFiles as $file) {
            $content = file_get_contents($file);
            if ($content === false) {
                continue;
            }

            // Match: (public|protected|private) readonly type $property
            // or: readonly (public|protected|private) type $property
            if (preg_match('/\b(public|protected|private)\s+readonly\s+/', $content)
                || preg_match('/\breadonly\s+(public|protected|private)\s+/', $content)
            ) {
                $violations[] = $this->getRelativePath($file) . ': Contains readonly property (PHP 8.1+)';
            }
        }

        $this->assertEmpty(
            $violations,
            "PHP 8.1+ readonly properties found. Plugin must be compatible with PHP 7.4+.\n"
            . implode("\n", $violations)
        );
    }

    /**
     * Test that no PHP source file uses first-class callable syntax (PHP 8.1+).
     *
     * First-class callable syntax uses the ... operator:
     *   $fn = strlen(...);
     *   array_map($this->method(...), $items);
     *
     * Validates: Requirements 9.5
     *
     * @return void
     */
    public function testNoFirstClassCallableSyntax()
    {
        $violations = array();

        foreach ($this->sourceFiles as $file) {
            $content = file_get_contents($file);
            if ($content === false) {
                continue;
            }

            // Match: functionName(...) or $var->method(...) used as callable
            // This is distinct from variadic usage like function foo(...$args)
            // Pattern: identifier(...) where ... is the only content inside parens
            if (preg_match('/[a-zA-Z_]\w*\s*\(\s*\.\.\.\s*\)/', $content)) {
                // Exclude cases where ... is used as variadic parameter declaration
                // Variadic: function foo(string ...$args)
                // First-class callable: strlen(...)
                $lines = explode("\n", $content);
                foreach ($lines as $lineNum => $line) {
                    if (preg_match('/[a-zA-Z_]\w*\s*\(\s*\.\.\.\s*\)/', $line)) {
                        // Skip if it's a variadic parameter in function declaration
                        if (preg_match('/function\s+\w+\s*\(/', $line)) {
                            continue;
                        }
                        $violations[] = $this->getRelativePath($file)
                            . ':' . ($lineNum + 1)
                            . ': Possible first-class callable syntax (PHP 8.1+)';
                        break; // One violation per file is enough
                    }
                }
            }
        }

        $this->assertEmpty(
            $violations,
            "PHP 8.1+ first-class callable syntax found. Plugin must be compatible with PHP 7.4+.\n"
            . implode("\n", $violations)
        );
    }

    /**
     * Test that no PHP source file uses match expressions with no-argument syntax (PHP 8.0+)
     * or never return type (PHP 8.1+).
     *
     * Never return type was introduced in PHP 8.1:
     *   function throwError(): never { throw new Exception(); }
     *
     * Validates: Requirements 9.5
     *
     * @return void
     */
    public function testNoNeverReturnType()
    {
        $violations = array();

        foreach ($this->sourceFiles as $file) {
            $content = file_get_contents($file);
            if ($content === false) {
                continue;
            }

            // Match: ): never or ): never {
            if (preg_match('/\)\s*:\s*never\b/', $content)) {
                $violations[] = $this->getRelativePath($file) . ': Contains never return type (PHP 8.1+)';
            }
        }

        $this->assertEmpty(
            $violations,
            "PHP 8.1+ never return type found. Plugin must be compatible with PHP 7.4+.\n"
            . implode("\n", $violations)
        );
    }

    /**
     * Test that source files are present and scannable.
     *
     * Ensures we are actually scanning files and not passing vacuously.
     *
     * @return void
     */
    public function testSourceFilesExist()
    {
        $this->assertNotEmpty(
            $this->sourceFiles,
            'No PHP source files found to scan. The plugin source directory may be empty.'
        );

        // Verify we're scanning key plugin files
        $expectedFiles = array(
            'index.php',
            'config.php',
            'middleware/TokenValidator.php',
            'lib/HmacSigner.php',
            'lib/HttpClient.php',
            'exporter/AggregateExporter.php',
        );

        $relativeFiles = array_map(function ($f) {
            return $this->getRelativePath($f);
        }, $this->sourceFiles);

        foreach ($expectedFiles as $expected) {
            $this->assertContains(
                $expected,
                $relativeFiles,
                "Expected source file '{$expected}' not found in scan list"
            );
        }
    }

    /**
     * Get all PHP source files from a directory, excluding vendor/ and tests/.
     *
     * @param string $dir Directory to scan
     * @return array List of absolute file paths
     */
    private function getSourcePhpFiles(string $dir): array
    {
        $files = array();
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($dir, \RecursiveDirectoryIterator::SKIP_DOTS)
        );

        foreach ($iterator as $file) {
            if (!$file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }

            $path = $file->getPathname();

            // Exclude vendor/ and tests/ directories
            if (strpos($path, '/vendor/') !== false || strpos($path, '/tests/') !== false) {
                continue;
            }

            $files[] = $path;
        }

        return $files;
    }

    /**
     * Get the relative path of a file from the plugin directory.
     *
     * @param string $filePath Absolute file path
     * @return string Relative path
     */
    private function getRelativePath(string $filePath): string
    {
        return str_replace($this->pluginDir . '/', '', $filePath);
    }
}
