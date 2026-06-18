# Plugin v2.1.0 Deployment Guide

> **Goal:** Replace production SLiMS plugin v2.0.0 with v2.1.0 (includes new `/daily-aggregate` endpoint for SaaS pull).

## What's new in v2.1.0

| File | Change |
|---|---|
| `endpoints/DailyAggregate.php` | **NEW** — returns daily metrics for date range in v2 schema |
| `nextlib-agent.plugin.php` | **MODIFIED** — registers `POST /v1/nextlib/daily-aggregate` route |
| `lib/Plugin.php` | **MODIFIED** — adds `handleDailyAggregate()` (HMAC-protected) |
| `composer.json` | **MODIFIED** — autoload entry for `DailyAggregate.php` |

## Step-by-step (via aaPanel or SSH)

### Option A: via aaPanel File Manager (easiest)

1. **Login ke aaPanel** → File Manager → navigate to `/www/wwwroot/opac-pustakalaya.usbypkp.ac.id/plugins/`
2. **Upload** the new ZIP (`nextlib-agent-v2.1.0.zip`, 75KB) to the `plugins/` directory
3. **Delete** the existing `nextlib-agent/` directory (or just the conflicting files)
4. **Extract** the ZIP in place — should create `nextlib-agent/` with new files
5. **SSH ke server**, run:
   ```bash
   cd /www/wwwroot/opac-pustakalaya.usbypkp.ac.id/plugins/nextlib-agent
   composer dump-autoload
   sudo chown -R www:www /www/wwwroot/opac-pustakalaya.usbypkp.ac.id/plugins/nextlib-agent
   ```
6. **Verify** the new file:
   ```bash
   ls endpoints/DailyAggregate.php  # should exist
   grep daily-aggregate nextlib-agent.plugin.php  # should show route registration
   ```

### Option B: via SSH (with extracted files already on server)

The ZIP is already uploaded to `/tmp/upload/nextlib-agent-v2.1.0.zip`. Run as `bowo` user:

```bash
# 1. chown the existing plugin dir to bowo so we can write
echo 'Sr1d3v1@#14' | sudo -S chown -R bowo /www/wwwroot/opac-pustakalaya.usbypkp.ac.id/plugins/nextlib-agent

# 2. Extract new code (overwrites existing files)
cd /www/wwwroot/opac-pustakalaya.usbypkp.ac.id/plugins/
unzip -oq /tmp/upload/nextlib-agent-v2.1.0.zip

# 3. Re-dump autoload so DailyAggregate class is loadable
cd nextlib-agent
composer dump-autoload

# 4. Restore www ownership
echo 'Sr1d3v1@#14' | sudo -S chown -R www:www /www/wwwroot/opac-pustakalaya.usbypkp.ac.id/plugins/nextlib-agent

# 5. Verify
ls endpoints/DailyAggregate.php
grep daily-aggregate nextlib-agent.plugin.php
```

## Step 2 — Activate plugin in SLiMS

### Option A: via SLiMS Admin UI
1. Login ke SLiMS admin: `https://opac-pustakalaya.usbypkp.ac.id/admin`
2. Go to **System → Plugins** (or equivalent path)
3. Find `nextlib-agent` in the list, click **Activate**

### Option B: via SQL (if UI is not accessible)
```bash
mysql --socket=/tmp/mysql.sock -u sql_library_usby -p'243ceb2cfadac' sql_library_usby

# First check the actual table name (might be 'plugin' or 'plugins')
SHOW TABLES LIKE '%plugin%';
DESCRIBE plugin;
DESCRIBE plugins;

# If table is 'plugin' (no s), insert/update:
INSERT INTO plugin (plugin_name, plugin_path, plugin_code, plugin_enabled, plugin_version)
VALUES ('nextlib-agent', 'nextlib-agent', 'nextlib', 1, '2.1.0')
ON DUPLICATE KEY UPDATE plugin_enabled=1, plugin_version='2.1.0';
```

> The earlier diagnostic showed `Unknown column 'plugin_name' in 'field list'` — so the table is `plugin` (singular) with different column names. Check with `DESCRIBE plugin` first.

## Step 3 — Verify the new endpoint works

Get the token + secret hash from the .env:
```bash
cat /www/wwwroot/opac-pustakalaya.usbypkp.ac.id/plugins/nextlib-agent/.env
# Note: NEXTLIB_TOKEN_SECRET, NEXTLIB_PUBLIC_KEY, NEXTLIB_TENANT_ID
```

Test the endpoint:
```bash
# From the SLiMS server itself:
curl -X POST -H 'X-NextLib-Token: <hmac_token>' -H 'X-NextLib-Secret-Hash: <hash>' \
  -H 'Content-Type: application/json' \
  -d '{"start_date":"2024-12-01","end_date":"2024-12-07"}' \
  http://localhost/api/v1/nextlib/daily-aggregate
```

Expected response: HTTP 200 + JSON with `days` array.

If you see a 404 with SLiMS HTML, the plugin route isn't registered → check `nextlib-agent.plugin.php`.

If you see a 401, HMAC signature is wrong → check the .env values match what's in SaaS tenant.

## Step 4 — Verify SaaS scheduled pull works

After SaaS is deployed (Task 10), wait until 02:00 UTC the next day, then:
```sql
SELECT id, last_pull_at, last_pull_status, LEFT(last_pull_error, 200)
FROM tenants
WHERE last_pull_at IS NOT NULL
ORDER BY last_pull_at DESC
LIMIT 5;
```

Expected: `last_pull_at` is recent, `last_pull_status = 'ok'`.

## After 1 week of stable pulls → Phase 2 cleanup

1. Delete `cron.php` from plugin
2. Delete `exporter/` directory from plugin
3. Delete `lib/HttpClient.php` (push client, no longer used)
4. Bump version to 3.0.0 (breaking change for tenants that depend on cron)
5. Update `INSTALL.md` to reflect pull-only architecture
