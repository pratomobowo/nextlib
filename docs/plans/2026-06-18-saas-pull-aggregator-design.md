# Design: SaaS-Pull Aggregator

> **Status:** Approved
> **Date:** 2026-06-18
> **Branch:** `feat/saas-pull-aggregator`
> **Author:** Pratomobowo + Claude

## Problem

Currently the SLiMS plugin uses a **push-based** architecture for syncing data to the SaaS:
- `cron.php` runs daily at 23:00 via system cron
- It opens its **own PDO connection** to the SLiMS database (requires `SLIMS_DB_*` env vars in `.env`)
- It reads aggregated data via `exporter/EnhancedExporter.php`
- It POSTs the data to SaaS's `/api/v2/aggregate` (HMAC-signed)

**Problems with this:**
1. Plugin needs SLiMS DB credentials in `.env` — **duplicates** the credentials that SLiMS already has in its `config/database.php`
2. If `.env` is misconfigured (e.g., missing `SLIMS_DB_*`), cron silently fails with `Access denied for user 'root'@'localhost'`
3. Two code paths for the same data: plugin's `exporter/` computes aggregates, then SaaS's `/api/v2/aggregate` ingests them
4. Push from plugin → SaaS requires plugin's `HttpClient.php` outbound network
5. SaaS marks plugin as "down" in analytics if the plugin's `/api/v1/nextlib/health` endpoint fails — but the plugin already has this endpoint, so why is it down? Because the **plugin isn't activated in SLiMS admin** (the production install never registered it in the `plugins` table)
6. Disk usage 89% on SLiMS server from accumulated queue files

## Solution: SaaS pulls, plugin reads its own DB

**Invert the flow.** SaaS becomes the active side; the plugin becomes a read-only adapter:

- SaaS scheduled job (BullMQ, daily 02:00 UTC) calls plugin's new `/api/v1/nextlib/daily-aggregate` endpoint
- Plugin uses SLiMS's **own** `$dbs` global (no plugin-side DB credentials)
- Plugin returns daily aggregates in the same shape that v1/v2 schema already expects
- SaaS bulk-inserts into `daily_stats_v2` (idempotent on `(tenant_id, date)`)
- Manual "Pull now" button enqueues the same backfill job
- Historical backfill reuses the same path, chunked into 90-day batches

**Benefits:**
1. **No DB credentials in plugin `.env`** — only `NEXTLIB_TENANT_ID`, `NEXTLIB_TOKEN_SECRET`, `NEXTLIB_PUBLIC_KEY`, `NEXTLIB_CLOUD_URL`
2. **Single code path** — same endpoint for daily pull, manual pull, historical backfill
3. **No cron on SLiMS server** — SaaS orchestrates everything
4. **Idempotent** — `INSERT ... ON CONFLICT (tenant_id, date) DO UPDATE`, safe to re-run
5. **Cleaner plugin** — `exporter/`, `cron.php`, `lib/HttpClient.php`, `lib/HmacSigner.php` (push side) all go away in Phase 2

## Architecture (data flow)

```
┌─────────────────────┐                    ┌──────────────────────┐
│  SaaS (Next.js)     │                    │  Plugin (SLiMS PHP)  │
│                     │                    │                      │
│  ┌───────────────┐  │   HMAC POST        │  ┌────────────────┐  │
│  │ BullMQ worker │──┼───────────────────►│  │ /daily-        │  │
│  │ (src/worker)  │  │  X-NextLib-Token   │  │  aggregate     │  │
│  │               │  │  X-NextLib-        │  │                │  │
│  │ Scheduled:    │  │   Secret-Hash      │  │  global $dbs   │  │
│  │  daily 02:00  │  │                    │  │  (SLiMS conn)  │  │
│  │  last 7 days  │  │                    │  │                │  │
│  └───────────────┘  │                    │  │  No creds in   │  │
│         │            │                    │  │  .env!         │  │
│         │            │                    │  └────────────────┘  │
│  ┌───────────────┐  │                    │                      │
│  │ backfill-     │  │                    │  ┌────────────────┐  │
│  │ worker        │  │   HMAC POST        │  │ existing       │  │
│  │ (manual)      │──┼───────────────────►│  │ endpoints      │  │
│  │               │  │                    │  │ top-books,     │  │
│  │ /api/v1/      │  │                    │  │ dead-stock,    │  │
│  │ backfill/     │  │                    │  │ member-        │  │
│  │ start         │  │                    │  │ activity,      │  │
│  └───────────────┘  │                    │  │ collection-    │  │
│         │            │                    │  │ stats          │  │
│         ▼            │                    │  └────────────────┘  │
│  ┌───────────────┐  │                    └──────────────────────┘
│  │ daily_stats   │  │
│  │   _v2         │  │  ◄── HMAC GET, sign with Ed25519
│  │ (idempotent)  │  │      /api/v1/nextlib/health (existing)
│  └───────────────┘  │
│                     │
│  UI:                │
│  • "Last sync" jam  │
│  • "Pull now" btn   │
│  • "Backfill" modal │
└─────────────────────┘
```

## New plugin endpoint: `POST /v1/nextlib/daily-aggregate`

**Auth:** HMAC v1 (matches existing endpoints — `X-NextLib-Token` + `X-NextLib-Secret-Hash`). Ed25519 migration is Phase 3.

**Request body** (JSON):
```json
{ "start_date": "2024-01-01", "end_date": "2024-12-31" }
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `start_date` | string | yes | `YYYY-MM-DD`, must be ≤ `end_date` |
| `end_date` | string | yes | `YYYY-MM-DD`, must be ≥ `start_date` |
| | | | Range ≤ 366 days (returns 400 otherwise) |

**Response** (JSON, 200 OK):
```json
{
  "schema_version": "2.0",
  "tenant_id": "eb47cdd6-4b3d-41d0-a4ae-fbaf802b567b",
  "start_date": "2024-01-01",
  "end_date": "2024-01-07",
  "days": [
    {
      "date": "2024-01-01",
      "daily_metrics": {
        "visitor_count": 45,
        "unique_visitor_count": 32,
        "loan_count": 8,
        "return_count": 5,
        "new_member_count": 1,
        "new_biblio_count": 0,
        "new_item_count": 2,
        "fines_debet_total": 0,
        "fines_credit_total": 0,
        "reservation_count": 0
      },
      "snapshot_metrics": {
        "total_collection_size": 12500,
        "active_member_count": 350,
        "active_overdue_count": 12
      },
      "anomaly_flags": []
    },
    ...
  ]
}
```

**Error responses:**

| HTTP | `code` | Cause |
|---|---|---|
| 400 | `INVALID_DATE_RANGE` | Range > 366 days, malformed dates, or `start > end` |
| 401 | `INVALID_SIGNATURE` | HMAC verification failed |
| 503 | `DB_UNAVAILABLE` | SLiMS `$dbs` is null (SLiMS DB connection lost) |
| 500 | `INTERNAL_ERROR` | SQL error during aggregation |

**SQL strategy** (in `endpoints/DailyAggregate.php`):
- For each metric, generate a single query that aggregates per date in the range
- Use `DATE(loan_date)` as the bucket key
- `LEFT JOIN` against a generated date series to fill gaps with zeros
- Snapshot metrics (`total_collection_size`, `active_member_count`, `active_overdue_count`) computed once and replicated to each day in the range (or computed as-of-end_date — TBD during implementation)
- `anomaly_flags` always empty array — SaaS computes via `computeAnomalyFlags()` like the v2 ingest already does

## Components to add/change

### Plugin (PHP)

| File | Action | Notes |
|---|---|---|
| `endpoints/DailyAggregate.php` | **NEW** | Range-based aggregator. Uses `global $dbs`. Returns shape above. |
| `lib/Plugin.php` | **MODIFY** | Add `handleDailyAggregate($params, $body)` method that calls `DailyAggregate::handle($params)`. Inject `$dbs` from SLiMS global. |
| `nextlib-agent.plugin.php` | **MODIFY** | Register route: `$router->map('POST', '/v1/nextlib/daily-aggregate', 'NextLibAgent\\Plugin@handleDailyAggregate')` |
| `tests/endpoints/DailyAggregateTest.php` | **NEW** | 6-8 cases: empty range, single day, 7-day, 90-day, range > 366 (400), missing data (gaps), invalid dates (400), DB unavailable (503) |
| `INSTALL.md` | **MODIFY** | Add new endpoint to API reference |
| `docs/ops/security.md` (SaaS) | **MODIFY** | Document pull-based architecture; mark push as deprecated |
| `cron.php` | **KEEP** (deprecated) | Add comment `// DEPRECATED: use SaaS pull via /api/v1/nextlib/daily-aggregate` |
| `exporter/` | **KEEP** (deprecated) | Add `@deprecated` PHPDoc on each class |

### SaaS (TypeScript)

| File | Action | Notes |
|---|---|---|
| `src/lib/agent/agent-client.ts` | **MODIFY** | Add `pullAgentDailyAggregate<T>(tenant, startDate, endDate): Promise<DailyAggregateResponse>`. Reuses `queryAgent` internals. Mark `triggerAgentExport` `@deprecated` JSDoc, do not remove yet. |
| `src/lib/backfill/backfill-worker.ts` | **MODIFY** | Replace per-date `triggerAgentExport` loop with chunked `pullAgentDailyAggregate` calls (90-day batches). Bulk insert into `daily_stats_v2` via `INSERT ... ON CONFLICT (tenant_id, date) DO UPDATE`. Use `computeAnomalyFlags` to backfill anomaly flags cloud-side. |
| `src/lib/db/schema.ts` | **MODIFY** | Add to `tenants` table: `lastPullAt` (timestamptz, nullable), `lastPullStatus` (varchar(20), nullable: 'ok'/'failed'/'partial'), `lastPullError` (text, nullable) |
| `drizzle/0006_*.sql` | **NEW** | Migration: `ALTER TABLE tenants ADD COLUMN last_pull_at TIMESTAMPTZ, ADD COLUMN last_pull_status VARCHAR(20), ADD COLUMN last_pull_error TEXT;` |
| `src/lib/scheduler/scheduled-pull.ts` | **NEW** | BullMQ repeatable job. Cron: `0 2 * * *` (daily 02:00 UTC, configurable via `SCHEDULED_PULL_CRON` env). For each tenant with `status='connected'`, call `pullAgentDailyAggregate(today-6, today)`. Update `tenants.lastPullAt`, `lastPullStatus`. Uses `SchedulerRegistry` pattern from BullMQ. |
| `src/worker.ts` | **MODIFY** | Register `scheduled-pull` worker alongside `backfill` and WhatsApp workers |
| `src/app/api/v1/tenants/[id]/pull-now/route.ts` | **NEW** | POST endpoint. Body: `{ start_date, end_date, mode: 'immediate' \| 'backfill' }`. If `immediate`: call `pullAgentDailyAggregate` directly, return 200 with `{ days_imported, rows_affected }`. If `backfill`: enqueue existing `BACKFILL_QUEUE` job. Requires `tenant_admin` or `super_admin` role. |
| `src/components/tenant/connection-editor.tsx` | **MODIFY** | Show "Last sync: 2h ago (ok)" or "Last sync: failed — <error>". Add "Pull now" button that opens a date range modal. Wire to `/api/v1/tenants/[id]/pull-now`. |
| `src/app/api/v1/tenants/[id]/test-connection/route.ts` | **MODIFY** | On successful connection, reset `lastPullStatus` to null (fresh start) |
| `src/app/(dashboard)/data-management/page.tsx` | **MODIFY** | Show "Last sync per tenant" column with the new `lastPullAt` value |

## Three execution scenarios

### Scenario A — Daily scheduled pull (automatic)
- BullMQ `repeat: { pattern: "0 2 * * *", tz: "UTC" }` (configurable via `SCHEDULED_PULL_CRON`)
- For each tenant with `status='connected'`:
  1. `pullAgentDailyAggregate(tenant, today-6, today)` → array of 7 days
  2. Bulk upsert into `daily_stats_v2` on `(tenant_id, date)` conflict
  3. `UPDATE tenants SET last_pull_at = NOW(), last_pull_status = 'ok' WHERE id = ?`
  4. If error: `last_pull_status = 'failed'`, `last_pull_error = <message>` (truncated to 500 chars)
- Idempotent — safe to re-run

### Scenario B — Manual "Pull now" (UI button)
- User clicks "Pull now" → modal asks for date range (default last 30 days, max 366)
- POST `/api/v1/tenants/[id]/pull-now` with `{ start_date, end_date, mode: 'immediate' }`
- SaaS calls `pullAgentDailyAggregate` synchronously, returns `{ days_imported, rows_affected }` in 200
- For ranges > 90 days, automatically switch to `mode: 'backfill'` (enqueue job, return 202)
- UI shows toast with result

### Scenario C — Historical backfill (existing UI)
- `/data-management` page already has "Mulai Backfill" button → `/api/v1/backfill/start`
- Refactored `backfill-worker` chunks range into 90-day batches
- Per batch: 1 call to `pullAgentDailyAggregate` → bulk insert
- Progress bar via existing `backfill_jobs` table (`processedDays`, `lastProcessedDate`)
- Resume: if job crashes mid-batch, the `(tenant_id, date)` unique constraint makes restart idempotent

## Error handling

| Scenario | Impact | Recovery |
|---|---|---|
| Plugin down (network timeout) | Scheduled job logs `last_pull_status='failed'`, `last_pull_error='timeout'` | Re-run tomorrow automatically. UI badge: "Last sync: failed 2h ago" |
| Plugin returns 401 (HMAC) | Scheduled job logs error, fires alert via existing notification system | Signal that tenant rotated secret in SaaS but plugin `.env` not updated → user re-downloads ZIP |
| Plugin returns 5xx (SLiMS DB issue) | Same as plugin down | Auto-recovery when SLiMS is back |
| Range > 366 days | Plugin returns 400 `INVALID_DATE_RANGE` | SaaS chunks into 90-day batches |
| Partial data (missing dates) | Plugin returns `days[]` with gaps (e.g., no loans on Sundays) | SaaS inserts what it gets, gaps are normal |
| `last_pull_at` < 24h ago + user clicks "Pull now" | UI shows confirmation: "Last sync was 3h ago. Pull again?" | UX safeguard against accidental duplicate work |
| Plugin returns 503 (DB unavailable) | Scheduled job retries once after 60s, then marks failed | Notify user via existing channels |

## Rollout (phased)

### Phase 1 (this refactor) — keep push as fallback
1. Plugin: add `endpoints/DailyAggregate.php` + tests
2. Plugin: register route in `nextlib-agent.plugin.php`
3. SaaS: add `pullAgentDailyAggregate()` to `agent-client.ts`
4. SaaS: add `scheduled-pull` worker
5. SaaS: add `/api/v1/tenants/[id]/pull-now` route
6. SaaS: add `lastPullAt/Status/Error` columns + migration `0006`
7. SaaS: add "Last sync" indicator + "Pull now" button to UI
8. SaaS: refactor `backfill-worker` to use `pullAgentDailyAggregate` (chunked)
9. Deploy SaaS (Coolify)
10. Upload new plugin ZIP (with `/daily-aggregate` endpoint) to production SLiMS
11. Activate plugin in SLiMS admin (insert into `plugins` table, `enabled=1`)
12. **Manually trigger** first pull to validate end-to-end
13. Monitor 1 week — verify scheduled pull runs daily, no errors, `daily_stats_v2` grows

### Phase 2 (cleanup, after 1 week of stable pull)
1. Plugin: delete `cron.php`, `exporter/`, `lib/HttpClient.php`, `lib/HmacSigner.php` (push side only)
2. Plugin: delete `composer.json` deps that are no longer needed (`vlucas/phpdotenv` if unused, `guzzlehttp/guzzle` if unused)
3. SaaS: delete `triggerAgentExport` from `agent-client.ts`
4. SaaS: delete `/api/v1/aggregate/route.ts` and `/api/v2/aggregate/route.ts`
5. SaaS: delete `lib/hmac.ts` (only used by push ingest; pull uses `queryAgent` internally)
6. Update `INSTALL.md` + `docs/ops/security.md` — "no push code, only pull"
7. Bump plugin version: 2.1.0 → 2.2.0 (MINOR — additive, then removal = next MAJOR 3.0.0)

### Phase 3 (post-cleanup)
- Migrate plugin endpoint auth from HMAC v1 to Ed25519 (the merge from 2026-06-17 already laid the groundwork via `TokenValidator::handle()`)
- Add `agent-command` endpoint for arbitrary agent control (e.g., force cache invalidation, run migration, etc.)

## Out of scope (deferred)

These are intentionally NOT in this refactor:
- **Anomaly detection** — already cloud-side via `computeAnomalyFlags()`, no change
- **Detail analytics endpoints** (top-books, dead-stock, etc.) — already on-demand via `queryAgent`, no change
- **HMAC → Ed25519 migration** — Phase 3
- **WebSocket push for real-time** — future
- **Multi-tenant concurrency** — existing BullMQ rate limit (`max: 4, duration: 5000`) is sufficient

## Open questions (to resolve during implementation)

1. **Snapshot metrics timing**: Should `total_collection_size`, `active_member_count`, `active_overdue_count` be replicated to every day in the range (current `daily_stats_v2` design), or only stored for `end_date`? **Answer: replicate to every day** (matches existing v1/v2 schema, simplifies chart queries).
2. **Date gap handling**: Should plugin return gaps (e.g., empty `days[]` entry with all zeros) or skip them? **Answer: skip them** (safer — SaaS won't write zero rows that could mask actual zero-data days).
3. **Time zone**: Plugin uses SLiMS's local timezone for date bucketing. SaaS uses UTC. **Answer: SaaS passes dates as YYYY-MM-DD strings, plugin interprets in SLiMS's local timezone. Document this.**
4. **Rate limit for scheduled pull**: If 100 tenants all run at 02:00, the SaaS could hammer agents. **Answer: BullMQ limiter `max: 4, duration: 5000` (same as backfill worker). Stagger by tenant_id hash if needed.**

## Test plan

### Plugin (PHP)
- `tests/endpoints/DailyAggregateTest.php` — 6-8 cases (see Components table)
- Integration test: full SLiMS DB seed → call endpoint → assert shape matches v2 schema

### SaaS (TypeScript)
- `src/lib/agent/agent-client.test.ts` — `pullAgentDailyAggregate()` mock tests
- `src/lib/backfill/backfill-worker.test.ts` — refactored worker chunking tests
- `src/lib/scheduler/scheduled-pull.test.ts` — scheduled job with mocked agent
- `src/app/api/v1/tenants/[id]/pull-now/route.test.ts` — POST route tests

### Manual
- Production SLiMS: install new plugin → verify `/daily-aggregate` returns 200 with sample data
- SaaS dashboard: click "Pull now" for today → see row inserted in `daily_stats_v2`
- SaaS dashboard: trigger backfill for last 365 days → see progress bar, end with `status='completed'`, `processed_days=365`
- Wait 1 day: scheduled job runs at 02:00 → verify `tenants.lastPullAt` updated, `daily_stats_v2` has today's row

## Success criteria

- [ ] Plugin `.env` no longer needs `SLIMS_DB_*` vars (cron deleted)
- [ ] `/api/v1/nextlib/daily-aggregate` returns 200 for valid range, 400 for invalid, 401 for bad HMAC
- [ ] SaaS scheduled job runs daily, populates `daily_stats_v2` for all active tenants
- [ ] "Last sync" indicator on UI shows accurate timestamp and status
- [ ] "Pull now" button works for any range, returns rows imported
- [ ] Backfill for 5 years completes in < 30 min
- [ ] `INSERT ... ON CONFLICT` makes all operations idempotent (re-running doesn't duplicate)
- [ ] Plugin health endpoint (`/api/v1/nextlib/health`) returns 200 (plugin activated in admin)
- [ ] Analytics "503 / server down" badge clears once plugin is activated

## References

- `nextlib-cloud/src/lib/agent/agent-client.ts` — existing `queryAgent` pattern to reuse
- `nextlib-cloud/src/lib/backfill/backfill-worker.ts` — existing backfill orchestration to refactor
- `nextlib-cloud/src/lib/db/schema.ts` — `daily_stats_v2` schema (the target shape)
- `nextlib-cloud/src/app/api/v2/aggregate/route.ts` — existing push ingest to delete in Phase 2
- `nextlib-agent/endpoints/CollectionStats.php` — pattern for read-only endpoints that use `global $dbs`
- `nextlib-agent/endpoints/TopBooks.php` — pattern for endpoints with date range filtering
- `docs/plans/2026-06-17-ed25519-auth-implementation.md` — prior security work, relevant for Phase 3
