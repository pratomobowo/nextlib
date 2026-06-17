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
Verification: Ed25519 verify-detached with the tenant's public key.

**Timestamp window**: 300 seconds (replay protection).

### Cross-language implementation

The signature format is the same on both sides:

- **SaaS (Node.js)**: `crypto.generateKeyPairSync('ed25519')` →
  32-byte raw seed → PKCS8 DER wrap → `crypto.sign(null, msg, key)`
- **Plugin (PHP)**: `sodium_crypto_sign_keypair()` →
  `sodium_crypto_sign_publickey($kp)` + `sodium_crypto_sign_verify_detached($sig, $msg, $pk)`

Both produce 64-byte detached signatures. Both use 32-byte raw public keys.

## Key storage

- SaaS stores the private key AES-256-GCM-encrypted in Postgres
  (`ed25519_private_key_encrypted` column on `tenants` table)
- Encryption key: `AES_256_ENCRYPTION_KEY` (set via Coolify env)
- Public key stored as plain text (`ed25519_public_key` column — not sensitive)
- Keypair UUID + rotation timestamp stored for audit correlation
  (`ed25519_key_id`, `ed25519_rotated_at`)

## Rotation

```bash
# SaaS UI: Tenant → Settings → Rotate Keypair
# Or via API:
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://nextlib.example.com/api/v1/tenants/$TENANT_ID/rotate-keypair
```

Old public key becomes invalid immediately. Plugin must re-download to keep working.

Rate-limited to 3 rotations per hour per user to prevent accidental DoS.

## Deprecation window (legacy HMAC)

The plugin still accepts HMAC tokens (`X-NextLib-Token` + `X-NextLib-Secret-Hash`)
for backward compatibility. After a 7-day deprecation window:
- Remove the HMAC path from `middleware/TokenValidator.php`
- Drop `NEXTLIB_TOKEN_SECRET` from the per-tenant `.env`
- Drop `api_secret` from `config.php`

See `docs/plans/2026-06-17-ed25519-auth-implementation.md` Task 8 for details.

## Out of scope (deferred)

- **mTLS** as an alternative transport (more complex, not needed when request signing works)
- **Per-tenant scoped access tokens** (no use case yet)
- **Webhook signature verification** (SaaS → 3rd party, not in scope)
