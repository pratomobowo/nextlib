<?php
/**
 * Example test to verify PHPUnit is working correctly.
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;

class ExampleTest extends TestCase
{
    /**
     * Verify PHPUnit framework is operational.
     */
    public function testPhpUnitIsWorking(): void
    {
        $this->assertTrue(true, 'PHPUnit is working');
    }

    /**
     * Verify PHP version meets minimum requirement (7.4+).
     */
    public function testPhpVersionCompatibility(): void
    {
        $this->assertTrue(
            version_compare(PHP_VERSION, '7.4.0', '>='),
            'PHP version must be 7.4 or higher. Current: ' . PHP_VERSION
        );
    }

    /**
     * Verify required PHP extensions are loaded.
     */
    public function testRequiredExtensionsLoaded(): void
    {
        $this->assertTrue(
            extension_loaded('json'),
            'JSON extension is required'
        );
        $this->assertTrue(
            extension_loaded('hash'),
            'Hash extension is required for HMAC-SHA256'
        );
    }
}
