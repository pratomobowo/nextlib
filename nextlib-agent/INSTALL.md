# NextLib-Agent Install Guide

Auto-generated per tenant by NextLib-Cloud.

## Install (3 steps)

1. Login to your SLiMS admin panel
2. Navigate to **Admin → Plugins**
3. Click **"Upload"** and select `nextlib-agent/` (or the entire ZIP)
4. SLiMS extracts the plugin to `plugins/nextlib-agent/`
5. Click **"Activate"** next to the new NextLib-Agent entry

That's it. The plugin reads its config from the pre-baked `.env` shipped
in the ZIP — no manual edits needed.

## Security

NextLib-Agent v2.0.0+ uses **Ed25519 signature-based authentication** instead
of shared-secret HMAC tokens.

### What the plugin stores
- `NEXTLIB_PUBLIC_KEY` — a 32-byte Ed25519 public key (base64). **Not secret.**
- (legacy v1.x: `NEXTLIB_TOKEN_SECRET` — still accepted for backward compat,
  will be removed in a future release)

### What the plugin does NOT store
- Any private key. The private key never leaves NextLib-Cloud.

### Key rotation
- SaaS → Tenant settings → **Rotate Keypair**
- This generates a new keypair, persists it encrypted, and invalidates the old public key
- Plugin must be re-downloaded (new `.env` with new public key) to keep working
- Old signed requests fail with 401 immediately after rotation

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| 401 INVALID_SIGNATURE on test-connection | Public key mismatch — re-download plugin ZIP |
| 401 MISSING_AUTH | Plugin not activated, or `.env` missing NEXTLIB_PUBLIC_KEY |
| Plugin not visible in /api/v1/nextlib/health | SLiMS routing — check .htaccess rewrite rule for api/v1/* |
| Plugin activated but no data flows | Cloudflare blocking — add WAF skip rule for /api/v1/nextlib/* |
