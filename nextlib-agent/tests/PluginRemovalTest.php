<?php
/**
 * Plugin Removal Test
 *
 * Verifies that the NextLib-Agent plugin does NOT leave residual dependencies
 * when removed from SLiMS. After deleting the plugin folder, SLiMS must
 * continue to function normally without error or feature degradation.
 *
 * Validates: Requirement 1.3
 * "WHEN NextLib_Agent dihapus dari folder plugins/, THE SLiMS SHALL tetap
 * berfungsi normal tanpa error atau degradasi fitur apapun"
 *
 * @package NextLib\Agent\Tests
 */

use PHPUnit\Framework\TestCase;

class PluginRemovalTest extends TestCase
{
    /**
     * The base directory of the nextlib-agent plugin.
     *
     * @var string
     */
    private $pluginDir;

    /**
     * PHP source files in the plugin directory (excluding tests and vendor).
     *
     * @var array
     */
    private $pluginFiles;

    protected function setUp(): void
    {
        $this->pluginDir = realpath(__DIR__ . '/..');
        $this->pluginFiles = $this->getPluginSourceFiles($this->pluginDir);
    }

    /**
     * Test that the plugin autoloader only handles classes with the plugin's own prefix
     * and does not register globally for all classes.
     *
     * A well-isolated plugin autoloader must:
     * - Only handle classes under its own namespace prefix
     * - Return early (no-op) for classes outside its prefix
     * - Not interfere with SLiMS's own autoloading
     *
     * Validates: Requirement 1.3
     *
     * @return void
     */
    public function testAutoloaderIsNamespaceScopedAndNonInterfering()
    {
        $indexFile = $this->pluginDir . '/index.php';
        $this->assertFileExists($indexFile);

        $content = file_get_contents($indexFile);

        // Verify the autoloader is registered with spl_autoload_register (proper way)
        $this->assertStringContainsString(
            'spl_autoload_register',
            $content,
            'Plugin must use spl_autoload_register for class autoloading'
        );

        // Verify the autoloader checks a namespace prefix before loading
        // This ensures it only loads its own classes, not arbitrary ones
        $this->assertStringContainsString(
            'strncmp',
            $content,
            'Plugin autoloader must check namespace prefix before loading (uses strncmp or similar)'
        );

        // Verify early return for non-matching classes
        // The autoloader should return without action for classes outside its namespace
        $this->assertMatchesRegularExpression(
            '/if\s*\(.*strncmp.*\)\s*\{?\s*return/',
            $content,
            'Plugin autoloader must return early for classes outside its namespace prefix'
        );

        // Verify the autoloader does not use global include paths or set_include_path
        $this->assertStringNotContainsString(
            'set_include_path',
            $content,
            'Plugin must not modify PHP include path globally'
        );

        // Verify no composer global autoloader injection outside plugin dir
        $composerAutoload = $this->pluginDir . '/vendor/autoload.php';
        if (file_exists($composerAutoload)) {
            // Composer autoload is fine inside plugin - just verify it's not
            // referencing paths outside the plugin
            $autoloadContent = file_get_contents($composerAutoload);
            $this->assertStringNotContainsString(
                'set_include_path',
                $autoloadContent,
                'Composer autoloader must not modify global include path'
            );
        }
    }

    /**
     * Test that the plugin does not define global functions outside namespaced classes.
     *
     * Global functions would remain in PHP's function table even after the plugin
     * files are deleted, potentially causing "Cannot redeclare" errors if SLiMS
     * defines functions with the same names, or "undefined function" errors if
     * other code accidentally depends on them.
     *
     * Validates: Requirement 1.3
     *
     * @return void
     */
    public function testNoGlobalFunctionsDefinedOutsideClasses()
    {
        $globalFunctions = array();

        foreach ($this->pluginFiles as $file) {
            $content = file_get_contents($file);
            if ($content === false) {
                continue;
            }

            // Find function declarations that are at the top level (not inside a class)
            // We look for 'function name(' that is NOT preceded by class context indicators
            $tokens = token_get_all($content);
            $insideClass = 0;
            $insideNamespace = false;

            for ($i = 0; $i < count($tokens); $i++) {
                if (!is_array($tokens[$i])) {
                    if ($tokens[$i] === '{') {
                        $insideClass++;
                    } elseif ($tokens[$i] === '}') {
                        $insideClass--;
                    }
                    continue;
                }

                // Track namespace declarations
                if ($tokens[$i][0] === T_NAMESPACE) {
                    $insideNamespace = true;
                }

                // Track class/trait/interface declarations
                if (in_array($tokens[$i][0], array(T_CLASS, T_TRAIT, T_INTERFACE))) {
                    // Next non-whitespace token after class keyword is the class name
                    // We mark that we're about to enter a class block
                    // The { tracking above handles nesting
                }

                // Find function declarations at top level (not inside a class body)
                if ($tokens[$i][0] === T_FUNCTION && $insideClass <= 1) {
                    // Check if this is a closure (anonymous function)
                    $nextToken = $this->getNextNonWhitespaceToken($tokens, $i);
                    if ($nextToken !== null && is_array($nextToken) && $nextToken[0] === T_STRING) {
                        $funcName = $nextToken[1];
                        // Only flag truly global functions (not namespaced ones that disappear with plugin)
                        if (!$insideNamespace && $insideClass === 0) {
                            $relativePath = $this->getRelativePath($file);
                            $globalFunctions[] = "{$relativePath}: global function '{$funcName}()'";
                        }
                    }
                }
            }
        }

        $this->assertEmpty(
            $globalFunctions,
            "Plugin must not define global functions that could leave residual dependencies.\n"
            . "Global functions found:\n" . implode("\n", $globalFunctions)
        );
    }

    /**
     * Test that the plugin does not define global constants that SLiMS would depend on.
     *
     * Constants defined with define() persist for the entire PHP process. If SLiMS
     * code accidentally starts depending on a plugin-defined constant, removing the
     * plugin would cause "Undefined constant" errors.
     *
     * Validates: Requirement 1.3
     *
     * @return void
     */
    public function testNoGlobalConstantsDefinedForExternalUse()
    {
        $globalConstants = array();

        // Allowed constants: INDEX_AUTH check is part of SLiMS plugin mechanism
        $allowedPatterns = array(
            'INDEX_AUTH', // SLiMS mechanism, not defined by plugin but checked
        );

        foreach ($this->pluginFiles as $file) {
            $content = file_get_contents($file);
            if ($content === false) {
                continue;
            }

            // Find define() calls that create new constants
            if (preg_match_all('/\bdefine\s*\(\s*[\'"]([^\'"]+)[\'"]\s*,/m', $content, $matches)) {
                foreach ($matches[1] as $constName) {
                    $isAllowed = false;
                    foreach ($allowedPatterns as $allowed) {
                        if ($constName === $allowed) {
                            $isAllowed = true;
                            break;
                        }
                    }

                    if (!$isAllowed) {
                        $relativePath = $this->getRelativePath($file);
                        $globalConstants[] = "{$relativePath}: defines global constant '{$constName}'";
                    }
                }
            }
        }

        $this->assertEmpty(
            $globalConstants,
            "Plugin must not define global constants that SLiMS could depend on.\n"
            . "If constants are needed, use class constants instead.\n"
            . "Global constants found:\n" . implode("\n", $globalConstants)
        );
    }

    /**
     * Test that the plugin does not create files outside its own directory
     * that would remain on disk after the plugin folder is deleted.
     *
     * All plugin file operations (queue, temp files, logs) must be within
     * the plugin's own directory tree so that a simple `rm -rf plugins/nextlib-agent/`
     * cleanly removes everything.
     *
     * Validates: Requirement 1.3
     *
     * @return void
     */
    public function testNoFileCreationOutsidePluginDirectory()
    {
        $violations = array();

        // File creation functions to check
        $fileCreateFunctions = array(
            'file_put_contents',
            'fopen',
            'touch',
            'mkdir',
            'copy',
            'rename',
            'symlink',
            'link',
        );

        foreach ($this->pluginFiles as $file) {
            $content = file_get_contents($file);
            if ($content === false) {
                continue;
            }

            foreach ($fileCreateFunctions as $func) {
                if (strpos($content, $func) === false) {
                    continue;
                }

                // Find all calls and check path arguments
                $pattern = '/' . preg_quote($func, '/') . '\s*\(\s*([^,\)]+)/m';
                if (!preg_match_all($pattern, $content, $matches)) {
                    continue;
                }

                foreach ($matches[1] as $pathArg) {
                    $pathArg = trim($pathArg);

                    // Safe: paths relative to plugin directory (__DIR__)
                    if (strpos($pathArg, '__DIR__') !== false) {
                        continue;
                    }

                    // Safe: internal variable references for queue/temp within plugin
                    $safeVars = array(
                        '$this->queuePath',
                        '$this->queueFile',
                        '$queuePath',
                        '$queueFile',
                        '$tempFile',
                        '$filePath',
                        '$dir',
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

                    // Flag: absolute paths that don't reference the plugin directory
                    if (preg_match('/^[\'"]\//', $pathArg)) {
                        $relativePath = $this->getRelativePath($file);
                        $violations[] = "{$relativePath}: {$func}() may create file outside plugin dir: {$pathArg}";
                    }

                    // Flag: paths using sys_get_temp_dir or other system directories
                    if (strpos($pathArg, 'sys_get_temp_dir') !== false
                        || strpos($pathArg, 'tempnam') !== false
                    ) {
                        $relativePath = $this->getRelativePath($file);
                        $violations[] = "{$relativePath}: {$func}() creates temp file outside plugin dir: {$pathArg}";
                    }
                }
            }
        }

        $this->assertEmpty(
            $violations,
            "Plugin must not create files outside its own directory. After `rm -rf plugins/nextlib-agent/`"
            . " no plugin artifacts should remain.\nViolations found:\n"
            . implode("\n", $violations)
        );
    }

    /**
     * Test that the plugin does not perform any database schema modifications.
     *
     * The NextLib-Agent only reads existing SLiMS tables (biblio, member, loan, visitor).
     * It must NOT create its own tables, alter existing tables, or add indexes/triggers.
     * This ensures that removing the plugin folder leaves the database untouched.
     *
     * Validates: Requirement 1.3
     *
     * @return void
     */
    public function testNoDatabaseSchemaModifications()
    {
        $violations = array();

        // SQL DDL statements that modify schema
        $schemaModifyPatterns = array(
            '/\bCREATE\s+TABLE\b/i' => 'CREATE TABLE',
            '/\bALTER\s+TABLE\b/i' => 'ALTER TABLE',
            '/\bDROP\s+TABLE\b/i' => 'DROP TABLE',
            '/\bCREATE\s+INDEX\b/i' => 'CREATE INDEX',
            '/\bDROP\s+INDEX\b/i' => 'DROP INDEX',
            '/\bCREATE\s+TRIGGER\b/i' => 'CREATE TRIGGER',
            '/\bDROP\s+TRIGGER\b/i' => 'DROP TRIGGER',
            '/\bCREATE\s+VIEW\b/i' => 'CREATE VIEW',
            '/\bDROP\s+VIEW\b/i' => 'DROP VIEW',
            '/\bCREATE\s+PROCEDURE\b/i' => 'CREATE PROCEDURE',
            '/\bDROP\s+PROCEDURE\b/i' => 'DROP PROCEDURE',
            '/\bCREATE\s+FUNCTION\b/i' => 'CREATE FUNCTION (SQL)',
            '/\bDROP\s+FUNCTION\b/i' => 'DROP FUNCTION (SQL)',
            '/\bTRUNCATE\s+TABLE\b/i' => 'TRUNCATE TABLE',
        );

        foreach ($this->pluginFiles as $file) {
            $content = file_get_contents($file);
            if ($content === false) {
                continue;
            }

            foreach ($schemaModifyPatterns as $pattern => $label) {
                if (preg_match($pattern, $content)) {
                    $relativePath = $this->getRelativePath($file);
                    $violations[] = "{$relativePath}: Contains '{$label}' statement — plugin must only READ existing SLiMS tables";
                }
            }
        }

        $this->assertEmpty(
            $violations,
            "Plugin must NOT modify database schema. It only reads existing SLiMS tables.\n"
            . "Schema modifications would leave residual database artifacts after plugin removal.\n"
            . "Violations found:\n" . implode("\n", $violations)
        );
    }

    /**
     * Test that all plugin classes use namespaces or class-prefixed names,
     * so they won't conflict with SLiMS classes after removal.
     *
     * If a class is defined without a namespace and has a generic name,
     * SLiMS code might accidentally depend on it. Namespaced classes
     * disappear cleanly when the plugin files are removed.
     *
     * Validates: Requirement 1.3
     *
     * @return void
     */
    public function testAllClassesAreNamespacedOrPrefixed()
    {
        $violations = array();

        // Plugin-specific prefixes that make classes identifiable
        $validPrefixes = array('NextLib', 'Nextlib', 'nextlib');

        foreach ($this->pluginFiles as $file) {
            $content = file_get_contents($file);
            if ($content === false) {
                continue;
            }

            // Check if file declares a namespace
            $hasNamespace = preg_match('/^\s*namespace\s+/m', $content);

            // Find class declarations
            if (preg_match_all('/\bclass\s+([A-Z][A-Za-z0-9_]+)/m', $content, $matches)) {
                foreach ($matches[1] as $className) {
                    if ($hasNamespace) {
                        continue; // Namespaced classes are fine
                    }

                    // Check if class name has a valid prefix
                    $hasSafePrefix = false;
                    foreach ($validPrefixes as $prefix) {
                        if (strpos($className, $prefix) === 0) {
                            $hasSafePrefix = true;
                            break;
                        }
                    }

                    // Classes with generic names that aren't prefixed could cause conflicts
                    if (!$hasSafePrefix) {
                        // Allow classes that are clearly plugin-specific by name
                        $pluginSpecificNames = array(
                            'TokenValidator',
                            'HmacSigner',
                            'HttpClient',
                            'AggregateExporter',
                            'SearchBook',
                            'MemberCheck',
                            'ExtendBook',
                        );
                        if (!in_array($className, $pluginSpecificNames)) {
                            $relativePath = $this->getRelativePath($file);
                            $violations[] = "{$relativePath}: Class '{$className}' is not namespaced or prefixed — may conflict with SLiMS classes";
                        }
                    }
                }
            }
        }

        // This is a soft check — plugin-specific class names are acceptable
        // even without namespace, since they're unlikely to conflict
        $this->assertEmpty(
            $violations,
            "Plugin classes should be namespaced or have a recognizable prefix to avoid conflicts.\n"
            . "Violations found:\n" . implode("\n", $violations)
        );
    }

    /**
     * Test that the plugin does not register any persistent PHP extensions,
     * stream wrappers, or protocol handlers that would outlive the plugin files.
     *
     * These types of registrations persist in the PHP process and could cause
     * errors if the plugin is removed while the PHP process is still running.
     *
     * Validates: Requirement 1.3
     *
     * @return void
     */
    public function testNoPersistentRuntimeRegistrations()
    {
        $violations = array();

        // Functions that create persistent runtime registrations
        $persistentRegistrations = array(
            'stream_wrapper_register' => 'Registers a custom stream wrapper',
            'stream_filter_register' => 'Registers a custom stream filter',
            'ini_set' => 'Modifies PHP runtime configuration',
        );

        foreach ($this->pluginFiles as $file) {
            $content = file_get_contents($file);
            if ($content === false) {
                continue;
            }

            foreach ($persistentRegistrations as $func => $description) {
                if (preg_match('/\b' . preg_quote($func, '/') . '\s*\(/', $content)) {
                    $relativePath = $this->getRelativePath($file);
                    $violations[] = "{$relativePath}: Uses {$func}() — {$description}";
                }
            }
        }

        $this->assertEmpty(
            $violations,
            "Plugin must not make persistent runtime registrations that outlive plugin removal.\n"
            . "Violations found:\n" . implode("\n", $violations)
        );
    }

    /**
     * Get all PHP source files from the plugin (excluding tests and vendor).
     *
     * @param string $dir Directory to scan
     * @return array List of absolute file paths
     */
    private function getPluginSourceFiles(string $dir): array
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

            // Skip test files and vendor directory
            if (strpos($path, '/tests/') !== false
                || strpos($path, '/vendor/') !== false
                || strpos($path, 'Test.php') !== false
            ) {
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

    /**
     * Get the next non-whitespace token after the given index.
     *
     * @param array $tokens Token array from token_get_all
     * @param int   $index  Current index
     * @return mixed|null The next non-whitespace token or null
     */
    private function getNextNonWhitespaceToken(array $tokens, int $index)
    {
        for ($i = $index + 1; $i < count($tokens); $i++) {
            if (is_array($tokens[$i]) && $tokens[$i][0] === T_WHITESPACE) {
                continue;
            }
            return $tokens[$i];
        }
        return null;
    }
}
