<?php
/**
 * Plugin Name: NextLib-Agent
 * Plugin URI: https://nextlib.id
 * Description: NextLib SaaS integration agent for SLiMS. Provides library analytics
 *              detail endpoints, member check, loan extension, and search-book
 *              functionality accessible via /api/v1/nextlib/* routes.
 * Version: 2.1.0
 * Author: NextLib Team
 * Author URI: https://nextlib.id
 * License: MIT
 *
 * @package    NextLib-Agent
 * @version    2.1.0
 * @requires   PHP 7.4+
 * @requires   SLiMS 9 Bulian or newer
 */

// Prevent direct access — SLiMS defines INDEX_AUTH before loading plugins
defined('INDEX_AUTH') or die('Direct access not permitted');

/**
 * Plugin entry point (loaded by SLiMS plugin loader via lib/Plugins.php).
 *
 * This file does FIVE things:
 *   1. Provide SLiMS-readable plugin metadata header (above)
 *   2. Bootstrap the plugin's composer autoloader + .env loader
 *   3. Load the local config (defines NEXTLIB_TOKEN_SECRET etc.)
 *   4. Register plugin classes with a PSR-4-style autoloader
 *   5. Register our /api/v1/nextlib/* routes on SLiMS's existing API
 *      router via the `custom_api_route` hook (api/v1/routes.php:51)
 *
 * ROUTING MODEL (since v2.0.0):
 * The plugin's HTTP API is reached through SLiMS's existing /api/v1/
 * front controller. We register routes on the `custom_api_route` hook
 * which fires inside api/v1/routes.php. SLiMS's Router then dispatches
 * matched requests to NextLibAgent\Plugin::handleXxx() methods.
 *
 * The previous design (v1.x) used a standalone index.php in this directory
 * and required Apache/Nginx rewrite rules to route /api/v1/nextlib/* to it.
 * That has been REMOVED — see docs/ROUTING.md for migration notes.
 *
 * Without this file, SLiMS's lib/Plugins.php:getPluginsInfo() (which scans
 * for files matching the literal "plugin.php" substring) does not register
 * the plugin, so it is invisible in Admin → Plugins and cannot be toggled.
 */

$nextlibAutoload = __DIR__ . '/vendor/autoload.php';
if (is_readable($nextlibAutoload)) {
    require_once $nextlibAutoload;
    if (class_exists('Dotenv\\Dotenv')) {
        Dotenv\Dotenv::createUnsafeImmutable(__DIR__)->safeLoad();
    }
}

$nextlib_config = require __DIR__ . '/config.php';

spl_autoload_register(function ($class) {
    $prefix = 'NextLibAgent\\';
    // Plugin classes live under the plugin root with PSR-4-style subdirs:
    //   NextLibAgent\Plugin          → lib/Plugin.php
    //   NextLibAgent\Lib\Foo         → lib/Foo.php
    //   NextLibAgent\Middleware\Bar  → middleware/Bar.php
    //   NextLibAgent\endpoints\Baz   → endpoints/Baz.php
    // We special-case the root namespace (NextLibAgent\) to look in lib/
    // so NextLibAgent\Plugin maps to lib/Plugin.php.
    $base_dir = __DIR__ . '/';

    $len = strlen($prefix);
    if (strncmp($prefix, $class, $len) !== 0) {
        return;
    }

    $relative = substr($class, $len);
    if ($relative === false || $relative === '') {
        return;
    }

    // Try lib/<name>.php first (covers the root namespace + Lib\ subdir),
    // then the explicit subdirectories for Middleware/endpoints/Exporter.
    $candidates = [
        $base_dir . 'lib/' . str_replace('\\', '/', $relative) . '.php',
        $base_dir . str_replace('\\', '/', $relative) . '.php',
        $base_dir . 'middleware/' . str_replace('\\', '/', $relative) . '.php',
        $base_dir . 'endpoints/' . str_replace('\\', '/', $relative) . '.php',
        $base_dir . 'exporter/' . str_replace('\\', '/', $relative) . '.php',
    ];

    foreach ($candidates as $file) {
        if (file_exists($file)) {
            require_once $file;
            return;
        }
    }
});

$plugin = \SLiMS\Plugins::getInstance();

/**
 * Register API routes on SLiMS's /api/v1/ Router.
 *
 * The `custom_api_route` hook is fired by api/v1/routes.php:51 just
 * after SLiMS's own routes are registered, with a `Router` instance
 * passed in the args. We add our routes to that Router.
 *
 * Route paths are relative to the Router's basePath ('api'). Since
 * SLiMS strips 'api' from the request URL, the actual URL is /api/v1/...
 * but the path registered here is /v1/... (with the v1/ prefix).
 */
$plugin->register('custom_api_route', function ($router) use ($nextlib_config) {
    // SLiMS's Plugins::execute() (lib/Plugins.php:489) calls callbacks with
    // `call_user_func_array($cb, array_values($params))`, so the Router
    // arrives as the first positional arg — NOT as `$args['router']`.
    // Treating the first arg as an array is what produced the
    // "Cannot use object of type Router as array" fatal on the API path.

    // Unauthenticated health probe — used by SaaS to verify reachability
    $router->map('GET', '/v1/nextlib/health', 'NextLibAgent\\Plugin@handleHealth');

    // HMAC-protected endpoints
    $router->map('POST', '/v1/nextlib/handshake',        'NextLibAgent\\Plugin@handleHandshake');
    $router->map('POST', '/v1/nextlib/search-book',      'NextLibAgent\\Plugin@handleSearchBook');
    $router->map('POST', '/v1/nextlib/member-check',     'NextLibAgent\\Plugin@handleMemberCheck');
    $router->map('POST', '/v1/nextlib/extend-book',      'NextLibAgent\\Plugin@handleExtendBook');
    $router->map('POST', '/v1/nextlib/agent-command',    'NextLibAgent\\Plugin@handleAgentCommand');
    $router->map('POST', '/v1/nextlib/top-books',        'NextLibAgent\\Plugin@handleTopBooks');
    $router->map('POST', '/v1/nextlib/dead-stock',       'NextLibAgent\\Plugin@handleDeadStock');
    $router->map('POST', '/v1/nextlib/collection-stats', 'NextLibAgent\\Plugin@handleCollectionStats');
    $router->map('POST', '/v1/nextlib/member-activity',  'NextLibAgent\\Plugin@handleMemberActivity');
});

// Touch the variable so PHP doesn't complain about unused-import
unset($nextlib_config);
