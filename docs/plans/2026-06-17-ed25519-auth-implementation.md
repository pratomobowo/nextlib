# Ed25519 Signature Authentication Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current shared-secret HMAC token authentication with Ed25519 asymmetric signatures, so the SLiMS plugin never holds a secret and SaaS-side key rotation is one-click.

**Architecture:** SaaS generates an Ed25519 keypair per tenant at creation. The **private key** is encrypted at-rest in the SaaS Postgres and used to sign each outbound request (`${timestamp}.${method}.${path}.${body}`). The **public key** ships in the per-tenant plugin ZIP's `.env`. The plugin verifies signatures with the public key alone — no DB lookup, no secret rotation pain. Existing tenants get a one-time migration that generates a keypair on first read and keeps their old HMAC token working in parallel until they re-download.

**Tech Stack:** Node.js built-in `crypto` (ed25519), PHP built-in `sodium_*` (libsodium), Drizzle ORM (existing), Vitest (existing), PHPUnit (existing in plugin).

---

## Background — current state

| File | What it does today |
|---|---|
| `nextlib-cloud/src/lib/crypto.ts` | `encrypt()` (AES-256-GCM) + `decrypt()`. Will get Ed25519 helpers. |
| `nextlib-cloud/src/app/api/v1/tenants/[id]/test-connection/route.ts` | Decrypts tenant secret, generates `HmacSigner` token. Will sign with Ed25519 instead. |
| `nextlib-cloud/src/app/api/v1/tenants/[id]/agent-zip/route.ts` | Regenerates a 32-byte hex secret, builds ZIP. Will regenerate keypair and ship public key in `.env`. |
| `nextlib-cloud/src/app/api/v1/tenants/route.ts` | POST creates a tenant with a default `apiSecretEncrypted` + `tokenHash`. Will create tenant with a generated keypair. |
| `nextlib-cloud/src/lib/db/schema.ts` | `tenants` table: `apiSecretEncrypted`, `tokenHash`. Will add `ed25519PublicKey`, `ed25519PrivateKeyEncrypted`. `tokenHash` becomes legacy. |
| `nextlib-agent/lib/HmacSigner.php` | HMAC token sign/verify. Will become Ed25519 verifier; HMAC code stays for backward compat. |
| `nextlib-agent/middleware/TokenValidator.php` | Validates HMAC, reads `X-NextLib-Token` + `X-NextLib-Secret-Hash`. Will verify Ed25519 first, fall back to HMAC. |
| `nextlib-agent/.env` (template) | `NEXTLIB_TOKEN_SECRET=…` | Will add `NEXTLIB_PUBLIC_KEY=…` (base64 32 bytes), keep `NEXTLIB_TOKEN_SECRET` as legacy. |

---

## Phasing

- **Phase 1 (Tasks 1-3)**: SaaS keypair generation + DB migration + signing helpers. **No breaking change yet** — new code path runs in parallel.
- **Phase 2 (Tasks 4-5)**: Plugin Ed25519 verifier + backward compat. Plugin accepts BOTH signatures.
- **Phase 3 (Tasks 6-7)**: SaaS agent-zip ships public key; UI exposes rotate; existing tenants get migration.
- **Phase 4 (Tasks 8-9)**: Tests + docs + remove HMAC code paths after a deprecation window.

---

### Task 1: Add `ed25519Keypair` helper to SaaS

**Files:**
- Modify: `nextlib-cloud/src/lib/crypto.ts`
- Test: `nextlib-cloud/src/lib/crypto.test.ts`

**Step 1: Write the failing test**

Add to `nextlib-cloud/src/lib/crypto.test.ts`:

```ts
import { generateEd25519Keypair, signRequest, verifyRequestSignature } from "./crypto";

describe("Ed25519 keypair", () => {
  it("generates a valid 32-byte public key and 64-byte private seed", () => {
    const kp = generateEd25519Keypair();
    expect(Buffer.from(kp.publicKey, "base64")).toHaveLength(32);
    expect(Buffer.from(kp.privateKey, "base64")).toHaveLength(32);
    // sodium stores 64 bytes for the secret; we expose 32-byte seed + 32-byte pub concatenated
  });

  it("signRequest produces a 64-byte detached signature", () => {
    const kp = generateEd25519Keypair();
    const sig = signRequest(kp.privateKey, "1700000000", "POST", "/api/v1/nextlib/handshake", '{"a":1}');
    expect(Buffer.from(sig, "base64")).toHaveLength(64);
  });

  it("verifyRequestSignature accepts a fresh signature", () => {
    const kp = generateEd25519Keypair();
    const sig = signRequest(kp.privateKey, "1700000000", "POST", "/api/v1/nextlib/handshake", '{"a":1}');
    expect(verifyRequestSignature(kp.publicKey, sig, "1700000000", "POST", "/api/v1/nextlib/handshake", '{"a":1}', 300)).toBe(true);
  });

  it("verifyRequestSignature rejects a tampered body", () => {
    const kp = generateEd25519Keypair();
    const sig = signRequest(kp.privateKey, "1700000000", "POST", "/api/v1/nextlib/handshake", '{"a":1}');
    expect(verifyRequestSignature(kp.publicKey, sig, "1700000000", "POST", "/api/v1/nextlib/handshake", '{"a":2}', 300)).toBe(false);
  });

  it("verifyRequestSignature rejects an expired timestamp", () => {
    const kp = generateEd25519Keypair();
    const sig = signRequest(kp.privateKey, "1700000000", "POST", "/api/v1/nextlib/handshake", '{"a":1}');
    const longAgo = String(Math.floor(Date.now() / 1000) - 1000);
    expect(verifyRequestSignature(kp.publicKey, sig, longAgo, "POST", "/api/v1/nextlib/handshake", '{"a":1}', 300)).toBe(false);
  });

  it("verifyRequestSignature rejects a wrong public key", () => {
    const a = generateEd25519Keypair();
    const b = generateEd25519Keypair();
    const sig = signRequest(a.privateKey, "1700000000", "POST", "/api/v1/nextlib/handshake", '{"a":1}');
    expect(verifyRequestSignature(b.publicKey, sig, "1700000000", "POST", "/api/v1/nextlib/handshake", '{"a":1}', 300)).toBe(false);
  });
});
```

**Step 2: Run the test, expect failure**

```bash
cd .worktrees/ed25519-auth/nextlib-cloud && npx vitest run src/lib/crypto.test.ts
```

Expected: FAIL with "signRequest is not a function" or similar.

**Step 3: Implement the helpers**

Add to `nextlib-cloud/src/lib/crypto.ts`:

```ts
import { generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, createPrivateKey, createPublicKey } from "crypto";

/** A 64-byte Ed25519 secret key as base64 (sodium-style concatenation of seed + public). */
export interface Ed25519Keypair {
  /** 32 bytes, base64. Safe to ship in .env. */
  publicKey: string;
  /** 64 bytes, base64. Treat as secret — encrypt at rest. */
  privateKey: string;
}

export function generateEd25519Keypair(): Ed25519Keypair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ format: "base64" }) as string,
    privateKey: privateKey.export({ format: "base64" }) as string,
  };
}

/**
 * Sign an outbound request. Returns 64-byte detached signature as base64.
 * The message signed is: `${timestamp}.${method}.${path}.${body}`
 * (timestamp in seconds since epoch, as string).
 */
export function signRequest(
  privateKeyBase64: string,
  timestamp: string,
  method: string,
  path: string,
  body: string
): string {
  const key = createPrivateKey({
    key: Buffer.from(privateKeyBase64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const message = Buffer.from(`${timestamp}.${method.toUpperCase()}.${path}.${body}`, "utf8");
  const sig = cryptoSign(null, message, key);
  return sig.toString("base64");
}

/**
 * Verify a request signature. Returns false on any error (bad sig, wrong key,
 * expired timestamp, malformed input). maxAgeSec is the tolerance window.
 */
export function verifyRequestSignature(
  publicKeyBase64: string,
  signatureBase64: string,
  timestamp: string,
  method: string,
  path: string,
  body: string,
  maxAgeSec: number
): boolean {
  try {
    const ts = parseInt(timestamp, 10);
    if (!Number.isFinite(ts)) return false;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > maxAgeSec) return false;

    const key = createPublicKey({
      key: Buffer.from(publicKeyBase64, "base64"),
      format: "der",
      type: "spki",
    });
    const message = Buffer.from(`${timestamp}.${method.toUpperCase()}.${path}.${body}`, "utf8");
    const sig = Buffer.from(signatureBase64, "base64");
    return cryptoVerify(null, message, key, sig);
  } catch {
    return false;
  }
}
```

**Step 4: Run the test, expect pass**

```bash
npx vitest run src/lib/crypto.test.ts
```

Expected: 6 new tests pass.

**Step 5: Commit**

```bash
cd /Volumes/Kerjaan/vibe-code/nextlib-platform/.worktrees/ed25519-auth
git add nextlib-cloud/src/lib/crypto.ts nextlib-cloud/src/lib/crypto.test.ts
git commit -m "feat(cloud): add Ed25519 keypair + sign/verify helpers"
```

---

### Task 2: Add keypair columns to `tenants` schema + migration

**Files:**
- Modify: `nextlib-cloud/src/lib/db/schema.ts`
- Create: `nextlib-cloud/drizzle/0005_tenant_ed25519_keypair.sql` (generated)
- Modify: `nextlib-cloud/src/lib/db/seed.ts` (to set keypair on insert)

**Step 1: Add columns to schema**

Edit `nextlib-cloud/src/lib/db/schema.ts` (the `tenants` table definition) to add:

```ts
ed25519PublicKey: text("ed25519_public_key"),                       // base64, NOT secret
ed25519PrivateKeyEncrypted: text("ed25519_private_key_encrypted"), // AES-256-GCM, base64
ed25519RotatedAt: timestamp("ed25519_rotated_at", { withTimezone: true }),
ed25519KeyId: text("ed25519_key_id"),                             // UUID, for audit
```

Keep `apiSecretEncrypted` and `tokenHash` for backward compat (will be removed in a later task).

**Step 2: Generate migration**

```bash
cd .worktrees/ed25519-auth/nextlib-cloud && npm run db:generate
```

Expected: a new file `drizzle/0005_*.sql` is created with the four `ALTER TABLE … ADD COLUMN` statements. Verify the SQL is sensible:

```bash
cat drizzle/0005_*.sql
```

**Step 3: Verify migration applies cleanly to a fresh DB**

If you have a local Postgres (Coolify or `docker compose up postgres`), apply:

```bash
psql "$DATABASE_URL" -f drizzle/0005_*.sql
```

Expected: `ALTER TABLE` × 4, no errors.

**Step 4: Update the seed script**

Edit `nextlib-cloud/scripts/seed.ts` so the seed tenant gets a keypair:

```ts
import { generateEd25519Keypair, encrypt } from "../src/lib/crypto";
// ... existing imports

// In main():
const kp = generateEd25519Keypair();
const privateKeyEncrypted = encrypt(kp.privateKey, process.env.AES_256_ENCRYPTION_KEY!);

[tenant] = await db.insert(tenants).values({
  // ... existing fields
  ed25519PublicKey: kp.publicKey,
  ed25519PrivateKeyEncrypted: privateKeyEncrypted,
  ed25519RotatedAt: new Date(),
  ed25519KeyId: crypto.randomUUID(),
  // apiSecretEncrypted: encrypt("localdevtesttoken…", encryptionKey), // keep for legacy
}).returning();
```

**Step 5: Commit**

```bash
git add nextlib-cloud/src/lib/db/schema.ts nextlib-cloud/drizzle/0005_*.sql nextlib-cloud/scripts/seed.ts
git commit -m "feat(cloud): add Ed25519 keypair columns + seed key on tenant create"
```

---

### Task 3: Migrate existing tenants on read (lazy keypair generation)

**Files:**
- Create: `nextlib-cloud/src/lib/tenant-keys.ts`
- Test: `nextlib-cloud/src/lib/tenant-keys.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ensureTenantKeypair } from "./tenant-keys";

const dbMock = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
};
const generateEd25519KeypairMock = vi.fn().mockReturnValue({ publicKey: "PUB", privateKey: "PRIV" });
const encryptMock = vi.fn().mockReturnValue("ENCRYPTED");

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/crypto", () => ({
  generateEd25519Keypair: generateEd25519KeypairMock,
  encrypt: encryptMock,
}));

describe("ensureTenantKeypair", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns existing keypair if both columns are set", async () => {
    dbMock.limit.mockResolvedValueOnce([{ ed25519PublicKey: "EXISTING_PUB", ed25519PrivateKeyEncrypted: "EXISTING_ENC" }]);
    const kp = await ensureTenantKeypair("t1");
    expect(kp).toEqual({ publicKey: "EXISTING_PUB", privateKeyEncrypted: "EXISTING_ENC" });
    expect(generateEd25519KeypairMock).not.toHaveBeenCalled();
  });

  it("generates a new keypair if either column is empty", async () => {
    dbMock.limit.mockResolvedValueOnce([{ ed25519PublicKey: null, ed25519PrivateKeyEncrypted: null }]);
    dbMock.update.mockReturnValueOnce({ set: dbMock.set });
    dbMock.set.mockReturnValueOnce({ where: vi.fn().mockResolvedValue(undefined) });
    const kp = await ensureTenantKeypair("t1");
    expect(kp).toEqual({ publicKey: "PUB", privateKeyEncrypted: "ENCRYPTED" });
    expect(generateEd25519KeypairMock).toHaveBeenCalledOnce();
    expect(encryptMock).toHaveBeenCalledWith("PRIV", expect.any(String));
  });
});
```

**Step 2: Run, expect failure**

```bash
npx vitest run src/lib/tenant-keys.test.ts
```

**Step 3: Implement**

```ts
import { db } from "./db";
import { tenants } from "./db/schema";
import { eq } from "drizzle-orm";
import { generateEd25519Keypair, encrypt } from "./crypto";

export interface TenantKeypair {
  /** 32 bytes, base64 */
  publicKey: string;
  /** AES-256-GCM encrypted, base64 */
  privateKeyEncrypted: string;
}

/**
 * Get the tenant's Ed25519 keypair, lazily generating one if missing.
 * Idempotent: if both columns are set, returns the existing key.
 */
export async function ensureTenantKeypair(tenantId: string): Promise<TenantKeypair> {
  const encryptionKey = process.env.AES_256_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("AES_256_ENCRYPTION_KEY is not configured");
  }

  const [existing] = await db
    .select({
      ed25519PublicKey: tenants.ed25519PublicKey,
      ed25519PrivateKeyEncrypted: tenants.ed25519PrivateKeyEncrypted,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (existing?.ed25519PublicKey && existing?.ed25519PrivateKeyEncrypted) {
    return {
      publicKey: existing.ed25519PublicKey,
      privateKeyEncrypted: existing.ed25519PrivateKeyEncrypted,
    };
  }

  // Generate + persist
  const kp = generateEd25519Keypair();
  const privateKeyEncrypted = encrypt(kp.privateKey, encryptionKey);
  await db
    .update(tenants)
    .set({
      ed25519PublicKey: kp.publicKey,
      ed25519PrivateKeyEncrypted: privateKeyEncrypted,
      ed25519RotatedAt: new Date(),
      ed25519KeyId: crypto.randomUUID(),
    })
    .where(eq(tenants.id, tenantId));

  return { publicKey: kp.publicKey, privateKeyEncrypted };
}
```

**Step 4: Run, expect pass**

```bash
npx vitest run src/lib/tenant-keys.test.ts
```

**Step 5: Commit**

```bash
git add nextlib-cloud/src/lib/tenant-keys.ts nextlib-cloud/src/lib/tenant-keys.test.ts
git commit -m "feat(cloud): ensureTenantKeypair generates Ed25519 keys on first read"
```

---

### Task 4: Plugin — Ed25519 verifier with HMAC fallback

**Files:**
- Modify: `nextlib-agent/lib/HmacSigner.php` (rename method, add Ed25519 path; or create new file `lib/Ed25519Verifier.php`)
- Create: `nextlib-agent/lib/Ed25519Verifier.php` (preferred — keeps file small)
- Test: `nextlib-agent/tests/lib/Ed25519VerifierTest.php`
- Modify: `nextlib-agent/middleware/TokenValidator.php` (try Ed25519 first, fall back to HMAC)

**Step 1: Write the failing test**

`nextlib-agent/tests/lib/Ed25519VerifierTest.php`:

```php
<?php
namespace NextLibAgent\Tests\Lib;

use PHPUnit\Framework\TestCase;
use NextLibAgent\Lib\Ed25519Verifier;

final class Ed25519VerifierTest extends TestCase
{
    public function testVerifyReturnsTrueForFreshSignature(): void
    {
        $kp = sodium_crypto_sign_keypair();
        $publicKey = base64_encode(sodium_crypto_sign_publickey($kp));
        $timestamp = (string) time();
        $body = '{"a":1}';
        $message = "{$timestamp}.POST./api/v1/nextlib/handshake.{$body}";
        $sig = sodium_crypto_sign_detached($message, $kp);

        $this->assertTrue(
            Ed25519Verifier::verify($publicKey, base64_encode($sig), $timestamp, "POST", "/api/v1/nextlib/handshake", $body, 300)
        );
    }

    public function testVerifyReturnsFalseForTamperedBody(): void
    {
        $kp = sodium_crypto_sign_keypair();
        $publicKey = base64_encode(sodium_crypto_sign_publickey($kp));
        $timestamp = (string) time();
        $sig = sodium_crypto_sign_detached("{$timestamp}.POST./p.{}", $kp);
        $this->assertFalse(
            Ed25519Verifier::verify($publicKey, base64_encode($sig), $timestamp, "POST", "/p", '{"x":1}', 300)
        );
    }

    public function testVerifyReturnsFalseForExpiredTimestamp(): void
    {
        $kp = sodium_crypto_sign_keypair();
        $publicKey = base64_encode(sodium_crypto_sign_publickey($kp));
        $oldTs = (string) (time() - 1000);
        $body = '{}';
        $message = "{$oldTs}.POST./p.{$body}";
        $sig = sodium_crypto_sign_detached($message, $kp);
        $this->assertFalse(
            Ed25519Verifier::verify($publicKey, base64_encode($sig), $oldTs, "POST", "/p", $body, 300)
        );
    }
}
```

**Step 2: Run, expect failure (class doesn't exist)**

```bash
cd .worktrees/ed25519-auth/nextlib-agent && ./vendor/bin/phpunit tests/lib/Ed25519VerifierTest.php
```

**Step 3: Implement**

`nextlib-agent/lib/Ed25519Verifier.php`:

```php
<?php
namespace NextLibAgent\Lib;

/**
 * Ed25519 signature verifier for inbound NextLib-Cloud requests.
 *
 * Message signed by SaaS: `${timestamp}.${method}.${path}.${body}`
 * - timestamp: seconds since epoch (string)
 * - method: HTTP verb, uppercased
 * - path: URL path (e.g. "/api/v1/nextlib/handshake")
 * - body: raw request body (string)
 *
 * Headers expected from SaaS:
 *   X-NextLib-Timestamp: <seconds>
 *   X-NextLib-Signature: <base64 sig, 64 bytes>
 */
final class Ed25519Verifier
{
    /**
     * @return bool true if signature is valid and timestamp is within maxAgeSec of now
     */
    public static function verify(
        string $publicKeyBase64,
        string $signatureBase64,
        string $timestamp,
        string $method,
        string $path,
        string $body,
        int $maxAgeSec
    ): bool {
        if (!function_exists('sodium_crypto_sign_verify_detached')) {
            error_log('Ed25519Verifier: libsodium extension not loaded');
            return false;
        }

        // Timestamp window
        $ts = filter_var($timestamp, FILTER_VALIDATE_INT);
        if ($ts === false) return false;
        if (abs(time() - $ts) > $maxAgeSec) return false;

        // Decode inputs (defensive — base64_decode returns false on bad input)
        $publicKey = base64_decode($publicKeyBase64, true);
        $signature = base64_decode($signatureBase64, true);
        if ($publicKey === false || $signature === false) return false;
        if (strlen($publicKey) !== 32 || strlen($signature) !== 64) return false;

        $message = $timestamp . '.' . strtoupper($method) . '.' . $path . '.' . $body;
        return sodium_crypto_sign_verify_detached($message, $signature, $publicKey);
    }
}
```

**Step 4: Run, expect pass**

```bash
./vendor/bin/phpunit tests/lib/Ed25519VerifierTest.php
```

**Step 5: Update TokenValidator to try Ed25519 first, fall back to HMAC**

`nextlib-agent/middleware/TokenValidator.php` (replace the body of `handle`):

```php
public static function handle(string $apiSecret, callable $callback, int $tokenMaxAge = 300): void
{
    $headers = function_exists('getallheaders') ? array_change_key_case(getallheaders(), CASE_LOWER) : [];
    $timestamp = $headers['x-nextlib-timestamp'] ?? null;
    $signature = $headers['x-nextlib-signature'] ?? null;
    $publicKey = $apiSecret; // legacy naming; for Ed25519 this is the PUBLIC key

    $body = file_get_contents('php://input') ?: '';

    // Path 1: Ed25519 (preferred)
    if ($timestamp !== null && $signature !== null) {
        $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        if (Ed25519Verifier::verify($publicKey, $signature, $timestamp, $_SERVER['REQUEST_METHOD'] ?? 'GET', $path, $body, $tokenMaxAge)) {
            $callback($body);
            return;
        }
        self::respond(401, 'INVALID_SIGNATURE');
        return;
    }

    // Path 2: legacy HMAC token (backward compat)
    $token = $headers['x-nextlib-token'] ?? null;
    $secretHash = $headers['x-nextlib-secret-hash'] ?? null;
    if ($token === null || $secretHash === null) {
        self::respond(401, 'MISSING_AUTH');
        return;
    }

    // Re-derive secret from $apiSecret (which is actually the secret here)
    $expectedHash = hash('sha256', $apiSecret);
    if (!hash_equals($expectedHash, $secretHash)) {
        self::respond(401, 'INVALID_TOKEN');
        return;
    }

    $signer = new HmacSigner($apiSecret);
    if (!$signer->validate($token, $body, $tokenMaxAge)) {
        self::respond(401, 'INVALID_TOKEN');
        return;
    }
    $callback($body);
}
```

**Step 6: Run full plugin test suite**

```bash
./vendor/bin/phpunit
```

Expected: existing HMAC tests still pass + 3 new Ed25519 tests pass.

**Step 7: Commit**

```bash
cd /Volumes/Kerjaan/vibe-code/nextlib-platform/.worktrees/ed25519-auth
git add nextlib-agent/lib/Ed25519Verifier.php nextlib-agent/tests/lib/Ed25519VerifierTest.php nextlib-agent/middleware/TokenValidator.php
git commit -m "feat(agent): verify Ed25519 signatures (HMAC kept as fallback)"
```

---

### Task 5: Plugin — `.env` ships public key, not secret

**Files:**
- Modify: `nextlib-agent/nextlib-agent.plugin.php` (update `.env` template + new `config.php` env keys)

**Step 1: Add public key reading to `config.php`**

In `nextlib-agent/config.php`, add right next to the existing `api_secret` block:

```php
/**
 * Ed25519 public key for SaaS request signature verification.
 * Safe to ship in plaintext — verifying-only key.
 * Env: NEXTLIB_PUBLIC_KEY
 *
 * @var string
 */
'ed25519_public_key' => $nextlib_env('NEXTLIB_PUBLIC_KEY', ''),
```

**Step 2: Update the plugin's `.env` template comment in nextlib-agent.plugin.php**

In the `buildEnvFile` function, change the docstring at the top and add the new key:

```php
// New header (replace the existing 4-line header):
# NextLib-Agent Configuration
# Auto-generated by NextLib Cloud on {date} for tenant: {tenantSlug}
# Format: Ed25519 signature-based auth (v2) — no shared secret in plugin.
# Legacy HMAC secret kept below for backward compat with older SaaS.

# New key (add right after NEXTLIB_TENANT_ID):
NEXTLIB_PUBLIC_KEY={publicKey}
```

**Step 3: Pass the public key through `buildEnvFile`**

In `nextlib-cloud/src/app/api/v1/tenants/[id]/agent-zip/route.ts`, modify the `buildEnvFile` call to include the public key (read it from the tenant's `ed25519PublicKey` column).

**Step 4: Test the ZIP end-to-end**

```bash
# Build a fresh ZIP for an existing test tenant
curl -H "X-NextLib-Secret-Hash: <test-hash>" -X POST \
  http://localhost:3000/api/v1/tenants/<test-tenant-id>/agent-zip \
  -o /tmp/nextlib-agent.zip

# Extract and confirm .env contains NEXTLIB_PUBLIC_KEY
unzip -p /tmp/nextlib-agent.zip nextlib-agent/.env
```

Expected: `NEXTLIB_PUBLIC_KEY=<base64>` line present.

**Step 5: Commit**

```bash
git add nextlib-agent/config.php nextlib-agent/nextlib-agent.plugin.php nextlib-cloud/src/app/api/v1/tenants/[id]/agent-zip/route.ts
git commit -m "feat: ship Ed25519 public key in plugin .env, keep HMAC legacy"
```

---

### Task 6: SaaS — `test-connection` signs with Ed25519

**Files:**
- Modify: `nextlib-cloud/src/app/api/v1/tenants/[id]/test-connection/route.ts`

**Step 1: Add a test for the signed request**

In `nextlib-cloud/src/app/api/v1/tenants/[id]/test-connection/route.test.ts`, add a new test:

```ts
it("sends Ed25519 signature headers (X-NextLib-Timestamp + X-NextLib-Signature)", async () => {
  fetchMock.mockResolvedValue({ status: 200, ok: true, text: () => Promise.resolve("{}") });
  await POST(makeReq(), { params: Promise.resolve({ id: "t1" }) });
  const [url, init] = fetchMock.mock.calls[0];
  const headers = (init as RequestInit).headers as Record<string, string>;
  expect(headers["X-NextLib-Timestamp"]).toMatch(/^\d+$/);
  expect(headers["X-NextLib-Signature"]).toMatch(/^[A-Za-z0-9+/=]+$/);
});
```

**Step 2: Run, expect failure**

```bash
npx vitest run "nextlib-cloud/src/app/api/v1/tenants/[id]/test-connection/route.test.ts"
```

**Step 3: Update the route**

Replace the part of the route that builds the auth headers. Drop `generateToken` and the secret-hash header. Use `signRequest`:

```ts
import { ensureTenantKeypair } from "@/lib/tenant-keys";
import { signRequest } from "@/lib/crypto";
// remove: import { generateToken } from "@/lib/hmac";

// in handler:
const kp = await ensureTenantKeypair(id);
const privateKey = decrypt(kp.privateKeyEncrypted, encryptionKey);
const path = new URL(healthUrl).pathname; // e.g. "/api/v1/nextlib/health"
const ts = String(Math.floor(Date.now() / 1000));
const sig = signRequest(privateKey, ts, "GET", path, "");
// ... fetch with:
headers: {
  "X-NextLib-Timestamp": ts,
  "X-NextLib-Signature": sig,
}
```

**Step 4: Run, expect pass**

```bash
npx vitest run "nextlib-cloud/src/app/api/v1/tenants/[id]/test-connection/route.test.ts"
```

**Step 5: Commit**

```bash
git add nextlib-cloud/src/app/api/v1/tenants/[id]/test-connection/route.ts nextlib-cloud/src/app/api/v1/tenants/[id]/test-connection/route.test.ts
git commit -m "feat(cloud): test-connection signs with Ed25519 (no more shared secret)"
```

---

### Task 7: SaaS — UI: show public key + rotate button

**Files:**
- Modify: `nextlib-cloud/src/components/tenant/connection-editor.tsx`

**Step 1: Add the public-key display + rotate button**

In `nextlib-cloud/src/components/tenant/connection-editor.tsx`, inside the API Token card (where the masked token currently lives), replace the masked token + Regenerate button block with:

```tsx
{tenant.ed25519PublicKey ? (
  <div>
    <p className="text-xs text-muted-foreground">Ed25519 public key (auto-rotated on plugin re-download)</p>
    <code className="block overflow-x-auto rounded-lg border bg-muted/50 px-3 py-2 text-xs font-mono break-all">
      {tenant.ed25519PublicKey.slice(0, 32)}…{tenant.ed25519PublicKey.slice(-8)}
    </code>
    <div className="mt-2 flex justify-end">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={async () => {
          if (!confirm("Rotate keypair? Plugin will need to be re-downloaded to keep working.")) return;
          const r = await fetch(`/api/v1/tenants/${tenant.id}/rotate-keypair`, { method: "POST" });
          if (r.ok) {
            alert("Keypair rotated. Re-download plugin ZIP to keep working.");
            window.location.reload();
          } else {
            alert("Failed to rotate");
          }
        }}
      >
        Rotate Keypair
      </Button>
    </div>
  </div>
) : (
  <p className="text-xs text-muted-foreground">No keypair yet. Re-download plugin to generate one.</p>
)}
```

**Step 2: Update the `tenant` prop shape**

In `nextlib-cloud/src/app/(dashboard)/koneksi/page.tsx`, fetch the `ed25519PublicKey` column too (alongside `name`, `slug`, `status`) so the component receives it.

**Step 3: Add the rotate endpoint**

`nextlib-cloud/src/app/api/v1/tenants/[id]/rotate-keypair/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { checkTenantAccess } from "@/lib/tenant-access-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/tenant-audit";
import { generateEd25519Keypair, encrypt } from "@/lib/crypto";
import { randomUUID } from "crypto";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: true, code: "UNAUTHORIZED" }, { status: 401 });
  const access = checkTenantAccess(sessionUser.user as any, id);
  if (!access.allowed) return NextResponse.json({ error: true, code: access.code, message: access.message }, { status: access.status });

  const rl = await checkRateLimit(sessionUser.user.id, { name: "rotate-key", limit: 3, windowSec: 3600 });
  if (!rl.allowed) return NextResponse.json({ error: true, code: "RATE_LIMITED", resetSec: rl.resetSec }, { status: 429, headers: { "Retry-After": String(rl.resetSec) } });

  const encryptionKey = process.env.AES_256_ENCRYPTION_KEY;
  if (!encryptionKey) return NextResponse.json({ error: true, code: "SERVER_ERROR" }, { status: 500 });

  const kp = generateEd25519Keypair();
  const privateKeyEncrypted = encrypt(kp.privateKey, encryptionKey);

  await db.update(tenants).set({
    ed25519PublicKey: kp.publicKey,
    ed25519PrivateKeyEncrypted: privateKeyEncrypted,
    ed25519RotatedAt: new Date(),
    ed25519KeyId: randomUUID(),
  }).where(eq(tenants.id, id));

  await writeAuditLog({
    tenantId: id,
    actorUserId: sessionUser.user.id,
    actorEmail: sessionUser.user.email,
    action: "regenerate_secret",  // reuse existing audit action category
    oldValue: "[REDACTED]",
    newValue: "[REDACTED]",
    metadata: { reason: "ed25519-keypair-rotation" },
  });

  return NextResponse.json({ data: { publicKey: kp.publicKey, rotatedAt: new Date().toISOString() } });
}
```

**Step 4: Tests**

Add `nextlib-cloud/src/app/api/v1/tenants/[id]/rotate-keypair/route.test.ts` with 4 tests:
- 401 when no session
- 403 when not owner
- 429 when rate limited
- 200 + new publicKey in response + DB updated + audit log written

**Step 5: Commit**

```bash
git add nextlib-cloud/src/components/tenant/connection-editor.tsx nextlib-cloud/src/app/(dashboard)/koneksi/page.tsx nextlib-cloud/src/app/api/v1/tenants/[id]/rotate-keypair/route.ts nextlib-cloud/src/app/api/v1/tenants/[id]/rotate-keypair/route.test.ts
git commit -m "feat(cloud): rotate-keypair endpoint + UI for key rotation"
```

---

### Task 8: Cleanup — drop the HMAC secret-hash header

After a deprecation window (e.g., one release cycle), remove HMAC fallback from the plugin. SaaS no longer sends `X-NextLib-Token` or `X-NextLib-Secret-Hash`; plugin only verifies Ed25519.

**Files:**
- Modify: `nextlib-agent/middleware/TokenValidator.php` (remove the HMAC branch)
- Modify: `nextlib-agent/nextlib-agent.plugin.php` (remove `NEXTLIB_TOKEN_SECRET` from `.env` template)
- Modify: `nextlib-cloud/src/app/api/v1/tenants/[id]/agent-zip/route.ts` (no longer generate the random secret)
- Modify: `nextlib-cloud/src/lib/db/schema.ts` (drop `apiSecretEncrypted` and `tokenHash` columns — needs a new migration)

**This task runs only after:**
1. All tenants have generated Ed25519 keypairs (check by `ed25519PublicKey IS NOT NULL` count == total tenants)
2. No incoming traffic with the old HMAC headers for ≥ 7 days (check access logs)

**Step 1: Add a guard in the plugin**

In `nextlib-agent/middleware/TokenValidator.php`, before removing HMAC, log a deprecation warning when HMAC is used:

```php
// In the HMAC branch:
error_log('NextLib-Agent: deprecated HMAC token used by tenant — please rotate to Ed25519.');
```

**Step 2: Wait the deprecation window**

Confirm with the user that no HMAC traffic has been seen in the last 7 days, then run:

```bash
git grep -l "X-NextLib-Secret-Hash\|apiSecretEncrypted\|tokenHash" nextlib-agent/ nextlib-cloud/src/
```

Expected: zero matches after the cleanup. If any remain, delete them.

**Step 3: Drop the columns**

Add a new Drizzle migration:

```bash
cd .worktrees/ed25519-auth/nextlib-cloud && npm run db:generate
# Inspect: should be ALTER TABLE tenants DROP COLUMN api_secret_encrypted, DROP COLUMN token_hash
cat drizzle/0006_*.sql
```

Apply via `db:push` or via deploy (RUN_MIGRATIONS=1).

**Step 4: Drop the HMAC branch from TokenValidator**

```php
// Replace the entire handle() method with just the Ed25519 path
public static function handle(string $publicKeyBase64, callable $callback, int $tokenMaxAge = 300): void
{
    $headers = function_exists('getallheaders') ? array_change_key_case(getallheaders(), CASE_LOWER) : [];
    $timestamp = $headers['x-nextlib-timestamp'] ?? null;
    $signature = $headers['x-nextlib-signature'] ?? null;
    if ($timestamp === null || $signature === null) {
        self::respond(401, 'MISSING_AUTH');
        return;
    }
    $body = file_get_contents('php://input') ?: '';
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    if (!Ed25519Verifier::verify($publicKeyBase64, $signature, $timestamp, $_SERVER['REQUEST_METHOD'] ?? 'GET', $path, $body, $tokenMaxAge)) {
        self::respond(401, 'INVALID_SIGNATURE');
        return;
    }
    $callback($body);
}
```

**Step 5: Run all tests**

```bash
cd .worktrees/ed25519-auth/nextlib-cloud && npx vitest run
cd .worktrees/ed25519-auth/nextlib-agent && ./vendor/bin/phpunit
```

Expected: all green.

**Step 6: Commit**

```bash
cd /Volumes/Kerjaan/vibe-code/nextlib-platform/.worktrees/ed25519-auth
git add -A
git commit -m "refactor: drop HMAC fallback, Ed25519 only"
```

---

### Task 9: Docs — update INSTALL.md and README

**Files:**
- Modify: `nextlib-agent/INSTALL.md`
- Modify: `nextlib-cloud/docs/ops/security.md` (create if missing)

**Step 1: Rewrite INSTALL.md to describe Ed25519**

Replace the security section with:

```markdown
# Security

NextLib-Agent v2.0.0+ uses **Ed25519 signature-based authentication** instead
of shared-secret HMAC tokens.

## What the plugin stores
- `NEXTLIB_PUBLIC_KEY` — a 32-byte Ed25519 public key (base64). **Not secret.**
- (legacy v1.x: `NEXTLIB_TOKEN_SECRET` — still accepted for backward compat,
  will be removed in a future release)

## What the plugin does NOT store
- Any private key. The private key never leaves NextLib-Cloud.

## Key rotation
- SaaS → Tenant settings → **Rotate Keypair**
- This generates a new keypair, persists it encrypted, and invalidates the old public key
- Plugin must be re-downloaded (new `.env` with new public key) to keep working
- Old signed requests fail with 401 immediately after rotation
```

**Step 2: Add security.md to SaaS docs**

`nextlib-cloud/docs/ops/security.md`:

```markdown
# Security: NextLib-Agent ↔ NextLib-Cloud authentication

## Threat model
The SLiMS plugin runs on the campus server, which we do not control.
A shared-secret auth model (HMAC) requires the secret to be on both sides —
meaning a leak on the campus side compromises every other campus.

We use **Ed25519 asymmetric signatures** instead:
- The private key never leaves NextLib-Cloud.
- The plugin only holds the public key (not sensitive — verifying-only).
- Key rotation is one-click and does not invalidate the SaaS-side.

## Signing protocol
Each request from SaaS to SLiMS plugin carries two headers:

| Header | Format | Example |
|---|---|---|
| `X-NextLib-Timestamp` | Unix seconds | `1700000000` |
| `X-NextLib-Signature` | base64 64-byte Ed25519 signature | `…` |

Signed message: `${timestamp}.${METHOD}.${path}.${body}` (UTF-8 bytes).
Verification: ed25519 verify detached with the tenant's public key.

**Timestamp window**: 300 seconds (replay protection).

## Key storage
- SaaS stores the private key AES-256-GCM-encrypted in Postgres
- Encryption key: `AES_256_ENCRYPTION_KEY` (set via Coolify env)
- Public key stored as plain text (not sensitive)

## Rotation
```bash
# SaaS UI: Tenant → Settings → Rotate Keypair
# Or via API:
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://nextlib.example.com/api/v1/tenants/$TENANT_ID/rotate-keypair
```

Old public key becomes invalid immediately. Plugin must re-download to keep working.
```

**Step 3: Commit**

```bash
cd /Volumes/Kerjaan/vibe-code/nextlib-platform/.worktrees/ed25519-auth
git add nextlib-agent/INSTALL.md nextlib-cloud/docs/ops/security.md
git commit -m "docs: Ed25519 auth, key rotation, threat model"
```

---

## Verification matrix (run after all tasks)

| Test | Expected |
|---|---|
| `curl -H "X-NextLib-Timestamp: …" -H "X-NextLib-Signature: …" /api/v1/nextlib/health` (valid) | 200 JSON |
| `curl -H "X-NextLib-Timestamp: <expired>" /api/v1/nextlib/health` | 401 INVALID_SIGNATURE |
| `curl` without auth headers | 401 MISSING_AUTH |
| `curl` with HMAC token (legacy) | 200 (during deprecation) / 401 (after Task 8) |
| SaaS dashboard → Test Koneksi | ✅ Connected |
| SaaS dashboard → Sync data | 200, no 401 |
| Rotate keypair, then test old plugin | 401 (expected: needs re-download) |

## Out of scope (deferred)

- **mTLS** as an alternative transport (more complex, not needed when request signing works)
- **Per-tenant scoped access tokens** (no use case yet)
- **Webhook signature verification** (SaaS → 3rd party, not in scope)

---

## Rollback plan

If Ed25519 has a problem in production, the plugin keeps the HMAC fallback (Task 4). To re-enable HMAC for a specific tenant:

1. SaaS → Tenant settings → "Issue legacy HMAC token" button (adds `apiSecretEncrypted` + `tokenHash` if missing)
2. Re-download plugin — `.env` now has both `NEXTLIB_TOKEN_SECRET` and `NEXTLIB_PUBLIC_KEY`
3. Plugin falls back to HMAC if Ed25519 headers missing

After 7 days of HMAC traffic going to a tenant, treat as deprecation complete; remove the fallback in Task 8.

---

## Total estimated effort

| Phase | Tasks | Time |
|---|---|---|
| Phase 1 — SaaS keypair | 1-3 | 1.5 h |
| Phase 2 — Plugin verifier | 4-5 | 1.0 h |
| Phase 3 — UI + rotate | 6-7 | 1.0 h |
| Phase 4 — Cleanup + docs | 8-9 | 0.5 h (after deprecation window) |
| **Total** | **9 tasks** | **~4 hours active + 7-day deprecation wait** |
