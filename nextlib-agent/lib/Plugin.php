<?php
/**
 * NextLib-Agent Plugin Dispatcher
 *
 * Single class that handles all /api/v1/nextlib/* HTTP requests.
 * Invoked by SLiMS's Router (registered via the `custom_api_route` hook
 * in nextlib-agent.plugin.php), so requests reach us through SLiMS's
 * existing front controller — no Apache/Nginx rewrite rules required.
 *
 * Each public method `handleXxx($urlParams)` is bound to one route. Methods
 * are called by the Router via class@method dispatch, with the URL pattern
 * parameters as the argument. The HTTP body is read directly via
 * file_get_contents('php://input') since the SLiMS Router does not pass it.
 *
 * @package    NextLib-Agent
 * @version    2.0.0
 * @requires   PHP 7.4+
 * @requires   SLiMS 9 Bulian or newer (uses custom_api_route hook)
 *
 * @see nextlib-agent.plugin.php  — registers this class on the hook
 * @see opac-pustakalaya.../api/v1/routes.php:51  — where the hook fires
 */

namespace NextLibAgent;

use NextLibAgent\endpoints\AgentCommand;
use NextLibAgent\endpoints\CollectionStats;
use NextLibAgent\endpoints\DailyAggregate;
use NextLibAgent\endpoints\DeadStock;
use NextLibAgent\endpoints\ExtendBook;
use NextLibAgent\endpoints\Health;
use NextLibAgent\endpoints\MemberActivity;
use NextLibAgent\endpoints\MemberCheck;
use NextLibAgent\endpoints\SearchBook;
use NextLibAgent\endpoints\TopBooks;
use NextLibAgent\Middleware\TokenValidator;

class Plugin
{
    /** @var mixed SLiMS sysconf (passed by Router) */
    private $sysconf;

    /** @var \PDO|null SLiMS DB connection (passed by Router) */
    private $db;

    /** @var array Local plugin config (loaded from config.php) */
    private $config;

    /**
     * @param mixed $sysconf SLiMS sysconf (unused, but Router passes it)
     * @param \PDO|null $db SLiMS DB connection (unused — endpoints use global $dbs)
     */
    public function __construct($sysconf, $db = null)
    {
        $this->sysconf = $sysconf;
        $this->db = $db;

        // Load .env + config. The plugin's .plugin.php already required
        // autoloader + Dotenv once, so by the time the Router dispatches
        // to this class, getenv() is populated.
        $this->config = require __DIR__ . '/../config.php';
    }

    // ──────────────────────────────────────────────────────────────
    // Public route handlers (bound via $router->map() in plugin file)
    // ──────────────────────────────────────────────────────────────

    /**
     * GET /api/v1/nextlib/health — Unauthenticated health probe.
     *
     * Returns DB connectivity, last export timestamp, backfill state, and
     * system metrics. Used by NextLib-Cloud to verify the plugin is
     * reachable before initiating any authenticated traffic.
     */
    public function handleHealth($params = [])
    {
        $body = $this->readJsonBody();
        $endpoint = new Health($this->db);
        $result = $endpoint->handle($body);
        $this->sendJson(200, $result);
    }

    /**
     * POST /api/v1/nextlib/handshake — Lightweight auth-verified ping.
     *
     * Returns tenant_id + version to confirm the agent and cloud agree on
     * credentials, without performing any DB or HTTP work. Accepts either
     * Ed25519 (X-NextLib-Timestamp + X-NextLib-Signature) or legacy HMAC
     * (X-NextLib-Token + X-NextLib-Secret-Hash) auth.
     */
    public function handleHandshake($params = [])
    {
        $this->withHmac(function () {
            return [
                'status' => 'ok',
                'plugin' => 'nextlib-agent',
                'version' => '2.1.0',
                'tenant_id' => $this->config['tenant_id'],
            ];
        });
    }

    /**
     * POST /api/v1/nextlib/search-book — Real-time biblio search.
     */
    public function handleSearchBook($params = [])
    {
        $this->withHmac(function ($body) {
            $requestData = $this->parseBody($body);
            $endpoint = new SearchBook($this->db);
            return $endpoint->handle($requestData);
        });
    }

    /**
     * POST /api/v1/nextlib/member-check — Member eligibility verification.
     */
    public function handleMemberCheck($params = [])
    {
        $this->withHmac(function ($body) {
            $requestData = $this->parseBody($body);
            $endpoint = new MemberCheck($this->db);
            return $endpoint->handle($requestData);
        });
    }

    /**
     * POST /api/v1/nextlib/extend-book — Loan period extension.
     */
    public function handleExtendBook($params = [])
    {
        $this->withHmac(function ($body) {
            $requestData = $this->parseBody($body);
            $endpoint = new ExtendBook($this->db);
            return $endpoint->handle($requestData);
        });
    }

    /**
     * POST /api/v1/nextlib/agent-command — Generic agent command dispatch.
     */
    public function handleAgentCommand($params = [])
    {
        $this->withHmac(function ($body) {
            $requestData = $this->parseBody($body);
            $endpoint = new AgentCommand($this->db);
            return $endpoint->handle($requestData);
        });
    }

    /**
     * POST /api/v1/nextlib/top-books — Most-loaned books.
     */
    public function handleTopBooks($params = [])
    {
        $this->withHmac(function ($body) {
            $requestData = $this->parseBody($body);
            $endpoint = new TopBooks($this->db);
            return $endpoint->handle($requestData);
        });
    }

    /**
     * POST /api/v1/nextlib/dead-stock — Never-loaned books.
     */
    public function handleDeadStock($params = [])
    {
        $this->withHmac(function ($body) {
            $requestData = $this->parseBody($body);
            $endpoint = new DeadStock($this->db);
            return $endpoint->handle($requestData);
        });
    }

    /**
     * POST /api/v1/nextlib/collection-stats — Collection summary.
     */
    public function handleCollectionStats($params = [])
    {
        $this->withHmac(function ($body) {
            $requestData = $this->parseBody($body);
            $endpoint = new CollectionStats($this->db);
            return $endpoint->handle($requestData);
        });
    }

    /**
     * POST /api/v1/nextlib/member-activity — Active member statistics.
     */
    public function handleMemberActivity($params = [])
    {
        $this->withHmac(function ($body) {
            $requestData = $this->parseBody($body);
            $endpoint = new MemberActivity($this->db);
            return $endpoint->handle($requestData);
        });
    }

    /**
     * POST /api/v1/nextlib/daily-aggregate — Daily metrics for a date range.
     *
     * Returns v1/v2 schema daily metrics (visitor/loan counts, new
     * member/biblio/item counts) for the requested window, plus a
     * snapshot of cumulative collection size and active members as of
     * the end date. Used by NextLib-Cloud to backfill historical days
     * and to power the per-day charts on the SaaS dashboard.
     */
    public function handleDailyAggregate($params = [])
    {
        $this->withHmac(function ($body) {
            $requestData = $this->parseBody($body);
            $endpoint = new DailyAggregate($this->db);
            return $endpoint->handle($requestData);
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Private helpers
    // ──────────────────────────────────────────────────────────────

    /**
     * Run a callback behind authentication (Ed25519 preferred, HMAC fallback).
     *
     * Thin wrapper over TokenValidator::handle. The callback receives the
     * raw request body and returns the response data; TokenValidator takes
     * care of signature/timestamp validation and JSON output.
     *
     * Both auth keys are passed: TokenValidator picks Ed25519 if its headers
     * are present, otherwise HMAC. If Ed25519 headers are present but
     * verification fails, the request is rejected (no downgrade to HMAC).
     */
    private function withHmac(callable $callback)
    {
        TokenValidator::handle(
            $this->config['ed25519_public_key'] ?? '',
            $this->config['api_secret'] ?? '',
            $callback,
            $this->config['token_max_age']
        );
    }

    /**
     * Read and decode the JSON request body.
     *
     * @return array Empty array if no body or invalid JSON.
     */
    private function readJsonBody(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || $raw === '') {
            return [];
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }

    /**
     * @param string $body Raw request body (passed by TokenValidator callback)
     * @return array Decoded JSON or empty array
     */
    private function parseBody(string $body): array
    {
        $decoded = json_decode($body, true);
        return is_array($decoded) ? $decoded : [];
    }

    /**
     * Output a JSON response and terminate the script.
     */
    private function sendJson(int $status, array $data)
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE);
    }
}
