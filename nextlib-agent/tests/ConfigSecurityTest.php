<?php
/**
 * Tests for config.php security protections.
 *
 * Validates Requirement 3.4: Secret key stored in non-web-accessible config file
 * with INDEX_AUTH guard to prevent direct HTTP access.
 *
 * @package NextLib\Agent\Tests
 */

use PHPUnit\Framework\TestCase;

class ConfigSecurityTest extends TestCase
{
    /**
     * Path to the config.php file.
     *
     * @var string
     */
    private $configPath;

    protected function setUp(): void
    {
        $this->configPath = __DIR__ . '/../config.php';
    }

    /**
     * Test that config.php exists at the expected location.
     *
     * @return void
     */
    public function testConfigFileExists()
    {
        $this->assertFileExists(
            $this->configPath,
            'config.php must exist in the nextlib-agent plugin directory'
        );
    }

    /**
     * Test that config.php contains INDEX_AUTH protection check.
     *
     * Requirement 3.4: The config file must prevent direct web access by
     * checking that INDEX_AUTH constant is defined (set by SLiMS core bootstrap).
     *
     * @return void
     */
    public function testConfigFileHasIndexAuthProtection()
    {
        $content = file_get_contents($this->configPath);

        $this->assertNotFalse($content, 'Should be able to read config.php');

        // Verify it checks for INDEX_AUTH constant
        $this->assertStringContainsString(
            "defined('INDEX_AUTH')",
            $content,
            'config.php must check if INDEX_AUTH constant is defined'
        );

        // Verify it terminates execution when INDEX_AUTH is not defined
        $this->assertStringContainsString(
            'die(',
            $content,
            'config.php must terminate execution (die) when INDEX_AUTH is not defined'
        );
    }

    /**
     * Test that config.php returns 403 status code when accessed directly.
     *
     * Requirement 3.4: Direct web access must be denied with HTTP 403.
     *
     * @return void
     */
    public function testConfigFileReturns403OnDirectAccess()
    {
        $content = file_get_contents($this->configPath);

        $this->assertStringContainsString(
            'http_response_code(403)',
            $content,
            'config.php must return HTTP 403 when accessed directly'
        );
    }

    /**
     * Test that INDEX_AUTH check appears before any configuration data.
     *
     * The security guard must be the first logical operation in the file,
     * before any sensitive data like api_secret is exposed.
     *
     * @return void
     */
    public function testIndexAuthCheckAppearsBeforeConfig()
    {
        $content = file_get_contents($this->configPath);

        $guardPosition = strpos($content, "defined('INDEX_AUTH')");
        $configPosition = strpos($content, "'api_secret'");

        $this->assertNotFalse($guardPosition, 'INDEX_AUTH guard must exist');
        $this->assertNotFalse($configPosition, 'api_secret config key must exist');
        $this->assertLessThan(
            $configPosition,
            $guardPosition,
            'INDEX_AUTH guard must appear before api_secret configuration'
        );
    }

    /**
     * Test that config.php can be loaded successfully when INDEX_AUTH is defined.
     *
     * When included by SLiMS (which defines INDEX_AUTH), config.php must return
     * the configuration array without errors.
     *
     * @return void
     */
    public function testConfigFileLoadsWhenIndexAuthDefined()
    {
        // INDEX_AUTH is already defined by the test bootstrap
        $this->assertTrue(defined('INDEX_AUTH'), 'INDEX_AUTH should be defined in test env');

        $config = include $this->configPath;

        $this->assertIsArray($config, 'config.php must return an array when included');
        $this->assertArrayHasKey('api_secret', $config);
        $this->assertArrayHasKey('cloud_base_url', $config);
        $this->assertArrayHasKey('tenant_id', $config);
        $this->assertArrayHasKey('token_max_age', $config);
    }

    /**
     * Test that .htaccess file exists to provide defense-in-depth web access protection.
     *
     * Requirement 3.4: An .htaccess file must deny direct HTTP access to PHP files.
     *
     * @return void
     */
    public function testHtaccessFileExists()
    {
        $htaccessPath = __DIR__ . '/../.htaccess';
        $this->assertFileExists(
            $htaccessPath,
            '.htaccess must exist in the nextlib-agent plugin directory'
        );
    }

    /**
     * Test that .htaccess denies access to PHP files.
     *
     * @return void
     */
    public function testHtaccessDeniesPhpFileAccess()
    {
        $htaccessContent = file_get_contents(__DIR__ . '/../.htaccess');

        // Verify it has a rule matching .php files
        $this->assertStringContainsString(
            '.php',
            $htaccessContent,
            '.htaccess must contain rules for .php files'
        );

        // Verify it uses deny directives
        $this->assertStringContainsString(
            'Require all denied',
            $htaccessContent,
            '.htaccess must deny access using Apache 2.4+ directive'
        );
    }

    /**
     * Test that .htaccess allows access to index.php (plugin entry point).
     *
     * @return void
     */
    public function testHtaccessAllowsIndexPhpAccess()
    {
        $htaccessContent = file_get_contents(__DIR__ . '/../.htaccess');

        // Verify index.php is explicitly allowed
        $this->assertStringContainsString(
            'index.php',
            $htaccessContent,
            '.htaccess must have a specific rule for index.php'
        );

        $this->assertStringContainsString(
            'Require all granted',
            $htaccessContent,
            '.htaccess must grant access to index.php'
        );
    }
}
