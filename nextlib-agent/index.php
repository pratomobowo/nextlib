<?php
/**
 * NextLib-Agent Plugin for SLiMS
 *
 * Plugin entry point that registers all NextLib functionality
 * through the standard SLiMS plugin API without modifying core files.
 *
 * @package    NextLib-Agent
 * @version    1.0.0
 * @author     NextLib Team
 * @license    MIT
 * @requires   PHP 7.4+
 * @requires   SLiMS 9 Bulian or newer
 */

// Prevent direct access — SLiMS defines INDEX_AUTH before loading plugins
defined('INDEX_AUTH') or die('Direct access not permitted');

/**
 * Plugin registration
 *
 * This file is loaded by SLiMS plugin loader.
 * All routes and hooks are registered here.
 */

// Plugin metadata
$plugin_config = array(
    'name' => 'NextLib-Agent',
    'version' => '1.0.0',
    'description' => 'NextLib SaaS integration agent for SLiMS',
    'author' => 'NextLib Team',
    'url' => 'https://nextlib.id',
);

// Load environment variables from .env if available. SLiMS does not bootstrap
// the plugin's composer autoloader, so we require it explicitly (best-effort:
// the plugin still functions without it if env vars are set at the SAPI level).
// createUnsafeImmutable() also calls putenv() so getenv() in config.php works.
$nextlibAutoload = __DIR__ . '/vendor/autoload.php';
if (is_readable($nextlibAutoload)) {
    require_once $nextlibAutoload;
    if (class_exists('Dotenv\\Dotenv')) {
        Dotenv\Dotenv::createUnsafeImmutable(__DIR__)->safeLoad();
    }
}

// Load configuration
$nextlib_config = require __DIR__ . '/config.php';

// Autoload plugin classes using PSR-4-style mapping
spl_autoload_register(function ($class) {
    $prefix = 'NextLibAgent\\';
    $base_dir = __DIR__ . '/';

    $len = strlen($prefix);
    if (strncmp($prefix, $class, $len) !== 0) {
        return;
    }

    $relative_class = substr($class, $len);
    $file = $base_dir . str_replace('\\', '/', $relative_class) . '.php';

    if (file_exists($file)) {
        require_once $file;
    }
});

// --- API Route Registration ---
// Register routes using SLiMS plugin API pattern.
// Routes are dispatched based on REQUEST_URI and REQUEST_METHOD.

$nextlib_routes = array(
    '/api/v1/nextlib/search-book' => 'NextLibAgent\\endpoints\\SearchBook',
    '/api/v1/nextlib/member-check' => 'NextLibAgent\\endpoints\\MemberCheck',
    '/api/v1/nextlib/extend-book' => 'NextLibAgent\\endpoints\\ExtendBook',
    '/api/v1/nextlib/agent-command' => 'NextLibAgent\\endpoints\\AgentCommand',
    // Library analytics detail (real-time queries against SLiMS)
    '/api/v1/nextlib/top-books' => 'NextLibAgent\\endpoints\\TopBooks',
    '/api/v1/nextlib/dead-stock' => 'NextLibAgent\\endpoints\\DeadStock',
    '/api/v1/nextlib/collection-stats' => 'NextLibAgent\\endpoints\\CollectionStats',
    '/api/v1/nextlib/member-activity' => 'NextLibAgent\\endpoints\\MemberActivity',
);

// Determine current request path
$request_uri = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '';
$request_path = parse_url($request_uri, PHP_URL_PATH);
$request_method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '';

// Handle unauthenticated health check endpoint
if ($request_path === '/api/v1/nextlib/health') {
    $endpoint = new \NextLibAgent\endpoints\Health();
    $params = array();
    if ($request_method === 'POST') {
        $requestBody = file_get_contents('php://input');
        $params = json_decode($requestBody, true);
        if (!is_array($params)) {
            $params = array();
        }
    }
    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($endpoint->handle($params), JSON_UNESCAPED_UNICODE);
    return;
}

// Only handle POST requests to registered API routes
if ($request_method === 'POST' && $request_path !== null) {
    // Handle handshake endpoint (lightweight ping, no endpoint class needed)
    if ($request_path === '/api/v1/nextlib/handshake') {
        \NextLibAgent\Middleware\TokenValidator::handle(
            $nextlib_config['api_secret'],
            function ($requestBody) use ($nextlib_config) {
                return array(
                    'status' => 'ok',
                    'plugin' => 'nextlib-agent',
                    'version' => '1.0.0',
                    'tenant_id' => $nextlib_config['tenant_id'],
                );
            },
            $nextlib_config['token_max_age']
        );
        return;
    }

    // Handle registered endpoint routes
    if (isset($nextlib_routes[$request_path])) {
        $endpoint_class = $nextlib_routes[$request_path];

        \NextLibAgent\Middleware\TokenValidator::handle(
            $nextlib_config['api_secret'],
            function ($requestBody) use ($endpoint_class) {
                $params = json_decode($requestBody, true);
                if ($params === null) {
                    $params = array();
                }

                $endpoint = new $endpoint_class();
                return $endpoint->handle($params);
            },
            $nextlib_config['token_max_age']
        );
        return;
    }
}
