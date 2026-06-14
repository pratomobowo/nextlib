FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Development target (with hot-reloading)
FROM base AS development
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Production builder
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production runner (Next.js web server)
FROM base AS runner
WORKDIR /app
ENV NODE_ENV production
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
EXPOSE 3000
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"
CMD ["npm", "run", "start"]

# WhatsApp worker (BullMQ consumer for incoming messages).
# Shares the same dependencies as the web server but runs src/worker.ts via
# tsx instead of `next start`. It does NOT serve HTTP, so no PORT is exposed.
# Connect to the same Redis and PostgreSQL instances as the web server.
FROM base AS worker
WORKDIR /app
ENV NODE_ENV production
COPY package.json package-lock.json* ./
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY src ./src
CMD ["npm", "run", "worker:prod"]
