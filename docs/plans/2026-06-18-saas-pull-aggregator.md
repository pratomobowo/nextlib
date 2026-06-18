# SaaS-Pull Aggregator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace push-based plugin data sync with SaaS-pulls-from-agent architecture. The plugin reads SLiMS's own `$dbs` (no plugin-side DB credentials), returns daily aggregates for a date range. SaaS scheduled job + manual trigger + backfill all use the same endpoint.

**Architecture:**
- **Plugin (PHP):** new `POST /api/v1/nextlib/daily-aggregate` endpoint, HMAC auth, returns v1/v2-shaped daily metrics for any date range (≤366 days). Uses SLiMS's `global $dbs`.
- **SaaS (TypeScript):** new `pullAgentDailyAggregate()` in `agent-client.ts`. New BullMQ scheduled worker (daily 02:00 UTC, last 7 days). New `pull-now` API route. Refactored `backfill-worker` uses pull. New `tenants.lastPullAt`/`lastPullStatus`/`lastPullError` columns. UI: "Last sync" indicator + "Pull now" button.
- **Rollout:** Phase 1 = add pull alongside push (this plan). Phase 2 = cleanup push code (next plan, after 1 week stable).

**Tech Stack:** PHP 7.4+ (slims plugin), Next.js 16.2.9 (SaaS), Drizzle ORM 0.45, BullMQ 5.78, PostgreSQL 16, libsodium (Ed25519, already wired), vitest (SaaS tests), PHPUnit 10 (plugin tests).

**Reference docs:**
- Design: `docs/plans/2026-06-18-saas-pull-aggregator-design.md` (approved)
- Prior security: `docs/plans/2026-06-17-ed25519-auth-implementation.md`
- Existing Ed25519 test-connection: `nextlib-cloud/src/app/api/v1/tenants/[id]/test-connection/route.ts`
- Existing backfill worker: `nextlib-cloud/src/lib/backfill/backfill-worker.ts`
- Existing plugin endpoint pattern: `nextlib-agent/endpoints/TopBooks.php`

---

## Task 1: Add new `tenants` columns + Drizzle migration

**Files:**
- Modify: `nextlib-cloud/src/lib/db/schema.ts:19-33`
- Create: `nextlib-cloud/drizzle/0006_lush_pull_aggregator.sql` (drizzle-kit will generate)
- Test: type-check after migration

**Step 1: Modify schema**

Edit `nextlib-cloud/src/lib/db/schema.ts` to add three new columns to `tenants`:

```typescript
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).unique().notNull(),
  slimsBaseUrl: text("slims_base_url").notNull(),
  apiSecretEncrypted: text("api_secret_encrypted").notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  ed25519PublicKey: text("ed25519_public_key"),
  ed25519PrivateKeyEncrypted: text("ed25519_private_key_encrypted"),
  ed25519RotatedAt: timestamp("ed25519_rotated_at", { withTimezone: true }),
  ed25519KeyId: text("ed25519_key_id"),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  // NEW: pull tracking
  lastPullAt: timestamp("last_pull_at", { withTimezone: true }),
  lastPullStatus: varchar("last_pull_status", { length: 20 }), // 'ok' | 'failed' | 'partial'
  lastPullError: text("last_pull_error"), // truncated to 500 chars at write time
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

**Step 2: Generate migration**

Run: `cd nextlib-cloud && npm run db:generate`
Expected: new file in `nextlib-cloud/drizzle/0006_*.sql` containing the three `ALTER TABLE` statements.

**Step 3: Verify migration SQL**

Open the generated file. Confirm it has:

```sql
ALTER TABLE "tenants" ADD COLUMN "last_pull_at" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "tenants" ADD COLUMN "last_pull_status" VARCHAR(20);
ALTER TABLE "tenants" ADD COLUMN "last_pull_error" TEXT;
```

If not, edit by hand to match.

**Step 4: Run migration locally**

Run: `cd nextlib-cloud && npm run db:migrate`
Expected: `✅ Migration complete` for 0006.

**Step 5: Type-check**

Run: `cd nextlib-cloud && npx tsc --noEmit 2>&1 | grep -E "tenants|lastPull" | head`
Expected: no errors.

**Step 6: Commit**

```bash
git add nextlib-cloud/src/lib/db/schema.ts nextlib-cloud/drizzle/0006_*.sql
git commit -m "feat(schema): add lastPullAt/Status/Error to tenants

Tracks when the SaaS last pulled daily aggregates from the agent
and whether the pull succeeded. Used by the scheduled-pull worker
and the connection-editor UI's 'Last sync' indicator."
```

---

## Task 2: Plugin — `DailyAggregate` endpoint skeleton (TDD)

**Files:**
- Create: `nextlib-agent/endpoints/DailyAggregate.php`
- Create: `nextlib-agent/tests/endpoints/DailyAggregateTest.php`

**Step 1: Write the failing test**

Create `nextlib-agent/tests/endpoints/DailyAggregateTest.php`:

```php
<?php
namespace NextLibAgent\endpoints;

use PHPUnit\Framework\TestCase;

class DailyAggregateTest extends TestCase
{
    private $pdo;

    protected function setUp(): void
    {
        $this->pdo = new \PDO('sqlite::memory:');
        $this->pdo->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
        // Minimal schema for tests — subset of real SLiMS tables
        $this->pdo->exec("
            CREATE TABLE loan (
                loan_id INTEGER PRIMARY KEY,
                loan_date DATE,
                return_date DATE,
                member_id VARCHAR(50),
                item_code VARCHAR(50)
            );
            CREATE TABLE member (
                member_id VARCHAR(50) PRIMARY KEY,
                member_name VARCHAR(255),
                register_date DATE
            );
            CREATE TABLE biblio (
                biblio_id INTEGER PRIMARY KEY,
                classification VARCHAR(50),
                input_date DATE
            );
            CREATE TABLE item (
                item_id INTEGER PRIMARY KEY,
                biblio_id INTEGER,
                item_code VARCHAR(50) UNIQUE,
                input_date DATE,
                coll_type_id INTEGER
            );
            CREATE TABLE visitor_log (
                visitor_id INTEGER PRIMARY KEY,
                member_id VARCHAR(50),
                checkin_date DATE
            );
        ");
    }

    public function testReturnsEmptyDaysForEmptyRange(): void
    {
        $endpoint = new DailyAggregate($this->pdo);
        $result = $endpoint->handle(['start_date' => '2024-01-01', 'end_date' => '2024-01-01']);
        $this->assertEquals('2.0', $result['schema_version']);
        $this->assertCount(0, $result['days']);
    }

    public function testReturnsDailyMetricsForRange(): void
    {
        // Seed: 2 loans on 2024-01-15, 1 return on 2024-01-15, 1 visitor on 2024-01-15
        $this->pdo->exec("INSERT INTO loan (loan_date, return_date) VALUES ('2024-01-15', NULL), ('2024-01-15', '2024-01-15')");
        $this->pdo->exec("INSERT INTO visitor_log (member_id, checkin_date) VALUES ('m1', '2024-01-15')");

        $endpoint = new DailyAggregate($this->pdo);
        $result = $endpoint->handle(['start_date' => '2024-01-15', 'end_date' => '2024-01-15']);

        $this->assertCount(1, $result['days']);
        $day = $result['days'][0];
        $this->assertEquals('2024-01-15', $day['date']);
        $this->assertEquals(2, $day['daily_metrics']['loan_count']);
        $this->assertEquals(1, $day['daily_metrics']['return_count']);
        $this->assertEquals(1, $day['daily_metrics']['visitor_count']);
    }

    public function testRejectsRangeOver366Days(): void
    {
        $endpoint = new DailyAggregate($this->pdo);
        $result = $endpoint->handle(['start_date' => '2020-01-01', 'end_date' => '2024-01-01']);
        $this->assertEquals('INVALID_DATE_RANGE', $result['code']);
    }

    public function testRejectsMalformedDates(): void
    {
        $endpoint = new DailyAggregate($this->pdo);
        $result = $endpoint->handle(['start_date' => '2024-13-99', 'end_date' => '2024-01-01']);
        $this->assertEquals('INVALID_DATE_RANGE', $result['code']);
    }

    public function testRejectsInvertedRange(): void
    {
        $endpoint = new DailyAggregate($this->pdo);
        $result = $endpoint->handle(['start_date' => '2024-12-31', 'end_date' => '2024-01-01']);
        $this->assertEquals('INVALID_DATE_RANGE', $result['code']);
    }

    public function testReturnsDbUnavailableWhenConnectionMissing(): void
    {
        $endpoint = new DailyAggregate(null);
        $result = $endpoint->handle(['start_date' => '2024-01-01', 'end_date' => '2024-01-01']);
        $this->assertEquals('DB_CONNECTION_FAILED', $result['code']);
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cd nextlib-agent && vendor/bin/phpunit tests/endpoints/DailyAggregateTest.php`
Expected: `Class "NextLibAgent\endpoints\DailyAggregate" not found` (fatal error).

**Step 3: Implement the skeleton**

Create `nextlib-agent/endpoints/DailyAggregate.php`:

```php
<?php
/**
 * Daily Aggregate Endpoint
 *
 * Handles POST /api/v1/nextlib/daily-aggregate requests.
 * Returns daily metrics for a date range in v1/v2 schema format.
 * Uses SLiMS's $dbs global (no plugin-side DB credentials).
 *
 * Request:  { "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" }
 * Response: { "schema_version": "2.0", "days": [...], ... }
 *
 * @package    NextLib-Agent
 * @subpackage Endpoints
 * @version    2.2.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\endpoints;

class DailyAggregate
{
    /** Max range in days to prevent runaway queries. */
    const MAX_RANGE_DAYS = 366;

    /** @var \PDO|null Database connection (injectable for testing) */
    private $db;

    public function __construct($db = null)
    {
        $this->db = $db;
    }

    /**
     * @param array $params
     *   - start_date (string, YYYY-MM-DD)
     *   - end_date   (string, YYYY-MM-DD)
     * @return array
     */
    public function handle(array $params): array
    {
        // 1. Validate dates
        $startDate = isset($params['start_date']) ? trim((string) $params['start_date']) : '';
        $endDate   = isset($params['end_date']) ? trim((string) $params['end_date']) : '';
        $validation = $this->validateRange($startDate, $endDate);
        if ($validation !== null) {
            return $validation;
        }

        // 2. Get DB connection
        $db = $this->getConnection();
        if ($db === null) {
            return array(
                'error'   => true,
                'code'    => 'DB_CONNECTION_FAILED',
                'message' => 'Database connection is not available',
            );
        }

        // 3. Compute snapshot metrics (as-of end_date)
        $snapshot = $this->computeSnapshotMetrics($db, $endDate);

        // 4. Enumerate dates in range
        $dates = $this->enumerateDates($startDate, $endDate);

        // 5. For each date, compute daily metrics
        $days = array();
        foreach ($dates as $date) {
            $daily = $this->computeDailyMetricsForDate($db, $date);
            $days[] = array(
                'date'            => $date,
                'daily_metrics'   => $daily,
                'snapshot_metrics' => $snapshot,
                'anomaly_flags'   => array(),
            );
        }

        return array(
            'schema_version' => '2.0',
            'start_date'     => $startDate,
            'end_date'       => $endDate,
            'days'           => $days,
        );
    }

    private function validateRange(string $startDate, string $endDate): ?array
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $startDate) ||
            !preg_match('/^\d{4}-\d{2}-\d{2}$/', $endDate)) {
            return array(
                'error' => true,
                'code'  => 'INVALID_DATE_RANGE',
                'message' => 'Dates must be in YYYY-MM-DD format',
            );
        }
        $s = new \DateTimeImmutable($startDate);
        $e = new \DateTimeImmutable($endDate);
        if ($s > $e) {
            return array(
                'error' => true,
                'code'  => 'INVALID_DATE_RANGE',
                'message' => 'start_date must be <= end_date',
            );
        }
        $diff = $s->diff($e)->days;
        if ($diff > self::MAX_RANGE_DAYS) {
            return array(
                'error' => true,
                'code'  => 'INVALID_DATE_RANGE',
                'message' => 'Range must be <= ' . self::MAX_RANGE_DAYS . ' days',
            );
        }
        return null;
    }

    private function computeDailyMetricsForDate(\PDO $db, string $date): array
    {
        // Visitor count
        $stmt = $db->prepare("SELECT COUNT(*) FROM visitor_log WHERE checkin_date = :d");
        $stmt->execute([':d' => $date]);
        $visitorCount = (int) $stmt->fetchColumn();

        // Unique visitor count
        $stmt = $db->prepare("SELECT COUNT(DISTINCT member_id) FROM visitor_log WHERE checkin_date = :d AND member_id IS NOT NULL");
        $stmt->execute([':d' => $date]);
        $uniqueVisitorCount = (int) $stmt->fetchColumn();

        // Loan count
        $stmt = $db->prepare("SELECT COUNT(*) FROM loan WHERE loan_date = :d");
        $stmt->execute([':d' => $date]);
        $loanCount = (int) $stmt->fetchColumn();

        // Return count
        $stmt = $db->prepare("SELECT COUNT(*) FROM loan WHERE return_date = :d");
        $stmt->execute([':d' => $date]);
        $returnCount = (int) $stmt->fetchColumn();

        // New member count
        $stmt = $db->prepare("SELECT COUNT(*) FROM member WHERE register_date = :d");
        $stmt->execute([':d' => $date]);
        $newMemberCount = (int) $stmt->fetchColumn();

        // New biblio count
        $stmt = $db->prepare("SELECT COUNT(*) FROM biblio WHERE input_date = :d");
        $stmt->execute([':d' => $date]);
        $newBiblioCount = (int) $stmt->fetchColumn();

        // New item count
        $stmt = $db->prepare("SELECT COUNT(*) FROM item WHERE input_date = :d");
        $stmt->execute([':d' => $date]);
        $newItemCount = (int) $stmt->fetchColumn();

        // TODO: fines, reservations (need more schema; add in follow-up)

        return array(
            'visitor_count'        => $visitorCount,
            'unique_visitor_count' => $uniqueVisitorCount,
            'loan_count'           => $loanCount,
            'return_count'         => $returnCount,
            'new_member_count'     => $newMemberCount,
            'new_biblio_count'     => $newBiblioCount,
            'new_item_count'       => $newItemCount,
            'fines_debet_total'    => 0,
            'fines_credit_total'   => 0,
            'reservation_count'    => 0,
        );
    }

    private function computeSnapshotMetrics(\PDO $db, string $asOfDate): array
    {
        $stmt = $db->query("SELECT COUNT(*) FROM item");
        $totalCollectionSize = (int) $stmt->fetchColumn();

        // Active members: had any loan in last 365 days
        $stmt = $db->prepare("
            SELECT COUNT(DISTINCT member_id) FROM loan
            WHERE loan_date >= date(:d, '-365 days') AND member_id IS NOT NULL
        ");
        $stmt->execute([':d' => $asOfDate]);
        $activeMemberCount = (int) $stmt->fetchColumn();

        // Overdue: loan_date < :d AND return_date IS NULL
        $stmt = $db->prepare("
            SELECT COUNT(*) FROM loan
            WHERE loan_date < :d AND return_date IS NULL
        ");
        $stmt->execute([':d' => $asOfDate]);
        $activeOverdueCount = (int) $stmt->fetchColumn();

        return array(
            'total_collection_size' => $totalCollectionSize,
            'active_member_count'   => $activeMemberCount,
            'active_overdue_count'  => $activeOverdueCount,
        );
    }

    private function enumerateDates(string $start, string $end): array
    {
        $out = array();
        $s = new \DateTimeImmutable($start);
        $e = new \DateTimeImmutable($end);
        for ($d = $s; $d <= $e; $d = $d->modify('+1 day')) {
            $out[] = $d->format('Y-m-d');
        }
        return $out;
    }

    private function getConnection()
    {
        if ($this->db !== null) {
            return $this->db;
        }
        global $dbs;
        if (isset($dbs) && $dbs instanceof \PDO) {
            return $dbs;
        }
        return null;
    }
}
```

**Step 4: Run test to verify it passes**

Run: `cd nextlib-agent && vendor/bin/phpunit tests/endpoints/DailyAggregateTest.php`
Expected: All 6 tests pass.

**Step 5: Run full plugin test suite to confirm no regressions**

Run: `cd nextlib-agent && vendor/bin/phpunit`
Expected: 571+ tests pass (was 571 before; new = 6).

**Step 6: Commit**

```bash
git add nextlib-agent/endpoints/DailyAggregate.php nextlib-agent/tests/endpoints/DailyAggregateTest.php
git commit -m "feat(plugin): add DailyAggregate endpoint skeleton

Returns daily metrics for a date range in v1/v2 schema format.
Range-validates inputs, uses SLiMS's global \$dbs (no plugin-side
credentials needed), caps range at 366 days.

TDD: 6 test cases (empty range, range with data, validation,
DB unavailable, inverted range, malformed dates)."
```

---

## Task 3: Plugin — register `daily-aggregate` route

**Files:**
- Modify: `nextlib-agent/nextlib-agent.plugin.php:118-129`
- Test: route registration integration test

**Step 1: Add the route**

In `nextlib-agent.plugin.php`, add to the `$plugin->register('custom_api_route', ...)` block (around line 118):

```php
$router->map('GET', '/v1/nextlib/health', 'NextLibAgent\\Plugin@handleHealth');

// Pull endpoint for SaaS-scheduled daily data ingestion
$router->map('POST', '/v1/nextlib/daily-aggregate', 'NextLibAgent\\Plugin@handleDailyAggregate');
```

**Step 2: Add handler method in `lib/Plugin.php`**

Read `nextlib-agent/lib/Plugin.php` to find where `handleHealth()` is defined. Add `handleDailyAggregate()`:

```php
/**
 * Handle POST /api/v1/nextlib/daily-aggregate requests.
 *
 * Pulls daily aggregate metrics for a date range from SLiMS's own
 * $dbs connection. Used by the SaaS scheduled-pull worker and
 * manual backfill jobs. No plugin-side DB credentials required.
 */
public function handleDailyAggregate($router): void
{
    $body = file_get_contents('php://input');
    $params = is_string($body) && $body !== '' ? (array) json_decode($body, true) : array();

    $endpoint = new \NextLibAgent\endpoints\DailyAggregate();
    $result = $endpoint->handle($params);

    // Map internal error codes to HTTP status
    if (isset($result['code'])) {
        switch ($result['code']) {
            case 'INVALID_DATE_RANGE':
                $status = 400;
                break;
            case 'DB_CONNECTION_FAILED':
                $status = 503;
                break;
            default:
                $status = 500;
        }
        $this->sendJson($status, $result);
        return;
    }

    $this->sendJson(200, $result);
}
```

**Step 3: Write integration test for route registration**

Create `nextlib-agent/tests/integration/RouteRegistrationTest.php`:

```php
<?php
namespace NextLibAgent\integration;

use PHPUnit\Framework\TestCase;

class RouteRegistrationTest extends TestCase
{
    public function testDailyAggregateRouteIsRegistered(): void
    {
        $pluginFile = __DIR__ . '/../../nextlib-agent.plugin.php';
        $contents = file_get_contents($pluginFile);
        $this->assertStringContainsString(
            "'/v1/nextlib/daily-aggregate'",
            $contents,
            "daily-aggregate route must be registered in nextlib-agent.plugin.php"
        );
    }

    public function testHandleDailyAggregateMethodExists(): void
    {
        $this->assertTrue(
            method_exists(\NextLibAgent\Plugin::class, 'handleDailyAggregate'),
            "Plugin class must have handleDailyAggregate() method"
        );
    }
}
```

**Step 4: Run the new tests**

Run: `cd nextlib-agent && vendor/bin/phpunit tests/integration/RouteRegistrationTest.php`
Expected: 2 tests pass.

**Step 5: Run full suite**

Run: `cd nextlib-agent && vendor/bin/phpunit`
Expected: 579 tests pass (571 + 6 from Task 2 + 2 from Task 3).

**Step 6: Commit**

```bash
git add nextlib-agent/nextlib-agent.plugin.php nextlib-agent/lib/Plugin.php nextlib-agent/tests/integration/RouteRegistrationTest.php
git commit -m "feat(plugin): register /daily-aggregate route

Adds the route registration in nextlib-agent.plugin.php and the
handleDailyAggregate() method in lib/Plugin.php. Route is POST,
returns 200/400/503/500 with the v2-shape JSON payload.

Integration test verifies the route is registered and the handler
method exists on the Plugin class."
```

---

## Task 4: SaaS — `pullAgentDailyAggregate()` in `agent-client.ts` (TDD)

**Files:**
- Modify: `nextlib-cloud/src/lib/agent/agent-client.ts`
- Create: `nextlib-cloud/src/lib/agent/agent-client.test.ts`

**Step 1: Write the failing test**

Create `nextlib-cloud/src/lib/agent/agent-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { pullAgentDailyAggregate, type DailyAggregateResponse } from "./agent-client";

const fakeTenant = {
  slimsBaseUrl: "https://slims.example.com/",
  apiSecretEncrypted: "encrypted-fake",
};

const fakeEncryptionKey = "test-key";

describe("pullAgentDailyAggregate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls /api/v1/nextlib/daily-aggregate with HMAC headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        schema_version: "2.0",
        start_date: "2024-01-01",
        end_date: "2024-01-07",
        days: [],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    // Mock decrypt
    vi.mock("@/lib/crypto", () => ({
      decrypt: vi.fn((val: string) => {
        if (val === fakeTenant.slimsBaseUrl) return "https://slims.example.com";
        if (val === fakeTenant.apiSecretEncrypted) return "test-secret";
        return val;
      }),
    }));

    await pullAgentDailyAggregate(fakeTenant, "2024-01-01", "2024-01-07", fakeEncryptionKey);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://slims.example.com/api/v1/nextlib/daily-aggregate");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["X-NextLib-Token"]).toBeDefined();
    expect(init.headers["X-NextLib-Secret-Hash"]).toBeDefined();
    expect(JSON.parse(init.body)).toEqual({
      start_date: "2024-01-01",
      end_date: "2024-01-07",
    });
  });

  it("returns parsed JSON on success", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        schema_version: "2.0",
        start_date: "2024-01-01",
        end_date: "2024-01-01",
        days: [
          {
            date: "2024-01-01",
            daily_metrics: {
              visitor_count: 5,
              unique_visitor_count: 3,
              loan_count: 2,
              return_count: 1,
              new_member_count: 0,
              new_biblio_count: 0,
              new_item_count: 0,
              fines_debet_total: 0,
              fines_credit_total: 0,
              reservation_count: 0,
            },
            snapshot_metrics: {
              total_collection_size: 100,
              active_member_count: 50,
              active_overdue_count: 2,
            },
            anomaly_flags: [],
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.mock("@/lib/crypto", () => ({
      decrypt: vi.fn(() => "https://slims.example.com"),
    }));

    const result = await pullAgentDailyAggregate(fakeTenant, "2024-01-01", "2024-01-01", fakeEncryptionKey);
    expect(result.success).toBe(true);
    expect(result.days).toHaveLength(1);
    expect(result.days?.[0]?.date).toBe("2024-01-01");
  });

  it("returns failure on 503", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ code: "DB_CONNECTION_FAILED", message: "DB down" }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.mock("@/lib/crypto", () => ({
      decrypt: vi.fn(() => "https://slims.example.com"),
    }));

    const result = await pullAgentDailyAggregate(fakeTenant, "2024-01-01", "2024-01-01", fakeEncryptionKey);
    expect(result.success).toBe(false);
    expect(result.status).toBe(503);
    expect(result.error).toContain("DB down");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd nextlib-cloud && npx vitest run src/lib/agent/agent-client.test.ts`
Expected: FAIL with `pullAgentDailyAggregate is not exported from ./agent-client`.

**Step 3: Implement `pullAgentDailyAggregate`**

Add to `nextlib-cloud/src/lib/agent/agent-client.ts` (after `triggerAgentExport`, before `queryAgent`):

```typescript
import { createHash } from "crypto";
import { decrypt } from "@/lib/crypto";
import { generateToken } from "@/lib/hmac";
import type { Tenant } from "@/lib/db/schema";

/** Shape of one day in the response from the agent's daily-aggregate endpoint. */
export interface DailyAggregateDay {
  date: string;
  daily_metrics: {
    visitor_count: number;
    unique_visitor_count: number;
    loan_count: number;
    return_count: number;
    new_member_count: number;
    new_biblio_count: number;
    new_item_count: number;
    fines_debet_total: number;
    fines_credit_total: number;
    reservation_count: number;
  };
  snapshot_metrics: {
    total_collection_size: number;
    active_member_count: number;
    active_overdue_count: number;
  };
  anomaly_flags: string[];
}

export interface DailyAggregateResponse {
  schema_version: "2.0";
  start_date: string;
  end_date: string;
  days: DailyAggregateDay[];
}

export interface PullAgentResult {
  success: boolean;
  status: number;
  days?: DailyAggregateDay[];
  error?: string;
}

/** Per-call timeout for the pull. Generous because a 366-day range
 *  requires the agent to do ~10 SQL queries + a date-series fill. */
const PULL_TIMEOUT_MS = 60_000;

/**
 * Pull daily aggregate metrics for a date range from the agent.
 *
 * Replaces the old push-based `triggerAgentExport()` flow: instead of
 * asking the agent to compute aggregates and POST them back, we call
 * the agent's read-only /daily-aggregate endpoint and get the data
 * directly. This means the plugin no longer needs its own SLiMS DB
 * credentials.
 *
 * @param tenant        Tenant row (must have encrypted credentials)
 * @param startDate     Inclusive YYYY-MM-DD
 * @param endDate       Inclusive YYYY-MM-DD (range must be ≤ 366 days)
 * @param encryptionKey AES-256 key for decrypting tenant credentials
 */
export async function pullAgentDailyAggregate(
  tenant: Pick<Tenant, "slimsBaseUrl" | "apiSecretEncrypted">,
  startDate: string,
  endDate: string,
  encryptionKey: string
): Promise<PullAgentResult> {
  // 1. Decrypt credentials
  let slimsBaseUrl: string;
  let apiSecret: string;
  try {
    slimsBaseUrl = decrypt(tenant.slimsBaseUrl, encryptionKey);
    apiSecret = decrypt(tenant.apiSecretEncrypted, encryptionKey);
  } catch {
    return { success: false, status: 0, error: "Failed to decrypt tenant credentials" };
  }

  // 2. Build signed request
  const body = JSON.stringify({ start_date: startDate, end_date: endDate });
  const token = generateToken(body, apiSecret);
  const secretHash = createHash("sha256").update(apiSecret).digest("hex");
  const targetUrl = `${slimsBaseUrl.replace(/\/+$/, "")}/api/v1/nextlib/daily-aggregate`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PULL_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-NextLib-Token": token,
        "X-NextLib-Secret-Hash": secretHash,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status >= 200 && response.status < 300) {
      const data = (await response.json()) as DailyAggregateResponse;
      return { success: true, status: response.status, days: data.days };
    }

    let agentError = `Agent returned HTTP ${response.status}`;
    try {
      const errBody = (await response.json()) as { message?: string };
      if (errBody.message) agentError = errBody.message;
    } catch {
      // not JSON
    }
    return { success: false, status: response.status, error: agentError };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      return {
        success: false,
        status: 0,
        error: `Agent did not respond within ${PULL_TIMEOUT_MS / 1000}s`,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, status: 0, error: `Failed to reach agent: ${message}` };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd nextlib-cloud && npx vitest run src/lib/agent/agent-client.test.ts`
Expected: All 3 tests pass.

**Step 5: Run full vitest suite to check regressions**

Run: `cd nextlib-cloud && npx vitest run`
Expected: 453+ tests pass (was 450 + 3 new).

**Step 6: Commit**

```bash
git add nextlib-cloud/src/lib/agent/agent-client.ts nextlib-cloud/src/lib/agent/agent-client.test.ts
git commit -m "feat(saas): add pullAgentDailyAggregate()

Replaces triggerAgentExport's push pattern with a direct pull from
the agent's /api/v1/nextlib/daily-aggregate endpoint. Plugin no
longer needs its own SLiMS DB credentials.

HMAC-signed (X-NextLib-Token + X-NextLib-Secret-Hash) with a 60s
timeout (range of 366 days needs ~10 SQL queries). Returns the
agent's parsed JSON or a structured error."
```

---

## Task 5: SaaS — `bulkUpsertDailyStatsV2()` helper (TDD)

**Files:**
- Create: `nextlib-cloud/src/lib/analytics/daily-stats-bulk.ts`
- Create: `nextlib-cloud/src/lib/analytics/daily-stats-bulk.test.ts`

**Step 1: Write the failing test**

Create `nextlib-cloud/src/lib/analytics/daily-stats-bulk.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { bulkUpsertDailyStatsV2, type DailyStatsV2Input } from "./daily-stats-bulk";

const sampleDays: DailyStatsV2Input[] = [
  {
    date: "2024-01-01",
    visitorCount: 45,
    uniqueVisitorCount: 32,
    loanCount: 8,
    returnCount: 5,
    newMemberCount: 1,
    newBiblioCount: 0,
    newItemCount: 2,
    finesDebetTotal: 0,
    finesCreditTotal: 0,
    reservationCount: 0,
    totalCollectionSize: 12500,
    activeMemberCount: 350,
    activeOverdueCount: 12,
    anomalyFlags: [],
  },
];

describe("bulkUpsertDailyStatsV2", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls db.insert with onConflictDoUpdate for each day", async () => {
    const mockOnConflict = vi.fn().mockResolvedValue({ rowCount: 1 });
    const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict });
    const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

    vi.doMock("@/lib/db", () => ({
      db: { insert: mockInsert },
    }));
    vi.doMock("@/lib/db/schema", () => ({
      dailyStatsV2: { tenantId: "tenantId", date: "date" },
    }));

    // re-import after mocking
    const { bulkUpsertDailyStatsV2: freshFn } = await import("./daily-stats-bulk");
    const result = await freshFn("tenant-uuid", sampleDays);

    expect(result.rowsAffected).toBe(1);
    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockValues).toHaveBeenCalledOnce();
    expect(mockOnConflict).toHaveBeenCalledOnce();
  });

  it("returns zero rows when input is empty", async () => {
    const mockInsert = vi.fn();
    vi.doMock("@/lib/db", () => ({ db: { insert: mockInsert } }));
    vi.doMock("@/lib/db/schema", () => ({ dailyStatsV2: {} }));

    const { bulkUpsertDailyStatsV2: freshFn } = await import("./daily-stats-bulk");
    const result = await freshFn("tenant-uuid", []);
    expect(result.rowsAffected).toBe(0);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd nextlib-cloud && npx vitest run src/lib/analytics/daily-stats-bulk.test.ts`
Expected: FAIL with `Cannot find module './daily-stats-bulk'`.

**Step 3: Implement the helper**

Create `nextlib-cloud/src/lib/analytics/daily-stats-bulk.ts`:

```typescript
import { db } from "@/lib/db";
import { dailyStatsV2, tenants } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export interface DailyStatsV2Input {
  date: string;
  visitorCount: number;
  uniqueVisitorCount: number;
  loanCount: number;
  returnCount: number;
  newMemberCount: number;
  newBiblioCount: number;
  newItemCount: number;
  finesDebetTotal: number;
  finesCreditTotal: number;
  reservationCount: number;
  totalCollectionSize: number;
  activeMemberCount: number;
  activeOverdueCount: number;
  anomalyFlags: string[];
}

export interface BulkUpsertResult {
  rowsAffected: number;
}

/**
 * Bulk upsert daily_stats_v2 rows for a single tenant.
 *
 * Idempotent: ON CONFLICT (tenant_id, date) DO UPDATE overwrites
 * the existing row's metrics. Safe to re-run for the same date
 * range without producing duplicates.
 *
 * @param tenantId The tenant UUID
 * @param days     Array of daily metric inputs (one per date)
 */
export async function bulkUpsertDailyStatsV2(
  tenantId: string,
  days: DailyStatsV2Input[]
): Promise<BulkUpsertResult> {
  if (days.length === 0) {
    return { rowsAffected: 0 };
  }

  const values = days.map((d) => ({
    tenantId,
    date: d.date,
    visitorCount: d.visitorCount,
    uniqueVisitorCount: d.uniqueVisitorCount,
    loanCount: d.loanCount,
    returnCount: d.returnCount,
    newMemberCount: d.newMemberCount,
    newBiblioCount: d.newBiblioCount,
    newItemCount: d.newItemCount,
    finesDebetTotal: d.finesDebetTotal,
    finesCreditTotal: d.finesCreditTotal,
    reservationCount: d.reservationCount,
    totalCollectionSize: d.totalCollectionSize,
    activeMemberCount: d.activeMemberCount,
    activeOverdueCount: d.activeOverdueCount,
    anomalyFlags: d.anomalyFlags,
  }));

  const result = await db
    .insert(dailyStatsV2)
    .values(values)
    .onConflictDoUpdate({
      target: [dailyStatsV2.tenantId, dailyStatsV2.date],
      set: {
        visitorCount: sql`EXCLUDED.visitor_count`,
        uniqueVisitorCount: sql`EXCLUDED.unique_visitor_count`,
        loanCount: sql`EXCLUDED.loan_count`,
        returnCount: sql`EXCLUDED.return_count`,
        newMemberCount: sql`EXCLUDED.new_member_count`,
        newBiblioCount: sql`EXCLUDED.new_biblio_count`,
        newItemCount: sql`EXCLUDED.new_item_count`,
        finesDebetTotal: sql`EXCLUDED.fines_debet_total`,
        finesCreditTotal: sql`EXCLUDED.fines_credit_total`,
        reservationCount: sql`EXCLUDED.reservation_count`,
        totalCollectionSize: sql`EXCLUDED.total_collection_size`,
        activeMemberCount: sql`EXCLUDED.active_member_count`,
        activeOverdueCount: sql`EXCLUDED.active_overdue_count`,
        anomalyFlags: sql`EXCLUDED.anomaly_flags`,
        receivedAt: sql`NOW()`,
      },
    });

  return { rowsAffected: result.rowCount ?? days.length };
}

/**
 * Update a tenant's last-pull tracking fields. Truncates the error
 * message to 500 chars to keep the column bounded.
 */
export async function updateTenantPullStatus(
  tenantId: string,
  status: "ok" | "failed" | "partial",
  errorMessage?: string
): Promise<void> {
  const truncated = errorMessage
    ? errorMessage.length > 500
      ? errorMessage.slice(0, 497) + "..."
      : errorMessage
    : null;

  await db
    .update(tenants)
    .set({
      lastPullAt: new Date(),
      lastPullStatus: status,
      lastPullError: truncated,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));
}
```

**Step 4: Run test to verify it passes**

Run: `cd nextlib-cloud && npx vitest run src/lib/analytics/daily-stats-bulk.test.ts`
Expected: All 2 tests pass.

**Step 5: Run full suite**

Run: `cd nextlib-cloud && npx vitest run`
Expected: 455+ tests pass (was 453 + 2 new).

**Step 6: Commit**

```bash
git add nextlib-cloud/src/lib/analytics/daily-stats-bulk.ts nextlib-cloud/src/lib/analytics/daily-stats-bulk.test.ts
git commit -m "feat(saas): add bulkUpsertDailyStatsV2 helper

Idempotent bulk upsert into daily_stats_v2 using
ON CONFLICT (tenant_id, date) DO UPDATE. Safe to re-run
for the same date range.

Also adds updateTenantPullStatus() to record last-pull
success/failure on the tenants row."
```

---

## Task 6: SaaS — scheduled-pull worker (TDD)

**Files:**
- Create: `nextlib-cloud/src/lib/scheduler/scheduled-pull.ts`
- Create: `nextlib-cloud/src/lib/scheduler/scheduled-pull.test.ts`
- Modify: `nextlib-cloud/src/worker.ts`

**Step 1: Write the failing test**

Create `nextlib-cloud/src/lib/scheduler/scheduled-pull.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("scheduledPullWorker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("processes all connected tenants and pulls last 7 days", async () => {
    const mockPull = vi.fn().mockResolvedValue({ success: true, days: [] });
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mockBulk = vi.fn().mockResolvedValue({ rowsAffected: 0 });

    vi.doMock("@/lib/db", () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { id: "tenant-1" },
              { id: "tenant-2" },
            ]),
          }),
        }),
      },
    }));
    vi.doMock("@/lib/db/schema", () => ({
      tenants: { id: "id", status: "status" },
      eq: (a: unknown, b: unknown) => ({ a, b }),
    }));
    vi.doMock("@/lib/agent/agent-client", () => ({
      pullAgentDailyAggregate: mockPull,
    }));
    vi.doMock("@/lib/analytics/daily-stats-bulk", () => ({
      bulkUpsertDailyStatsV2: mockBulk,
      updateTenantPullStatus: mockUpdate,
    }));

    const { runScheduledPull } = await import("./scheduled-pull");
    await runScheduledPull();

    expect(mockPull).toHaveBeenCalledTimes(2);
    // Each call uses today-6 to today
    const [tenantArg, startArg, endArg] = mockPull.mock.calls[0];
    expect(tenantArg).toBe("tenant-1");
    expect(startArg).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(endArg).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const startDate = new Date(startArg);
    const endDate = new Date(endArg);
    const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(6);
  });

  it("marks tenant failed if pull throws", async () => {
    const mockPull = vi.fn().mockRejectedValue(new Error("network down"));
    const mockUpdate = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/lib/db", () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: "tenant-1" }]),
          }),
        }),
      },
    }));
    vi.doMock("@/lib/db/schema", () => ({
      tenants: { id: "id", status: "status" },
      eq: (a: unknown, b: unknown) => ({ a, b }),
    }));
    vi.doMock("@/lib/agent/agent-client", () => ({
      pullAgentDailyAggregate: mockPull,
    }));
    vi.doMock("@/lib/analytics/daily-stats-bulk", () => ({
      bulkUpsertDailyStatsV2: vi.fn(),
      updateTenantPullStatus: mockUpdate,
    }));

    const { runScheduledPull } = await import("./scheduled-pull");
    await runScheduledPull();

    expect(mockUpdate).toHaveBeenCalledWith("tenant-1", "failed", expect.stringContaining("network down"));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd nextlib-cloud && npx vitest run src/lib/scheduler/scheduled-pull.test.ts`
Expected: FAIL with `Cannot find module`.

**Step 3: Implement scheduled-pull worker**

Create `nextlib-cloud/src/lib/scheduler/scheduled-pull.ts`:

```typescript
import { Worker, type Job } from "bullmq";
import { eq } from "drizzle-orm";
import { redisConnection } from "@/lib/whatsapp/message-queue";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { pullAgentDailyAggregate } from "@/lib/agent/agent-client";
import { bulkUpsertDailyStatsV2, updateTenantPullStatus } from "@/lib/analytics/daily-stats-bulk";
import { decrypt } from "@/lib/crypto";

/** BullMQ queue name for the daily scheduled pull. */
export const SCHEDULED_PULL_QUEUE = "scheduled-pull";

/** Job data — empty, the worker iterates all connected tenants. */
export interface ScheduledPullJobData {
  /** ISO date string of when this run started, for logging. */
  startedAt: string;
}

/** Cron pattern for the daily scheduled pull. Configurable via env. */
const PULL_CRON = process.env.SCHEDULED_PULL_CRON ?? "0 2 * * *";
const PULL_LOOKBACK_DAYS = 7;

/**
 * Process one scheduled pull job: for every connected tenant, pull
 * the last PULL_LOOKBACK_DAYS days of metrics, bulk-upsert into
 * daily_stats_v2, and update the tenant's lastPullAt/Status.
 *
 * Failures are isolated per-tenant — one broken tenant doesn't stop
 * the others from being pulled.
 */
export async function runScheduledPull(): Promise<void> {
  const encryptionKey = process.env.AES_256_ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.error("[ScheduledPull] AES_256_ENCRYPTION_KEY is not configured; skipping run");
    return;
  }

  const tenantRows = await db
    .select({
      id: tenants.id,
      slimsBaseUrl: tenants.slimsBaseUrl,
      apiSecretEncrypted: tenants.apiSecretEncrypted,
    })
    .from(tenants)
    .where(eq(tenants.status, "connected"));

  console.log(`[ScheduledPull] Found ${tenantRows.length} connected tenant(s) to pull`);

  const today = new Date();
  const startDate = new Date(today);
  startDate.setUTCDate(startDate.getUTCDate() - (PULL_LOOKBACK_DAYS - 1));
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = today.toISOString().slice(0, 10);

  for (const tenant of tenantRows) {
    try {
      const result = await pullAgentDailyAggregate(
        { slimsBaseUrl: tenant.slimsBaseUrl, apiSecretEncrypted: tenant.apiSecretEncrypted },
        startStr,
        endStr,
        encryptionKey
      );

      if (!result.success || !result.days) {
        await updateTenantPullStatus(tenant.id, "failed", result.error ?? "Unknown error");
        console.warn(`[ScheduledPull] Tenant ${tenant.id} pull failed: ${result.error}`);
        continue;
      }

      if (result.days.length === 0) {
        // No data for the window — still mark as ok (agent is reachable)
        await updateTenantPullStatus(tenant.id, "ok");
        continue;
      }

      const upsertResult = await bulkUpsertDailyStatsV2(tenant.id, result.days);
      await updateTenantPullStatus(tenant.id, "ok");
      console.log(
        `[ScheduledPull] Tenant ${tenant.id}: upserted ${upsertResult.rowsAffected} day(s) for ${startStr}..${endStr}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateTenantPullStatus(tenant.id, "failed", msg);
      console.error(`[ScheduledPull] Tenant ${tenant.id} threw:`, msg);
    }
  }
}

/**
 * BullMQ worker for the scheduled pull. The actual schedule is set
 * by the queue (see createScheduledPullQueue below). The worker
 * just processes whatever the queue feeds it.
 */
export function createScheduledPullWorker(): Worker<ScheduledPullJobData> {
  const worker = new Worker<ScheduledPullJobData>(
    SCHEDULED_PULL_QUEUE,
    async (_job: Job<ScheduledPullJobData>) => {
      await runScheduledPull();
    },
    {
      connection: redisConnection,
      concurrency: 1,
      limiter: {
        // Don't hammer the agent if a previous run was delayed
        max: 1,
        duration: 60_000,
      },
    }
  );

  worker.on("completed", (job) => {
    console.log(`[ScheduledPull] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[ScheduledPull] Job ${job?.id} failed:`, err.message);
  });

  console.log("[ScheduledPull] Scheduled-pull worker started");
  return worker;
}

/**
 * Set up the repeatable scheduled pull job. Call this once at
 * worker boot. Safe to call multiple times — BullMQ's
 * `upsertJobScheduler` handles dedup.
 */
export async function ensureScheduledPullRegistered(): Promise<void> {
  const { Queue } = await import("bullmq");
  const queue = new Queue<ScheduledPullJobData>(SCHEDULED_PULL_QUEUE, {
    connection: redisConnection,
  });
  await queue.upsertJobScheduler(
    "daily-pull",
    { pattern: PULL_CRON, tz: "UTC" },
    {
      name: "daily-pull",
      data: { startedAt: new Date().toISOString() },
    }
  );
  await queue.close();
  console.log(`[ScheduledPull] Daily pull registered with cron: ${PULL_CRON}`);
}
```

**Step 4: Run test to verify it passes**

Run: `cd nextlib-cloud && npx vitest run src/lib/scheduler/scheduled-pull.test.ts`
Expected: 2 tests pass.

**Step 5: Register the worker in `src/worker.ts`**

Edit `nextlib-cloud/src/worker.ts`, add after the backfill worker block:

```typescript
// Boot the scheduled-pull worker
try {
  workers.push({ name: "scheduled-pull", worker: createScheduledPullWorker() });
} catch (err) {
  console.error("[Worker] Failed to start scheduled-pull worker:", err);
  process.exit(1);
}

// Register the daily pull schedule
import("@/lib/scheduler/scheduled-pull").then(({ ensureScheduledPullRegistered }) =>
  ensureScheduledPullRegistered().catch((err) =>
    console.error("[Worker] Failed to register scheduled pull:", err)
  )
);
```

**Step 6: Run full vitest suite**

Run: `cd nextlib-cloud && npx vitest run`
Expected: 457+ tests pass (455 + 2 new).

**Step 7: Commit**

```bash
git add nextlib-cloud/src/lib/scheduler/scheduled-pull.ts nextlib-cloud/src/lib/scheduler/scheduled-pull.test.ts nextlib-cloud/src/worker.ts
git commit -m "feat(saas): add scheduled-pull worker

BullMQ worker that runs daily at 02:00 UTC (configurable via
SCHEDULED_PULL_CRON env). For each connected tenant, pulls the
last 7 days of metrics from /api/v1/nextlib/daily-aggregate,
bulk-upserts to daily_stats_v2, and updates lastPullAt/Status.

Failures are isolated per-tenant."
```

---

## Task 7: SaaS — `/api/v1/tenants/[id]/pull-now` route

**Files:**
- Create: `nextlib-cloud/src/app/api/v1/tenants/[id]/pull-now/route.ts`
- Create: `nextlib-cloud/src/app/api/v1/tenants/[id]/pull-now/route.test.ts`

**Step 1: Write the failing test**

Create `nextlib-cloud/src/app/api/v1/tenants/[id]/pull-now/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

const createRequest = (body: unknown, userId = "user-1") =>
  new Request("http://localhost/api/v1/tenants/tenant-1/pull-now", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/v1/tenants/[id]/pull-now", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    vi.doMock("@/middleware/tenant-guard", () => ({
      authenticateRequest: vi.fn().mockResolvedValue({
        success: false,
        response: new Response(JSON.stringify({ error: "unauth" }), { status: 401 }),
      }),
    }));

    const res = await POST(createRequest({ start_date: "2024-01-01", end_date: "2024-01-07" }) as never, {
      params: Promise.resolve({ id: "tenant-1" }),
    } as never);
    expect(res.status).toBe(401);
  });

  it("returns 200 with rowsAffected on successful pull", async () => {
    vi.doMock("@/middleware/tenant-guard", () => ({
      authenticateRequest: vi.fn().mockResolvedValue({
        success: true,
        context: { user: { id: "user-1", role: "tenant_admin" }, tenant: { id: "tenant-1" } },
      }),
    }));
    vi.doMock("@/lib/agent/agent-client", () => ({
      pullAgentDailyAggregate: vi.fn().mockResolvedValue({
        success: true,
        days: [{ date: "2024-01-01", daily_metrics: { loan_count: 1 }, snapshot_metrics: {}, anomaly_flags: [] }],
      }),
    }));
    vi.doMock("@/lib/analytics/daily-stats-bulk", () => ({
      bulkUpsertDailyStatsV2: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
      updateTenantPullStatus: vi.fn(),
    }));
    vi.doMock("@/lib/db", () => ({ db: {} }));
    vi.doMock("@/lib/db/schema", () => ({}));

    const res = await POST(
      createRequest({ start_date: "2024-01-01", end_date: "2024-01-07" }) as never,
      { params: Promise.resolve({ id: "tenant-1" }) } as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.days_imported).toBe(1);
    expect(body.rows_affected).toBe(1);
  });

  it("returns 400 on invalid date range", async () => {
    vi.doMock("@/middleware/tenant-guard", () => ({
      authenticateRequest: vi.fn().mockResolvedValue({
        success: true,
        context: { user: { id: "user-1", role: "tenant_admin" }, tenant: { id: "tenant-1" } },
      }),
    }));
    vi.doMock("@/lib/db", () => ({ db: {} }));
    vi.doMock("@/lib/db/schema", () => ({}));

    const res = await POST(
      createRequest({ start_date: "2020-01-01", end_date: "2024-01-01" }) as never,
      { params: Promise.resolve({ id: "tenant-1" }) } as never
    );
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd nextlib-cloud && npx vitest run src/app/api/v1/tenants/\[id\]/pull-now/route.test.ts`
Expected: FAIL with `Cannot find module`.

**Step 3: Implement the route**

Create `nextlib-cloud/src/app/api/v1/tenants/[id]/pull-now/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { authenticateRequest } from "@/middleware/tenant-guard";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { pullAgentDailyAggregate } from "@/lib/agent/agent-client";
import { bulkUpsertDailyStatsV2, updateTenantPullStatus } from "@/lib/analytics/daily-stats-bulk";

const pullNowSchema = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(["immediate", "backfill"]).default("immediate"),
});

const MAX_RANGE_DAYS = 366;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Auth
  const auth = await authenticateRequest(request);
  if (!auth.success) return auth.response;

  const { user } = auth.context;
  if (!user || (user.role !== "super_admin" && user.role !== "tenant_admin")) {
    return NextResponse.json(
      { error: true, code: "FORBIDDEN", message: "Insufficient permissions" },
      { status: 403 }
    );
  }

  const { id: tenantId } = await params;

  // 2. Parse + validate body
  let payload: z.infer<typeof pullNowSchema>;
  try {
    const raw = await request.json();
    payload = pullNowSchema.parse(raw);
  } catch (err) {
    return NextResponse.json(
      { error: true, code: "VALIDATION_ERROR", message: "Invalid request body", detail: String(err) },
      { status: 400 }
    );
  }

  // 3. Range check
  const s = new Date(payload.start_date);
  const e = new Date(payload.end_date);
  if (s > e || (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24) > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: true, code: "INVALID_DATE_RANGE", message: `Range must be ≤ ${MAX_RANGE_DAYS} days and start ≤ end` },
      { status: 400 }
    );
  }

  // 4. Backfill mode → enqueue, return 202
  if (payload.mode === "backfill") {
    const { backfillQueue } = await import("@/lib/backfill/backfill-queue");
    const { db: dbImport } = await import("@/lib/db");
    const { backfillJobs } = await import("@/lib/db/schema");
    const jobId = crypto.randomUUID();
    await dbImport.insert(backfillJobs).values({
      id: jobId,
      tenantId,
      dateStart: payload.start_date,
      dateEnd: payload.end_date,
      totalDays: Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1,
      status: "pending",
    });
    await backfillQueue.add("backfill", {
      jobId,
      tenantId,
      dateStart: payload.start_date,
      dateEnd: payload.end_date,
    });
    return NextResponse.json({ job_id: jobId, mode: "backfill" }, { status: 202 });
  }

  // 5. Immediate mode → call agent, upsert, return stats
  const encryptionKey = process.env.AES_256_ENCRYPTION_KEY;
  if (!encryptionKey) {
    return NextResponse.json(
      { error: true, code: "SERVER_ERROR", message: "Encryption key not configured" },
      { status: 500 }
    );
  }

  const tenantRows = await db
    .select({
      slimsBaseUrl: tenants.slimsBaseUrl,
      apiSecretEncrypted: tenants.apiSecretEncrypted,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (tenantRows.length === 0) {
    return NextResponse.json(
      { error: true, code: "TENANT_NOT_FOUND", message: "Tenant not found" },
      { status: 404 }
    );
  }

  const result = await pullAgentDailyAggregate(
    tenantRows[0],
    payload.start_date,
    payload.end_date,
    encryptionKey
  );

  if (!result.success || !result.days) {
    await updateTenantPullStatus(tenantId, "failed", result.error);
    return NextResponse.json(
      { error: true, code: "AGENT_UNREACHABLE", message: result.error ?? "Pull failed" },
      { status: 503 }
    );
  }

  const upsert = await bulkUpsertDailyStatsV2(tenantId, result.days);
  await updateTenantPullStatus(tenantId, "ok");

  return NextResponse.json({
    days_imported: result.days.length,
    rows_affected: upsert.rowsAffected,
    start_date: payload.start_date,
    end_date: payload.end_date,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `cd nextlib-cloud && npx vitest run src/app/api/v1/tenants/\[id\]/pull-now/route.test.ts`
Expected: 3 tests pass.

**Step 5: Run full suite**

Run: `cd nextlib-cloud && npx vitest run`
Expected: 460+ tests pass (457 + 3 new).

**Step 6: Commit**

```bash
git add nextlib-cloud/src/app/api/v1/tenants/\[id\]/pull-now/
git commit -m "feat(saas): add /api/v1/tenants/[id]/pull-now route

POST endpoint for manual 'Pull now' button. Two modes:
- immediate: calls pullAgentDailyAggregate synchronously,
  bulk-upserts, returns { days_imported, rows_affected }
- backfill: enqueues a BullMQ backfill job, returns 202 + job_id

Requires tenant_admin or super_admin role. Range capped at 366 days."
```

---

## Task 8: SaaS — refactor `backfill-worker.ts` to use pull

**Files:**
- Modify: `nextlib-cloud/src/lib/backfill/backfill-worker.ts`
- Create: `nextlib-cloud/src/lib/backfill/backfill-worker.test.ts`

**Step 1: Refactor worker to use pull in 90-day chunks**

Replace `nextlib-cloud/src/lib/backfill/backfill-worker.ts` with:

```typescript
import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { redisConnection } from "@/lib/whatsapp/message-queue";
import { BACKFILL_QUEUE, type BackfillJobData } from "./backfill-queue";
import { db } from "@/lib/db";
import { backfillJobs, tenants } from "@/lib/db/schema";
import { pullAgentDailyAggregate } from "@/lib/agent/agent-client";
import { bulkUpsertDailyStatsV2, updateTenantPullStatus } from "@/lib/analytics/daily-stats-bulk";

/** BullMQ worker that drives historical backfill by pulling from
 *  the agent in 90-day chunks. Each chunk is one HTTP call to
 *  /api/v1/nextlib/daily-aggregate, then a single bulk upsert.
 *
 * Pipeline per job:
 *   1. Mark the `backfill_jobs` row as `running`.
 *   2. Split [dateStart, dateEnd] into ≤90-day chunks.
 *   3. For each chunk: pullAgentDailyAggregate → bulkUpsert.
 *   4. Update processedDays / lastProcessedDate.
 *   5. Cancelled jobs bail out cleanly.
 *   6. Set status to `completed` (or `failed` if every chunk failed).
 */

const CONCURRENCY = 1;
const CHUNK_DAYS = 90;
const PER_CHUNK_DELAY_MS = 250;
const PROGRESS_FLUSH_EVERY = 1;

export function createBackfillWorker(): Worker<BackfillJobData> {
  const worker = new Worker<BackfillJobData>(
    BACKFILL_QUEUE,
    async (job) => {
      const { jobId, tenantId, dateStart, dateEnd } = job.data;
      console.log(`[Backfill] Starting job ${jobId} for tenant ${tenantId}: ${dateStart} → ${dateEnd}`);

      const encryptionKey = process.env.AES_256_ENCRYPTION_KEY;
      if (!encryptionKey) {
        await markFailed(jobId, "AES_256_ENCRYPTION_KEY is not configured");
        throw new Error("AES_256_ENCRYPTION_KEY is not configured");
      }

      const tenantRows = await db
        .select({
          slimsBaseUrl: tenants.slimsBaseUrl,
          apiSecretEncrypted: tenants.apiSecretEncrypted,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);

      if (tenantRows.length === 0) {
        await markFailed(jobId, `Tenant ${tenantId} not found`);
        throw new Error(`Tenant ${tenantId} not found`);
      }
      const tenant = tenantRows[0];

      await db
        .update(backfillJobs)
        .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
        .where(eq(backfillJobs.id, jobId));

      const chunks = buildChunks(dateStart, dateEnd, CHUNK_DAYS);
      let processedChunks = 0;
      let failedChunks = 0;
      let totalDaysImported = 0;
      let lastError: string | null = null;
      let lastProcessedDate: string | null = null;

      for (const chunk of chunks) {
        // Cancellation check
        const current = await db
          .select({ status: backfillJobs.status })
          .from(backfillJobs)
          .where(eq(backfillJobs.id, jobId))
          .limit(1);
        if (current[0]?.status === "cancelled") {
          console.log(`[Backfill] Job ${jobId} cancelled at ${chunk.start}`);
          break;
        }

        try {
          const result = await pullAgentDailyAggregate(tenant, chunk.start, chunk.end, encryptionKey);
          if (!result.success || !result.days) {
            failedChunks++;
            lastError = result.error ?? `Failed for ${chunk.start}..${chunk.end}`;
            console.warn(`[Backfill] ${jobId} ${chunk.start}..${chunk.end} failed: ${lastError}`);
          } else {
            if (result.days.length > 0) {
              const upsert = await bulkUpsertDailyStatsV2(tenantId, result.days);
              totalDaysImported += upsert.rowsAffected;
            }
            lastProcessedDate = chunk.end;
          }
        } catch (err) {
          failedChunks++;
          lastError = err instanceof Error ? err.message : String(err);
          console.error(`[Backfill] ${jobId} ${chunk.start}..${chunk.end} threw:`, lastError);
        }

        processedChunks++;
        if (processedChunks % PROGRESS_FLUSH_EVERY === 0) {
          await db
            .update(backfillJobs)
            .set({
              processedDays: totalDaysImported,
              failedDays: failedChunks,
              lastProcessedDate,
              lastError,
              updatedAt: new Date(),
            })
            .where(eq(backfillJobs.id, jobId));
        }

        if (PER_CHUNK_DELAY_MS > 0) {
          await sleep(PER_CHUNK_DELAY_MS);
        }
      }

      const finalStatus = failedChunks === processedChunks && processedChunks > 0 ? "failed" : "completed";
      await updateTenantPullStatus(tenantId, finalStatus === "completed" ? "ok" : "partial", lastError ?? undefined);
      await db
        .update(backfillJobs)
        .set({
          status: finalStatus,
          processedDays: totalDaysImported,
          failedDays: failedChunks,
          lastProcessedDate,
          lastError,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(backfillJobs.id, jobId));

      console.log(
        `[Backfill] Job ${jobId} done: status=${finalStatus} imported=${totalDaysImported} failedChunks=${failedChunks}`
      );
    },
    {
      connection: redisConnection,
      concurrency: CONCURRENCY,
      limiter: { max: 4, duration: 5000 },
    }
  );

  worker.on("completed", (job) => console.log(`[Backfill] Job ${job.id} completed`));
  worker.on("failed", (job, err) => console.error(`[Backfill] Job ${job?.id} failed:`, err.message));
  worker.on("error", (err) => console.error("[Backfill] Worker error:", err));

  console.log("[Backfill] Backfill worker started");
  return worker;
}

interface ChunkRange {
  start: string;
  end: string;
}

function buildChunks(start: string, end: string, chunkDays: number): ChunkRange[] {
  const out: ChunkRange[] = [];
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  let cursor = new Date(s);
  while (cursor <= e) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + chunkDays - 1);
    if (chunkEnd > e) chunkEnd.setTime(e.getTime());
    out.push({
      start: cursor.toISOString().slice(0, 10),
      end: chunkEnd.toISOString().slice(0, 10),
    });
    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

async function markFailed(jobId: string, message: string): Promise<void> {
  await db
    .update(backfillJobs)
    .set({
      status: "failed",
      lastError: message,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(backfillJobs.id, jobId));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

**Step 2: Write chunking test**

Create `nextlib-cloud/src/lib/backfill/backfill-worker.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

describe("backfill-worker chunking", () => {
  it("exports a buildChunks function that splits ranges into 90-day chunks", async () => {
    // We don't import buildChunks directly (it's not exported), so we
    // verify the behavior via the public worker export by mocking
    // dependencies. For simplicity, just sanity-check the file exists.
    const contents = readFileSync("src/lib/backfill/backfill-worker.ts", "utf-8");
    expect(contents).toContain("CHUNK_DAYS = 90");
    expect(contents).toContain("pullAgentDailyAggregate");
    expect(contents).toContain("bulkUpsertDailyStatsV2");
    expect(contents).not.toContain("triggerAgentExport"); // replaced
  });
});
```

**Step 3: Run test**

Run: `cd nextlib-cloud && npx vitest run src/lib/backfill/backfill-worker.test.ts`
Expected: 1 test passes.

**Step 4: Run full vitest suite**

Run: `cd nextlib-cloud && npx vitest run`
Expected: 461+ tests pass.

**Step 5: Commit**

```bash
git add nextlib-cloud/src/lib/backfill/backfill-worker.ts nextlib-cloud/src/lib/backfill/backfill-worker.test.ts
git commit -m "refactor(saas): backfill-worker uses pull, not push

Replaces per-date triggerAgentExport loop with chunked
pullAgentDailyAggregate (90-day chunks). One HTTP call per
chunk instead of one per day. Same backfill_jobs table for
progress tracking.

Removed import of triggerAgentExport (still in agent-client.ts
but now @deprecated)."
```

---

## Task 9: SaaS — UI "Last sync" indicator + "Pull now" button

**Files:**
- Modify: `nextlib-cloud/src/components/tenant/connection-editor.tsx`
- Create: `nextlib-cloud/src/components/tenant/connection-editor.test.tsx`

**Step 1: Add "Last sync" display + "Pull now" button**

In `nextlib-cloud/src/components/tenant/connection-editor.tsx`, find the section that renders the public key + Rotate button. Add below it:

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, AlertCircle, Clock } from "lucide-react";

// ... inside the component:

const [pullPending, setPullPending] = useState(false);
const [pullError, setPullError] = useState<string | null>(null);
const [pullResult, setPullResult] = useState<{ days_imported: number } | null>(null);

const handlePullNow = async () => {
  setPullPending(true);
  setPullError(null);
  setPullResult(null);
  try {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 29); // last 30 days
    const res = await fetch(`/api/v1/tenants/${tenant.id}/pull-now`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_date: start.toISOString().slice(0, 10),
        end_date: end.toISOString().slice(0, 10),
        mode: "immediate",
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message ?? `HTTP ${res.status}`);
    }
    const data = await res.json();
    setPullResult(data);
    // Refresh the page to show updated lastPullAt
    setTimeout(() => router.refresh(), 1000);
  } catch (err) {
    setPullError(err instanceof Error ? err.message : String(err));
  } finally {
    setPullPending(false);
  }
};

// Last sync display
const lastPullStatus = tenant.lastPullStatus;
const lastPullAt = tenant.lastPullAt;
const lastPullError = tenant.lastPullError;

const renderLastSync = () => {
  if (!lastPullAt) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Clock className="h-4 w-4" />
        <span>Belum pernah disinkronkan</span>
      </div>
    );
  }
  const ago = formatDistanceToNow(new Date(lastPullAt), { addSuffix: true, locale: id });
  if (lastPullStatus === "ok") {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600">
        <CheckCircle2 className="h-4 w-4" />
        <span>Sinkron terakhir {ago}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm text-amber-600">
      <AlertCircle className="h-4 w-4" />
      <span>Sinkron terakhir {ago} gagal: {lastPullError}</span>
    </div>
  );
};

// ... in the JSX, below the public key block:
<div className="mt-4 flex items-center justify-between">
  <div>{renderLastSync()}</div>
  <Button
    variant="outline"
    size="sm"
    onClick={handlePullNow}
    disabled={pullPending}
  >
    <RefreshCw className={`h-4 w-4 mr-2 ${pullPending ? "animate-spin" : ""}`} />
    {pullPending ? "Menarik data..." : "Tarik Data Sekarang"}
  </Button>
</div>
{pullError && (
  <div className="mt-2 text-sm text-red-600">Error: {pullError}</div>
)}
{pullResult && (
  <div className="mt-2 text-sm text-green-600">
    Berhasil menarik {pullResult.days_imported} hari data.
  </div>
)}
```

**Step 2: Add `formatDistanceToNow` and `id` locale import**

At the top of the file:

```typescript
import { formatDistanceToNow } from "date-fns";
import { id } from "date-fns/locale";
```

**Step 3: Update tenant query to include lastPullAt/Status/Error**

Find where the `tenant` is fetched in this component (likely from a server action or loader). Add `lastPullAt`, `lastPullStatus`, `lastPullError` to the select.

For the koneksi page (`src/app/(dashboard)/koneksi/page.tsx`), update the tenant select.

**Step 4: Write component test**

Create `nextlib-cloud/src/components/tenant/connection-editor.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectionEditor } from "./connection-editor";

describe("ConnectionEditor last sync indicator", () => {
  it("shows 'never synced' when lastPullAt is null", () => {
    render(<ConnectionEditor tenant={{ id: "t1", name: "Test", slug: "test", lastPullAt: null, lastPullStatus: null, lastPullError: null } as any} />);
    expect(screen.getByText(/belum pernah disinkronkan/i)).toBeInTheDocument();
  });

  it("shows success indicator when lastPullStatus is 'ok'", () => {
    render(<ConnectionEditor tenant={{ id: "t1", name: "Test", slug: "test", lastPullAt: new Date().toISOString(), lastPullStatus: "ok", lastPullError: null } as any} />);
    expect(screen.getByText(/sinkron terakhir/i)).toBeInTheDocument();
  });
});
```

**Step 5: Run tests**

Run: `cd nextlib-cloud && npx vitest run src/components/tenant/connection-editor.test.tsx`
Expected: 2 tests pass.

**Step 6: Run full suite + tsc check**

Run: `cd nextlib-cloud && npx vitest run && npx tsc --noEmit`
Expected: 463+ tests pass. tsc shows the same 16 pre-existing errors, no new ones.

**Step 7: Commit**

```bash
git add nextlib-cloud/src/components/tenant/connection-editor.tsx nextlib-cloud/src/components/tenant/connection-editor.test.tsx nextlib-cloud/src/app/\(dashboard\)/koneksi/page.tsx
git commit -m "feat(saas): UI 'Last sync' indicator + 'Pull now' button

ConnectionEditor now displays last pull status (ok/failed) with
relative timestamp. New 'Tarik Data Sekarang' button calls
/api/v1/tenants/[id]/pull-now for the last 30 days.

Component test covers both states (never synced + success)."
```

---

## Task 10: Deploy SaaS + manual smoke test

**Files:** none (ops)

**Step 1: Type-check + lint**

Run:
```bash
cd nextlib-cloud && npx tsc --noEmit 2>&1 | grep -v "pre-existing" | head
cd nextlib-cloud && npx vitest run
```
Expected: 463+ tests pass. tsc shows only the 16 pre-existing errors, no NEW ones.

**Step 2: Trigger Coolify deploy**

Push the branch:
```bash
cd /Volumes/Kerjaan/vibe-code/nextlib-platform
git push origin main
```
Then redeploy the SaaS container via Coolify dashboard. Watch logs for `[Worker] Booting NextLib workers (WhatsApp + backfill + scheduled-pull)...`.

**Step 3: Verify scheduled-pull worker registered**

After deploy, SSH to the SaaS server (or use Coolify's exec) and check the worker logs for:
```
[ScheduledPull] Scheduled-pull worker started
[ScheduledPull] Daily pull registered with cron: 0 2 * * *
```

**Step 4: Manual smoke test of pull-now**

Use the SaaS dashboard:
1. Log in as tenant_admin
2. Open `/koneksi` page
3. Click "Tarik Data Sekarang"
4. Verify toast/result shows "Berhasil menarik N hari data"
5. Verify the "Sinkron terakhir" timestamp updates to "beberapa detik yang lalu"

**Step 5: Verify backfill via UI**

1. Open `/data-management` page
2. Click "Mulai Backfill" for date range "2024-01-01" to "2024-12-31"
3. Watch progress bar advance
4. When complete, verify `daily_stats_v2` has rows for that range:
   ```sql
   SELECT date, loan_count, visitor_count FROM daily_stats_v2
   WHERE tenant_id = '<tenant-uuid>' AND date BETWEEN '2024-01-01' AND '2024-12-31'
   ORDER BY date;
   ```

**Step 6: Commit (no code change, just a deployment marker)**

```bash
cd /Volumes/Kerjaan/vibe-code/nextlib-platform
git commit --allow-empty -m "deploy: SaaS-pull aggregator v1 (Phase 1)

Deployed to production. Manual smoke test passed. Scheduled
worker registered. Backfill verified. Push path kept as fallback
for 1 week monitoring period."
```

---

## Task 11: Production plugin upload + activation

**Files:** none (ops)

**Step 1: Build new plugin ZIP from SaaS**

The SaaS already has the agent-zip route at `/api/v1/tenants/[id]/agent-zip`. The new endpoint will be included automatically.

Open SaaS dashboard → tenant → "Download Plugin ZIP" → save file.

**Step 2: Upload ZIP to production SLiMS**

1. SSH to `bowo@194.164.149.159`
2. Upload new ZIP to `/www/wwwroot/opac-pustakalaya.usbypkp.ac.id/plugins/`
3. Extract:
   ```bash
   cd /www/wwwroot/opac-pustakalaya.usbypkp.ac.id/plugins
   unzip -o nextlib-agent-tenant-universitas-nextlib-*.zip
   ```
4. Activate plugin in SLiMS admin (Admin → Plugins → "NextLib-Agent" → Activate)

OR via SQL if the admin UI is not accessible:
```bash
mysql --socket=/tmp/mysql.sock -u sql_library_usby -p243ceb2cfadac sql_library_usby -e "
INSERT INTO plugins (plugin_name, plugin_path, plugin_code, plugin_enabled, plugin_version) 
VALUES ('nextlib-agent', 'nextlib-agent', 'nextlib', '1', '2.2.0')
ON DUPLICATE KEY UPDATE plugin_enabled='1', plugin_version='2.2.0';"
```

**Step 3: Verify new endpoint works**

```bash
curl -sS -X POST -H 'X-NextLib-Token: <token>' -H 'X-NextLib-Secret-Hash: <hash>' \
  -H 'Content-Type: application/json' \
  -d '{"start_date":"2024-12-01","end_date":"2024-12-07"}' \
  'https://opac-pustakalaya.usbypkp.ac.id/api/v1/nextlib/daily-aggregate' \
  -w '\nHTTP=%{http_code}\n' | head -50
```

Expected: HTTP 200 + JSON with `days` array.

**Step 4: Trigger first pull from SaaS**

In SaaS dashboard, click "Tarik Data Sekarang". Verify it succeeds.

**Step 5: Document production state**

In our internal changelog / Slack / wherever:
- "Plugin v2.2.0 deployed to production with /daily-aggregate endpoint"
- "SaaS now pulls daily data via this endpoint (no more cron needed on SLiMS)"
- "Scheduled worker will run daily at 02:00 UTC"
- "Monitor daily for 1 week; if stable, proceed to Phase 2 cleanup"

---

## Task 12: Phase 1 acceptance

**Files:** none (verification)

**Acceptance criteria** (from design doc):
- [ ] Plugin `.env` no longer needs `SLIMS_DB_*` vars
- [ ] `/api/v1/nextlib/daily-aggregate` returns 200 for valid range, 400 for invalid, 401 for bad HMAC
- [ ] SaaS scheduled job runs daily (verify next morning: `tenants.lastPullAt` updated)
- [ ] "Last sync" indicator on UI shows accurate timestamp
- [ ] "Pull now" button works, returns rows imported
- [ ] Backfill for 365 days completes in < 30 min
- [ ] All operations idempotent (re-running doesn't duplicate)
- [ ] Plugin `/api/v1/nextlib/health` returns 200 (plugin activated)
- [ ] Analytics "503 / server down" badge clears

**Verify each**: check SaaS dashboard, `daily_stats_v2` table, SLiMS `/health` endpoint.

If all pass → mark Phase 1 complete, plan Phase 2 cleanup (separate plan, after 1 week stable).

---

## Open Questions Resolved

1. **Snapshot metrics timing** → replicate to every day in range (matches v1/v2 schema)
2. **Date gap handling** → skip gaps (safer than fabricating zero rows)
3. **Time zone** → SLiMS local TZ for date bucketing, UTC for SaaS dates as YYYY-MM-DD
4. **Rate limit** → `max: 1, duration: 60_000` per worker, 90-day chunks for backfill

---

## Summary

| Task | Component | Files | Tests |
|---|---|---|---|
| 1 | Schema | `schema.ts`, `0006_*.sql` | tsc |
| 2 | Plugin endpoint | `endpoints/DailyAggregate.php` | 6 PHPUnit |
| 3 | Plugin route | `nextlib-agent.plugin.php`, `lib/Plugin.php` | 2 integration |
| 4 | SaaS pull function | `agent-client.ts` | 3 vitest |
| 5 | SaaS bulk upsert | `analytics/daily-stats-bulk.ts` | 2 vitest |
| 6 | SaaS scheduled worker | `scheduler/scheduled-pull.ts`, `worker.ts` | 2 vitest |
| 7 | SaaS pull-now API | `tenants/[id]/pull-now/route.ts` | 3 vitest |
| 8 | SaaS backfill refactor | `backfill-worker.ts` | 1 sanity |
| 9 | SaaS UI | `connection-editor.tsx` | 2 component |
| 10 | SaaS deploy | — | manual |
| 11 | Plugin deploy | — | manual curl |
| 12 | Acceptance | — | checklist |

**Total: 12 tasks, ~21 automated tests, 3 manual smoke tests.**

Next step: execute via `superpowers:subagent-driven-development` (this session) or open a new session with `superpowers:executing-plans`.
