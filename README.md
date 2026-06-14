# NextLib Platform

Hybrid SaaS platform bridging [SLiMS](https://www.slims.web.id/) (Senayan Library Management System) with modern automation, AI librarian, federated search, and accreditation analytics — built on a **Privacy-First Architecture** that keeps PII on-campus and only aggregates anonymized stats to the cloud.

> **Status:** In active development (Sprint 1–2). See [`prd.md`](./prd.md) for the full product spec.

---

## Repository layout

This is a **monorepo** with two deployable modules plus shared infrastructure:

```
nextlib-platform/
├── nextlib-cloud/     # Central SaaS server (Next.js 16 + Drizzle + PostgreSQL + BullMQ)
├── nextlib-agent/     # SLiMS plugin (PHP 7.4+) installed in the campus's plugins/ folder
├── docker-compose.yml # Local dev stack: Postgres + Redis + Gowa (WA engine) + app + worker
└── prd.md             # Product Requirements Document
```

### Modules

| Module | Stack | Role |
| --- | --- | --- |
| **nextlib-cloud** | Next.js 16, React 19, Drizzle ORM, PostgreSQL, Redis, BullMQ, OpenAI-compatible LLM | Multi-tenant SaaS: dashboard analytics, API router to SLiMS, WhatsApp AI librarian, federated search |
| **nextlib-agent** | PHP 7.4+ plugin (zero core modification) | Registers HMAC-protected API endpoints on SLiMS and exports daily aggregate stats to the cloud |

---

## Quick start (local dev)

### Prerequisites

- Docker + Docker Compose v2
- Node 20+ and PHP 8.0+ (only if running modules outside Docker)

### 1. Configure local secrets

```bash
cp docker-compose.override.yml.example docker-compose.override.yml
# Edit docker-compose.override.yml and replace the REPLACE_WITH_ placeholders:
#   AES_256_ENCRYPTION_KEY   → openssl rand -hex 32
#   WHATSAPP_WEBHOOK_SECRET  → openssl rand -hex 24
#   NEXTAUTH_SECRET          → openssl rand -hex 32
```

`docker-compose.override.yml` is gitignored — it holds real secrets and is never committed.

### 2. Boot the stack

```bash
docker compose up -d
```

This starts:

- `db` (Postgres 16) on `:5432`
- `redis` (Redis 7) on `:6379`
- `gowa` (go-whatsapp-web-multidevice) on `:3010`
- `app` (Next.js dev server) on `:3000`
- `worker` (BullMQ consumer for WA messages)

### 3. Seed the database (dev only)

Visit `http://localhost:3000/api/v1/auth/seed` once to create the default tenant + users. The response includes the dev login credentials.

### 4. Run tests

```bash
# Cloud (Next.js)
cd nextlib-cloud && npm test

# Agent (PHP)
cd nextlib-agent && composer test
```

---

## Architecture notes

- **Privacy-First (UU PDP compliant):** PII (names, NIM, loan history) never leaves the campus SLiMS DB. Only anonymized daily aggregates are pushed to the cloud.
- **Agent ↔ Cloud auth:** HMAC-SHA256 tokens with 5-minute expiry, validated both ways.
- **Tenant isolation:** Every DB table carries `tenant_id`; all queries go through `withTenantScope()`.
- **Secrets at rest:** tenant credentials (SLiMS base URL, API secret) are AES-256-GCM encrypted in Postgres.

See [`prd.md`](./prd.md) for the complete specification (modules A–E, NFRs, sprint plan).
