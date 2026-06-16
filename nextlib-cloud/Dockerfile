FROM node:20-alpine AS base
# netcat-openbsd is used by docker-entrypoint.sh to wait for Postgres before
# running migrations (avoids the boot-order crash that caused restart loops).
RUN apk add --no-cache libc6-compat netcat-openbsd
WORKDIR /app

# Install dependencies (build context is repo root, so the package.json lives
# inside nextlib-cloud/).
COPY nextlib-cloud/package.json nextlib-cloud/package-lock.json* ./
RUN npm ci

# Development target (with hot-reloading)
FROM base AS development
WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY nextlib-cloud/ ./
# Include the plugin source so docker exec + test scripts can use it
COPY nextlib-agent ./nextlib-agent
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Production builder
FROM base AS builder
WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY nextlib-cloud/ ./
# The SaaS /agent-zip endpoint bundles nextlib-agent/ into a per-tenant ZIP
# at request time, so the plugin source must be in the image. Place it at
# /app/nextlib-agent so process.cwd() + '/nextlib-agent' resolves to it.
COPY nextlib-agent ./nextlib-agent
RUN npm run build

# Production runner (Next.js web server)
FROM base AS runner
WORKDIR /app
ENV NODE_ENV production
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
# Migrations + drizzle-kit config + entrypoint: let the container auto-migrate
# on boot (docker-entrypoint.sh runs `drizzle-kit migrate` before next start).
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
# Operational CLI scripts (db:seed, seed-analytics, recompute-anomalies,
# sync-from-slims) — invoked via `docker exec <app> npm run <script>`.
# These scripts use tsx to run .ts directly and import from src/, so we
# also need to ship the source tree (tsx compiles it on the fly).
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src ./src
# Plugin source (consumed by the SaaS /agent-zip endpoint — bundles the
# plugin into a per-tenant ZIP with a pre-baked .env).
COPY --from=builder /app/nextlib-agent ./nextlib-agent
COPY nextlib-cloud/tsconfig.json ./
COPY nextlib-cloud/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
EXPOSE 3000
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "run", "start"]

# WhatsApp worker (BullMQ consumer for incoming messages).
# Shares the same dependencies as the web server but runs src/worker.ts via
# tsx instead of `next start`. It does NOT serve HTTP, so no PORT is exposed.
# Connect to the same Redis and PostgreSQL instances as the web server.
FROM base AS worker
WORKDIR /app
ENV NODE_ENV production
COPY nextlib-cloud/package.json nextlib-cloud/package-lock.json* ./
COPY --from=base /app/node_modules ./node_modules
COPY nextlib-cloud/tsconfig.json ./
COPY nextlib-cloud/src ./src
# Worker also needs drizzle config + migrations so its entrypoint can migrate.
COPY nextlib-cloud/drizzle ./drizzle
COPY nextlib-cloud/drizzle.config.ts ./drizzle.config.ts
COPY nextlib-cloud/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "run", "worker:prod"]
