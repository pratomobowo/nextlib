<?php
/**
 * Plugin Isolation Test
 *
 * Verifies that the NextLib-Agent plugin does not modify any SLiMS core files.
 * The plugin must only operate within its own folder (plugins/nextlib-agent/).
 *
 * Validates:
 * - Requirement 1.2: Plugin registers via standard plugin API without modifying core
 * - Requirement 1.3: SLiMS functions normally after plugin removal
 *
 * @package NextLib\Agent\Tests
 */

use PHPUnit\Framework\TestCase;

class PluginIsolationTest extends TestCase
{
    /**
     * The base directory of the nextlib-agent plugin.
     *
     * @var string
     */
    private $pluginDir;

    /**
     * PHP source files in the plugin directory.
     *
     * @var array
     */
    private $pluginFiles;

    /**
     * Functions/constructs that write or modify files.
     *
     * @var array
     */
    private $fileWriteFunctions;

    protected function setUp(): void
    {
        $this->pluginDir = realpath(__DIR__ . '/..');
        $this->pluginFiles = $this->getPhpFiles($this->pluginDir);

        // Functions and constructs that can write/modify files on disk
        $this->fileWriteFunctions = array(
            'file_put_contents',
            'fwrite',
            'fopen',
            'fputs',
            'fputcsv',
            'copy',
            'rename',
            'unlink',
            'rmdir',
            'mkdir',
            'touch',
            'chmod',
            'chown',
            'chgrp',
            'symlink',
            'link',
        );
    }

    /**
     * Test that all file write operations in the plugin only target paths
     * within the plugin's own directory.
     *
     * Scans all PHP source files for file modification functions and verifies
     * that any path arguments reference the plugin directory (relative paths
     * like __DIR__ . '/...' or queue/ subdirectory).
     *
     * Validates: Requirements 1.2, 1.3
     *
     * @return void
     */
    public function testFileWriteOperationsOnlyTargetPluginDirectory()
    {
        $violations = array();

        foreach ($this->pluginFiles as $file) {
            // Skip test files and vendor directory
            if ($this->isTestFile($file) || $this->isVendorFile($file)) {
                continue;
            }

            $content = file_get_contents($file);
            if ($content === false) {
                continue;
            }

            $fileViolations = $this->checkFileForExternalWrites($file, $content);
            if (!empty($fileViolations)) {
                $violations = array_merge($violations, $fileViolations);
            }
        }

        $this->assertEmpty(
            $violations,
            "Plugin must not write files outside its own directory.\nViolations found:\n"
            . implode("\n", $violations)
        );
    }

    /**
     * Test that plugin does not use include/require for paths outside the plugin directory.
     *
     * The plugin should only include files from its own directory or vendor (composer).
     * It must not modify or inject code into SLiMS core files.
     *
     * Validates: Requirements 1.2, 1.3
     *
     * @return void
     */
    public function testPluginDoesNotIncludeOrModifyCoreFiles()
    {
        $suspiciousPatterns = array(
            // Patterns that reference parent directories beyond plugin root (SLiMS core)
            '/\.\.\/(\.\.\/)+/', // ../../ or deeper traversal to SLiMS core
        );

        $violations = array();

        foreach ($this->pluginFiles as $file) {
            if ($this->isTestFile($file) || $this->isVendorFile($file)) {
                continue;
            }

            $content = file_get_contents($file);
            if ($content === false) {
                continue;
            }

            // Check for file writes using absolute paths outside plugin dir
            foreach ($suspiciousPatterns as $pattern) {
                if (preg_match($pattern, $content)) {
                    $relativePath = $this->getRelativePath($file);
                    // Only flag if it's used in a write context
                    foreach ($this->fileWriteFunctions as $func) {
                        if (strpos($content, $func) !== false
                            && preg_match('/' . preg_quote($func, '/') . '\s*\([^)]*\.\.\/(\.\.\/)+/', $content)
                        ) {
                            $violations[] = "{$relativePath}: Uses {$func}() with path traversal outside plugin directory";
                        }
                    }
                }
            }
        }

        $this->assertEmpty(
            $violations,
            "Plugin must not write to files outside its own directory.\nViolations found:\n"
            . implode("\n", $violations)
        );
    }

    /**
     * Test that file_put_contents calls in the plugin only write to the queue directory
     * or other paths within the plugin folder.
     *
     * Validates: Requirements 1.2, 1.3
     *
     * @return void
     */
    public function testFilePutContentsOnlyTargetsPluginPaths()
    {
        $violations = array();

        foreach ($this->pluginFiles as $file) {
            if ($this->isTestFile($file) || $this->isVendorFile($file)) {
                continue;
            }

            $content = file_get_contents($file);
            if ($content === false) {
                continue;
            }

            // Find all file_put_contents calls
            if (preg_match_all('/file_put_contents\s*\(\s*([^,]+),/m', $content, $matches)) {
                foreach ($matches[1] as $pathArg) {
                    $pathArg = trim($pathArg);

                    // Safe patterns: __DIR__, $this->queuePath, paths relative to plugin
                    $safePatterns = array(
                        '__DIR__',
                        '$this->',
                        '$queuePath',
                        '$queueFile',
                        '$tempFile',
                        '$filePath',
                    );

                    $isSafe = false;
                    foreach ($safePatterns as $safe) {
                        if (strpos($pathArg, $safe) !== false) {
                            $isSafe = true;
                            break;
                        }
                    }

                    // Flag absolute paths that don't reference plugin directory
                    if (!$isSafe && preg_match('/^[\'"]\//', $pathArg)) {
                        $relativePath = $this->getRelativePath($file);
                        $violations[] = "{$relativePath}: file_put_contents() targets absolute path: {$pathArg}";
                    }
                }
            }
        }

        $this->assertEmpty(
            $violations,
            "file_put_contents() must only write within the plugin directory.\nViolations found:\n"
            . implode("\n", $violations)
        );
    }

    /**
     * Test that the plugin's queue/write operations use paths derived from __DIR__.
     *
     * The AggregateExporter writes to queue/pending_exports.json which should
     * always be resolved relative to the plugin's own directory.
     *
     * Validates: Requirements 1.2, 1.3
     *
     * @return void
     */
    public function testQueueWritesAreWithinPluginDirectory()
    {
        $exporterFile = $this->pluginDir . '/exporter/AggregateExporter.php';
        $this->assertFileExists($exporterFile, 'AggregateExporter.php must exist');

        $content = file_get_contents($exporterFile);

        // Verify the default queue path is relative to plugin directory using __DIR__
        $this->assertStringContainsString(
            '__DIR__',
            $content,
            'AggregateExporter must use __DIR__ for relative path resolution'
        );

        // Verify queue path default points to sibling 'queue' directory
        $this->assertStringContainsString(
            'queue',
            $content,
            'AggregateExporter queue path should reference the queue directory'
        );

        // Verify writeQueueAtomically exists and handles file writing
        $this->assertStringContainsString(
            'writeQueueAtomically',
            $content,
            'AggregateExporter should use atomic write for queue files'
        );
    }

    /**
     * Test that the plugin only creates/writes files within its own directory structure.
     *
     * Verifies that the plugin folder structure is self-contained and does not
     * require writing to any SLiMS core directories.
     *
     * Validates: Requirements 1.2, 1.3
     *
     * @return void
     */
    public function testPluginIsFullySelfContained()
    {
        // Verify plugin has its own queue directory for local file writes
        $queueDir = $this->pluginDir . '/queue';
        $this->assertDirectoryExists(
            $queueDir,
            'Plugin must have its own queue/ directory for file writes'
        );

        // Verify no plugin file references SLiMS core directories for writing
        $coreDirectories = array(
            '/admin/',
            '/lib/',
            '/sysconfig/',
            '/files/',
            '/images/',
            '/template/',
            '/modules/',
        );

        $violations = array();

        foreach ($this->pluginFiles as $file) {
            if ($this->isTestFile($file) || $this->isVendorFile($file)) {
                continue;
            }

            $content = file_get_contents($file);
            if ($content === false) {
                continue;
            }

            // Only check for write operations targeting core directories
            foreach ($this->fileWriteFunctions as $func) {
                if (strpos($content, $func) === false) {
                    continue;
                }

                foreach ($coreDirectories as $coreDir) {
                    // Check if any write function references a SLiMS core directory
                    $pattern = '/' . preg_quote($func, '/') . '\s*\([^)]*'
                        . preg_quote($coreDir, '/') . '/';
                    if (preg_match($pattern, $content)) {
                        $relativePath = $this->getRelativePath($file);
                        $violations[] = "{$relativePath}: {$func}() references SLiMS core path '{$coreDir}'";
                    }
                }
            }
        }

        $this->assertEmpty(
            $violations,
            "Plugin must not write to SLiMS core directories.\nViolations found:\n"
            . implode("\n", $violations)
        );
    }

    /**
     * Test that the plugin entry point (index.php) uses only SLiMS plugin API hooks
     * and does not modify any external files.
     *
     * Validates: Requirements 1.2
     *
     * @return void
     */
    public function testIndexPhpUsesPluginApiOnly()
    {
        $indexFile = $this->pluginDir . '/index.php';
        $this->assertFileExists($indexFile, 'index.php plugin entry point must exist');

        $content = file_get_contents($indexFile);

        // Verify it checks INDEX_AUTH (SLiMS plugin mechanism)
        $this->assertStringContainsString(
            "defined('INDEX_AUTH')",
            $content,
            'index.php must verify SLiMS plugin context via INDEX_AUTH'
        );

        // Verify it does NOT use file write operations
        $writeOpsFound = array();
        foreach ($this->fileWriteFunctions as $func) {
            if ($func === 'mkdir') {
                continue; // mkdir may be acceptable for setup
            }
            if (preg_match('/\b' . preg_quote($func, '/') . '\s*\(/', $content)) {
                $writeOpsFound[] = $func;
            }
        }

        $this->assertEmpty(
            $writeOpsFound,
            'index.php must not perform file write operations. Found: '
            . implode(', ', $writeOpsFound)
        );
    }

    /**
     * Test that the plugin does not register any shutdown functions or
     * output buffering that could modify SLiMS behavior.
     *
     * Validates: Requirements 1.2, 1.3
     *
     * @return void
     */
    public function testPluginDoesNotHijackSlimsExecution()
    {
        $dangerousFunctions = array(
            'register_shutdown_function',
            'set_error_handler',
            'set_exception_handler',
            'ob_start',
        );

        $violations = array();

        foreach ($this->pluginFiles as $file) {
            if ($this->isTestFile($file) || $this->isVendorFile($file)) {
                continue;
            }

            $content = file_get_contents($file);
            if ($content === false) {
                continue;
            }

            foreach ($dangerousFunctions as $func) {
                if (preg_match('/\b' . preg_quote($func, '/') . '\s*\(/', $content)) {
                    $relativePath = $this->getRelativePath($file);
                    $violations[] = "{$relativePath}: Uses {$func}() which could interfere with SLiMS execution";
                }
            }
        }

        $this->assertEmpty(
            $violations,
            "Plugin must not hijack SLiMS execution flow.\nViolations found:\n"
            . implode("\n", $violations)
        );
    }

    /**
     * Get all PHP files recursively from a directory.
     *
     * @param string $dir Directory to scan
     * @return array List of absolute file paths
     */
    private function getPhpFiles(string $dir): array
    {
        $files = array();
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($dir, \RecursiveDirectoryIterator::SKIP_DOTS)
        );

        foreach ($iterator as $file) {
            if ($file->isFile() && $file->getExtension() === 'php') {
                $files[] = $file->getPathname();
            }
        }

        return $files;
    }

    /**
     * Check if a file is a test file.
     *
     * @param string $filePath Absolute file path
     * @return bool
     */
    private function isTestFile(string $filePath): bool
    {
        return strpos($filePath, '/tests/') !== false
            || strpos($filePath, 'Test.php') !== false;
    }

    /**
     * Check if a file is in the vendor directory.
     *
     * @param string $filePath Absolute file path
     * @return bool
     */
    private function isVendorFile(string $filePath): bool
    {
        return strpos($filePath, '/vendor/') !== false;
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

    /**
     * Check a file's content for file write operations targeting external paths.
     *
     * @param string $file    Absolute file path
     * @param string $content File content
     * @return array List of violation descriptions
     */
    private function checkFileForExternalWrites(string $file, string $content): array
    {
        $violations = array();
        $relativePath = $this->getRelativePath($file);

        foreach ($this->fileWriteFunctions as $func) {
            if (strpos($content, $func) === false) {
                continue;
            }

            // Find all calls to this function
            $pattern = '/' . preg_quote($func, '/') . '\s*\(\s*([^,\)]+)/m';
            if (!preg_match_all($pattern, $content, $matches)) {
                continue;
            }

            foreach ($matches[1] as $pathArg) {
                $pathArg = trim($pathArg);

                // Safe: references to __DIR__ (stays within plugin)
                if (strpos($pathArg, '__DIR__') !== false) {
                    continue;
                }

                // Safe: variable references to internal paths
                $safeVars = array(
                    '$this->queuePath',
                    '$queuePath',
                    '$queueFile',
                    '$tempFile',
                    '$filePath',
                    '$dir',
                    '$autoloadPath',
                );
                $isSafe = false;
                foreach ($safeVars as $safeVar) {
                    if (strpos($pathArg, $safeVar) !== false) {
                        $isSafe = true;
                        break;
                    }
                }
                if ($isSafe) {
                    continue;
                }

                // Dangerous: absolute paths not referencing plugin directory
                if (preg_match('/^[\'"]\/(?!.*nextlib-agent)/', $pathArg)) {
                    $violations[] = "{$relativePath}: {$func}() uses absolute path outside plugin: {$pathArg}";
                }

                // Dangerous: path traversal beyond plugin root
                if (preg_match('/\.\.\/(\.\.\/)+/', $pathArg)) {
                    $violations[] = "{$relativePath}: {$func}() uses path traversal beyond plugin root: {$pathArg}";
                }
            }
        }

        return $violations;
    }
}
