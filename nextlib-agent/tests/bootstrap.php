<?php
/**
 * PHPUnit Bootstrap File
 *
 * Sets up autoloading and defines constants needed for testing
 * the NextLib-Agent plugin outside the SLiMS environment.
 *
 * @package NextLib\Agent\Tests
 */

// Define INDEX_AUTH to allow loading plugin files that check for it
if (!defined('INDEX_AUTH')) {
    define('INDEX_AUTH', 1);
}

// Load Composer autoloader
require_once __DIR__ . '/../vendor/autoload.php';
