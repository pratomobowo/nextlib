<?php
/**
 * NextLib-Agent Local Configuration
 *
 * Values are read from environment variables (typically a sibling .env file,
 * loaded by vlucas/phpdotenv in index.php / cron.php). Every key falls back to
 * a placeholder so this file is safe to commit and never contains real secrets.
 *
 * SECURITY NOTICE (Requirement 3.4):
 * Real secrets belong in `.env` (gitignored), never in this file. This file
 * stays non-web-accessible (SLiMS `plugins/` folder) and is additionally
 * protected by the INDEX_AUTH guard below and `.htaccess` defense-in-depth.
 *
 * @package    NextLib-Agent
 * @version    1.1.0
 * @see        Requirement 3.4 — secret key stored in non-web-accessible config
 */

// Prevent direct web access — INDEX_AUTH is defined by SLiMS core bootstrap.
// If this file is requested directly via HTTP, INDEX_AUTH will not be defined
// and execution will terminate immediately without revealing any configuration.
if (!defined('INDEX_AUTH')) {
    http_response_code(403);
    die('Direct access not permitted');
}

/**
 * Read an environment variable with a fallback default.
 *
 * getenv() is used (rather than $_ENV) because phpdotenv populates both, and
 * getenv() works reliably across PHP 7.4–8.2 + SAPI variations.
 *
 * @param string $key     Environment variable name.
 * @param mixed  $default Fallback when the variable is unset or empty.
 * @return mixed
 */
$nextlib_env = function ($key, $default = null) {
    $value = getenv($key);
    if ($value === false || $value === '') {
        return $default;
    }
    return $value;
};

return array(
    /**
     * Ed25519 public key for SaaS request signature verification.
     * Verifying-only key — safe to ship in plaintext.
     * Env: NEXTLIB_PUBLIC_KEY
     *
     * @var string
     */
    'ed25519_public_key' => $nextlib_env('NEXTLIB_PUBLIC_KEY', ''),

    /**
     * API secret key for HMAC-SHA256 token validation (legacy v1).
     * Provided during onboarding from NextLib-Cloud.
     * Env: NEXTLIB_TOKEN_SECRET
     *
     * @var string
     */
    'api_secret' => $nextlib_env('NEXTLIB_TOKEN_SECRET', 'change-me-in-.env'),

    /**
     * NextLib-Cloud base URL for aggregate data export.
     * Must use HTTPS protocol in production.
     * Env: NEXTLIB_CLOUD_URL
     *
     * @var string
     */
    'cloud_base_url' => $nextlib_env('NEXTLIB_CLOUD_URL', 'http://localhost:3000'),

    /**
     * Tenant identifier assigned by NextLib-Cloud.
     * Env: NEXTLIB_TENANT_ID
     *
     * @var string
     */
    'tenant_id' => $nextlib_env('NEXTLIB_TENANT_ID', 'change-me-in-.env'),

    /**
     * SLiMS database connection settings.
     * Env: SLIMS_DB_HOST / SLIMS_DB_PORT / SLIMS_DB_NAME / SLIMS_DB_USER / SLIMS_DB_PASS
     */
    'db_host' => $nextlib_env('SLIMS_DB_HOST', 'localhost'),
    'db_port' => $nextlib_env('SLIMS_DB_PORT', '3306'),
    'db_name' => $nextlib_env('SLIMS_DB_NAME', 'slims'),
    'db_user' => $nextlib_env('SLIMS_DB_USER', 'root'),
    'db_pass' => $nextlib_env('SLIMS_DB_PASS', ''),

    /**
     * Token expiry window in seconds (default: 5 minutes).
     * Env: NEXTLIB_TOKEN_MAX_AGE
     *
     * @var int
     */
    'token_max_age' => (int) $nextlib_env('NEXTLIB_TOKEN_MAX_AGE', 300),

    /**
     * HTTP client timeout in seconds.
     * Env: NEXTLIB_HTTP_TIMEOUT
     *
     * @var int
     */
    'http_timeout' => (int) $nextlib_env('NEXTLIB_HTTP_TIMEOUT', 5),

    /**
     * Enable debug mode (disable in production).
     * Env: NEXTLIB_DEBUG (1/0)
     *
     * @var bool
     */
    'debug' => filter_var($nextlib_env('NEXTLIB_DEBUG', '0'), FILTER_VALIDATE_BOOLEAN),
);
