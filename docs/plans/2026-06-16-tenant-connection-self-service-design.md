# Tenant Connection Self-Service

**Status:** Approved (pending implementation)
**Date:** 2026-06-16
**Author:** Pratomo Bowo Leksono
**Scope:** FR-B.1 (Multi-tenant), FR-A.2 (Agent auth)

---

## 1. Problem

Currently, the `/koneksi` page in `nextlib-cloud` only displays connection status — `tenant_admin` users (campus IT teams) cannot:

1. Configure their campus's SLiMS base URL
2. Update their institution's name
3. Change the connection status (`pending` / `connected` / `disconnected`)
4. Regenerate their API token (the secret the SLiMS plugin uses for HMAC auth)
5. Test connectivity to their SLiMS server

Only `super_admin` (SaaS operator) can create tenants via `POST /api/v1/tenants`, and the only PATCH support is a hard-coded `status` field with no encryption re-handling. There is no audit trail for tenant configuration changes, and no way to rotate the agent's API secret after initial creation.

Additionally, `/koneksi` page (line 11 of `koneksi/page.tsx`) currently does `SELECT * FROM tenants` and shows ALL tenants to every authenticated user — a privacy issue: a `tenant_admin` at Universitas A can see the connection status of Universitas B.

## 2. Goals

1. **Self-service for campus IT** — `tenant_admin` can fully manage their own tenant's connection (URL, name, status) without SaaS operator intervention.
2. **Secure secret rotation** — API token can be regenerated with audit trail; old token immediately invalid; one-time view of new token.
3. **Connectivity validation** — `tenant_admin` can verify their SLiMS server is reachable from NextLib.
4. **Privacy** — `tenant_admin` only sees their own tenant in the dashboard; `super_admin` retains cross-tenant visibility.
5. **Auditability** — every configuration change is logged with actor, before/after values (masked for secrets), IP, user agent.

## 3. Non-Goals (out of scope)

- `super_admin` inline-edit per tenant (current scope is `tenant_admin` flow only).
- Audit log viewer UI (logs are queryable via Drizzle Studio / SQL; UI is a future iteration).
- Email notifications on secret rotation.
- Bulk operations across tenants.
- Per-field history view (like a git log per field).
- Slug editing (locked as a permanent identifier; only `super_admin` can change via direct DB or future admin tool).

## 4. Design

### 4.1 Approach: split endpoints

Three focused endpoints, each with its own rate limit and audit log action type:

| Endpoint | Purpose | Rate limit | Audit action |
|---|---|---|---|
| `PATCH /api/v1/tenants/[id]` | Update name, slims_base_url, status | 30/min per user | `field_update` (1 row per field) |
| `POST /api/v1/tenants/[id]/regenerate-secret` | Rotate API token | 5/hour per user | `regenerate_secret` |
| `POST /api/v1/tenants/[id]/test-connection` | Healthcheck to agent | 10/min per user | `test_connection` |

**Why split, not a single fat PATCH?** Secret rotation is an irreversible security event. Separating it:
- prevents accidental regeneration via forgotten flag,
- allows independent rate limits (5/h vs 30/min),
- produces granular audit logs (severity differ),
- simplifies future per-action policies (e.g., require 2FA for regen).

### 4.2 Data model

#### New table: `tenant_audit_logs`

```sql
CREATE TABLE tenant_audit_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,  -- nullable: user can be deleted, log persists
  actor_email     text NOT NULL,                                  -- denormalized for retention
  action          varchar(40) NOT NULL,                            -- 'field_update' | 'regenerate_secret' | 'test_connection'
  field_name      varchar(40),                                     -- nullable; only for 'field_update'
  old_value       text,                                            -- nullable; masked for secrets
  new_value       text,                                            -- nullable; masked for secrets
  metadata        jsonb,                                           -- extra data (test result, IP, UA)
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_tenant_created ON tenant_audit_logs(tenant_id, created_at DESC);
CREATE INDEX idx_audit_actor ON tenant_audit_logs(actor_user_id, created_at DESC);
```

#### Audit log content rules

| Action | `field_name` | `old_value` / `new_value` | `metadata` |
|---|---|---|---|
| `field_update` | `'name'` \| `'slims_base_url'` \| `'status'` | plaintext (these are not secret) | `{ ip, userAgent }` |
| `regenerate_secret` | NULL | `'[REDACTED]'` for both | `{ ip, userAgent }` |
| `test_connection` | NULL | NULL | `{ success, responseTimeMs, statusCode, error? }` |

Field mask rule: any column whose name contains `secret`, `token`, `hash`, `key`, or `password` must be stored as `'[REDACTED]'`. URL/name/status are not secret and stored as plaintext.

Rows are immutable. No `UPDATE` on audit rows; only `INSERT` and `SELECT`. `ON DELETE CASCADE` from `tenants` means deleting a tenant removes its audit log (acceptable for a soft-delete scenario; we can revisit if we add tenant archival later).

### 4.3 API specifications

#### `PATCH /api/v1/tenants/[id]`

**Auth:**
- `super_admin` → any tenant
- `tenant_admin` / `librarian` → only if `user.tenantId === id`; otherwise 403 `FORBIDDEN`

**Request body** (Zod-validated, all fields optional, slug silently ignored):
```ts
{
  name?: string(1..255),
  slims_base_url?: string(URL),
  status?: 'pending' | 'connected' | 'disconnected'
}
```

**Behavior:**
- Empty body → 400 `NO_OP`
- All fields same as existing → 200, no audit log
- One or more fields differ → write 1 audit log row per changed field (`action='field_update'`, `field_name`, `old_value`, `new_value`)
- `slug` in body is silently ignored (locked)
- Rate limit: 30 req/min per user (Redis token bucket, keyed by `userId`)

**Response 200:**
```json
{
  "data": {
    "id": "...",
    "name": "Universitas NextLib",
    "slug": "universitas-nextlib",
    "status": "connected",
    "slimsBaseUrl": "https://slims.univ.ac.id",  // decrypted only if owner
    "updatedAt": "2026-06-16T..."
  }
}
```

`slimsBaseUrl` is decrypted only when the requesting user owns the tenant. For `super_admin` viewing another tenant, the value is omitted (or shown as `[ENCRYPTED]`).

#### `POST /api/v1/tenants/[id]/regenerate-secret`

**Auth:** same as PATCH (owner or `super_admin`).

**Request body:** `{ confirm: true }` (required, prevents accidental click).

**Behavior:**
- `confirm !== true` → 400 `CONFIRMATION_REQUIRED`
- Generate new secret: `randomBytes(32).toString('hex')` (64 hex chars)
- AES-256-GCM encrypt with `AES_256_ENCRYPTION_KEY`
- Update `apiSecretEncrypted` + `tokenHash` (SHA-256 hex of new secret)
- Write audit log: `action='regenerate_secret'`, both values `'[REDACTED]'`, `metadata: { ip, userAgent }`
- Old secret immediately invalid — any HMAC token from agent signed with old secret will be rejected by `tenant-context.ts:18-30` lookup
- Rate limit: 5 req/hour per user (Redis token bucket)

**Response 200:**
```json
{
  "data": {
    "api_token": "a3f9b8e2...",
    "message": "Token lama langsung tidak berlaku. Update plugin NextLib-Agent di SLiMS dalam 24 jam."
  }
}
```

The plaintext `api_token` is returned exactly once. There is no endpoint to retrieve it later. Operators must record it before closing the modal.

#### `POST /api/v1/tenants/[id]/test-connection`

**Auth:** same as PATCH (owner or `super_admin`).

**Request body:** `{}` (no input).

**Behavior:**
- Decrypt `slimsBaseUrl` + `apiSecretEncrypted` server-side
- GET request to `{slimsBaseUrl}/api/v1/nextlib/health` with `X-NextLib-Token` (HMAC-signed via existing `HmacSigner`) + `X-NextLib-Secret-Hash` headers (reuse `agent-client.ts` patterns)
- 5s `AbortController` timeout
- Write audit log: `action='test_connection'`, `metadata: { success, responseTimeMs, statusCode, error? }`
- **Auto-update `status`**:
  - 200 OK → `status = 'connected'`
  - any non-200, network error, or timeout → `status = 'disconnected'`
- Rate limit: 10 req/min per user

**Response 200:**
```json
{
  "data": {
    "success": true,
    "responseTimeMs": 142,
    "statusCode": 200,
    "status": "connected"
  }
}
```

### 4.4 Authorization model

```
super_admin          → can edit any tenant
tenant_admin         → can edit only user.tenantId
librarian            → can edit only user.tenantId (read-only mostly; treat as tenant_admin for this scope)
unauthenticated      → 401
```

All three new endpoints enforce this. The check happens server-side via `getSessionUser()` + a `tenantAccessGuard(user, tenantId)` helper. No client trust.

### 4.5 Rate limiting

Use Redis (already in stack) with a token-bucket algorithm. New helper: `src/lib/rate-limit.ts`:

```ts
type RateLimitConfig = { name: string; limit: number; windowSec: number };
async function checkRateLimit(userId: string, cfg: RateLimitConfig): Promise<{ allowed: boolean; remaining: number; resetSec: number }>;
```

Each endpoint gets its own bucket key:
- `ratelimit:patch-tenant:<userId>` (30/min)
- `ratelimit:regen-secret:<userId>` (5/hour)
- `ratelimit:test-conn:<userId>` (10/min)

Response 429 with `Retry-After` header when exceeded. Body:
```json
{ "error": true, "code": "RATE_LIMITED", "message": "...", "resetSec": 1800 }
```

### 4.6 UI components

#### `/koneksi/page.tsx` (modified)

**Privacy fix:** add `where(eq(tenants.id, user.tenantId))` clause for non-`super_admin` users (similar to `tenants/route.ts:54`).

**For `super_admin`:** keep current list view.

**For `tenant_admin` / `librarian`:** render a single `<ConnectionEditor>` for their own tenant.

#### New: `components/tenant/connection-editor.tsx`

Single form, server-rendered initial values, client-side updates:

```
┌──────────────────────────────────────────────┐
│ Koneksi                                       │
│ Status koneksi NextLib ↔ SLiMS kampus Anda   │
├──────────────────────────────────────────────┤
│ [Status Badge: Connected]                     │
│ Universitas NextLib                          │
│ universitas-nextlib                          │
├──────────────────────────────────────────────┤
│ Konfigurasi Koneksi                          │
│                                               │
│ Nama Institusi    [Universitas NextLib]      │
│ URL SLiMS         [https://slims.univ.ac.id] │
│ Status            [Connected ▼]              │
│                                               │
│ [Simpan]   [Test Koneksi]                    │
├──────────────────────────────────────────────┤
│ API Token                                 ⚠  │
│ xxxxxxxxxxxxxxxxxxxxxxxx...1234              │
│ [Tampilkan]  [Regenerate]                    │
└──────────────────────────────────────────────┘
```

Uses `react-hook-form` + `@hookform/resolvers/zod` (already in stack). On save, calls PATCH and shows toast.

#### New: `components/tenant/regenerate-secret-modal.tsx`

Two-phase modal:
1. **Confirm phase:** warning text + checkbox "Saya paham token lama akan langsung tidak valid" + button "Regenerate"
2. **One-time view phase:** new token in `<code>` block, "Salin" button, prominent warning "Simpan sekarang. Tidak akan ditampilkan lagi."

On close, returns to form. The form's "Tampilkan" button is disabled with tooltip "Token hanya tersedia setelah regenerate" because we have no way to retrieve the plaintext secret after the modal closes.

#### New: `components/tenant/test-connection-button.tsx`

Standalone button with loading spinner. Calls POST test-connection, displays result in a toast or inline panel.

### 4.7 Data flow example: regenerate secret

```
[tenant_admin clicks "Regenerate"]
   → modal opens (confirm phase)
[user checks "saya paham" + clicks "Regenerate"]
   → modal enters loading state
   → fetch POST /api/v1/tenants/<id>/regenerate-secret { confirm: true }
   → server:
     1. authenticateSession() → user
     2. tenantAccessGuard(user, id) → 403 if not owner
     3. rateLimit(user, regen cfg) → 429 if exceeded
     4. generate randomBytes(32).toString('hex')
     5. encrypt(secret, AES_KEY)
     6. UPDATE tenants SET api_secret_encrypted=?, token_hash=sha256(secret), updated_at=now() WHERE id=?
     7. INSERT tenant_audit_logs (action='regenerate_secret', old='[REDACTED]', new='[REDACTED]', metadata={ip, ua})
     8. response { data: { api_token: <new>, message: '...' } }
   → modal shows one-time view phase
[user copies token, clicks "Tutup"]
   → modal closes
   → form re-fetches via PATCH (status may have changed)
```

### 4.8 Error handling

| HTTP | When | Code | UI |
|---|---|---|---|
| 400 | Empty body / invalid URL / invalid status / `confirm !== true` | `NO_OP` / `VALIDATION_ERROR` / `CONFIRMATION_REQUIRED` | Inline form error |
| 401 | No session | `UNAUTHORIZED` | Redirect to `/login` |
| 403 | Not owner + not `super_admin` | `FORBIDDEN` | Toast "Tidak punya akses" |
| 404 | Tenant not found | `NOT_FOUND` | Toast "Tenant tidak ditemukan" |
| 409 | Concurrent update (optimistic lock via `updatedAt` mismatch) | `STALE_WRITE` | Toast "Data berubah, muat ulang" |
| 429 | Rate limited | `RATE_LIMITED` | Toast with `Retry-After` countdown |
| 500 | DB / encryption error | `SERVER_ERROR` | Generic toast + log |

### 4.9 Testing strategy

Tests are written **before** implementation per `test-driven-development` skill.

#### API tests (vitest, default Node env)

`src/app/api/v1/tenants/[id]/route.test.ts` (extend existing file):
- `tenant_admin can update own tenant` (200)
- `tenant_admin cannot update other tenant` (403)
- `super_admin can update any tenant` (200)
- `librarian can update own tenant` (200)
- `empty body returns 400 NO_OP`
- `invalid URL returns 400`
- `invalid status returns 400`
- `slug in body is silently ignored`
- `unchanged field produces no audit log`
- `changed field produces 1 audit log row`
- `31st request in 1min returns 429`
- `slimsBaseUrl decrypted in response only for owner`

`src/app/api/v1/tenants/[id]/regenerate-secret/route.test.ts` (new):
- `owner regenerates → new token returned, old tokenHash replaced in DB`
- `non-owner returns 403`
- `confirm !== true returns 400`
- `6th request in 1h returns 429`
- `audit log row written with [REDACTED] values`
- `plaintext secret never appears in any log output`

`src/app/api/v1/tenants/[id]/test-connection/route.test.ts` (new):
- `agent healthcheck 200 → status='connected' in response and DB`
- `agent network error → status='disconnected'`
- `5s timeout → status='disconnected'`
- `non-owner returns 403`
- `11th request in 1min returns 429`
- `audit log row written with metadata.success and responseTimeMs`

`src/lib/tenant-audit.test.ts` (new):
- `field_update writes 1 row per changed field`
- `regenerate_secret masks values to [REDACTED]`
- `ON DELETE CASCADE removes audit rows when tenant deleted`

`src/lib/rate-limit.test.ts` (new):
- `first N requests allowed`
- `N+1 request denied with resetSec`
- `after window expires, requests allowed again`

#### Component tests (jsdom)

`src/components/tenant/connection-editor.test.tsx` (new):
- `form validation: invalid URL shows error`
- `save success: toast and refetch`
- `save 403: error toast`
- `test button disabled while in-flight`

`src/components/tenant/regenerate-secret-modal.test.tsx` (new):
- `regenerate button disabled until confirm checked`
- `after success, one-time token displayed`
- `copy button writes to clipboard`

#### Page test (jsdom)

`src/app/(dashboard)/koneksi/page.test.tsx` (new):
- `tenant_admin sees only their own tenant`
- `super_admin sees all tenants`

#### Manual smoke tests (post-deploy)

1. Login as `tenant_admin` → `/koneksi` → form shows own tenant only ✓
2. Edit `slims_base_url` → save → reload → persisted ✓
3. Click "Test Koneksi" → spinner → result in 5s ✓
4. Click "Regenerate" → confirm → token displayed once → modal closes → "Tampilkan" disabled ✓
5. Verify old token rejected: `curl -H "X-NextLib-Secret-Hash: <OLD_HASH>"` to `/api/v1/handshake` → 401
6. Verify new token accepted: same with `<NEW_HASH>` → 200

### 4.10 Security considerations

- **No plaintext secret in audit log** — enforced by `maskSecretValue()` helper that redacts any field name matching `secret|token|hash|key|password`.
- **No plaintext secret in error responses** — error messages reference fields by name, never values.
- **No plaintext secret in server logs** — `console.log` of audit rows must be explicit; default to `console.log` of the row object is fine because values are already masked at write time.
- **No plaintext secret in client-side state** — once the regenerate modal closes, the token is gone from React state. LocalStorage is never used.
- **Rate limit by user, not IP** — IP can change (NAT, mobile); user is the stable identifier. Stored in Redis keyed by `userId`.
- **CSRF** — all state-changing routes go through session auth. Existing app does not have CSRF tokens (already noted in code review); out of scope for this feature.
- **Optimistic concurrency** — PATCH checks `updatedAt` in WHERE clause; concurrent writes fail with 409.

### 4.11 Migration

New Drizzle migration `0004_tenant_audit_logs.sql`:

```sql
CREATE TABLE "tenant_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "actor_email" text NOT NULL,
  "action" varchar(40) NOT NULL,
  "field_name" varchar(40),
  "old_value" text,
  "new_value" text,
  "metadata" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "idx_audit_tenant_created" ON "tenant_audit_logs"("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "idx_audit_actor" ON "tenant_audit_logs"("actor_user_id", "created_at" DESC);
```

Generated via `npm run db:generate` after schema update. Auto-applied on next deploy via `RUN_MIGRATIONS=1` in `docker-compose.coolify.yml` (existing pattern).

### 4.12 Rollout

1. Generate migration, verify SQL, run locally
2. Write all tests (red)
3. Implement `lib/rate-limit.ts` + `lib/tenant-audit.ts`
4. Implement 3 API endpoints (green)
5. Implement UI components (green)
6. Update `/koneksi` page (green)
7. Local smoke test (`docker-compose up`)
8. Push to main
9. Coolify auto-redeploys; `RUN_MIGRATIONS=1` runs the migration on `app` startup
10. Verify in production: regenerate, confirm old rejected + new accepted via handshake

### 4.13 Out of scope (deferred)

- `super_admin` inline edit per tenant
- Audit log viewer UI (use Drizzle Studio for now)
- Email notification on secret rotation
- Bulk operations
- Per-field history view
- Slug editing (locked permanently)
- 2FA requirement for regenerate

## 5. Open questions

None at design time. All clarified during brainstorming (slug locked, regenerate-confirmed, all-fields-otherwise-editable, audit log mandatory).

## 6. References

- PRD: `prd.md` §4.1 FR-B.1, §4.1 FR-A.2
- Code review notes: `nextlib-cloud/AGENTS.md`
- Existing patterns: `tenants/route.ts:172-201` (POST creation), `crypto.ts` (AES-256-GCM), `hmac.ts` (token format), `agent-client.ts` (outbound agent calls)
- Privacy-first constraint: PRD §2 (no PII in cloud logs); audit log stores metadata only, no agent payloads.
