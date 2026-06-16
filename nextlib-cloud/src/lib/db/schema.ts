import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  date,
  integer,
  uniqueIndex,
  index,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";

/**
 * Tenants table — one record per registered institution (kampus).
 * All tenant-specific data references this table via tenant_id.
 */
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).unique().notNull(),
  slimsBaseUrl: text("slims_base_url").notNull(),
  apiSecretEncrypted: text("api_secret_encrypted").notNull(), // AES-256 encrypted
  tokenHash: varchar("token_hash", { length: 64 }).notNull(), // For quick token lookup
  status: varchar("status", { length: 20 }).default("pending").notNull(), // pending, connected, disconnected
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Daily aggregate statistics table — stores non-PII daily stats per tenant.
 * Indexed by tenant_id for strict data isolation.
 */
export const dailyStats = pgTable(
  "daily_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    date: date("date").notNull(),
    visitorCount: integer("visitor_count").default(0).notNull(),
    loanCount: integer("loan_count").default(0).notNull(),
    returnCount: integer("return_count").default(0).notNull(),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
  },
  (table) => [
    // Unique constraint: one record per tenant per day
    uniqueIndex("uq_daily_stats_tenant_date").on(table.tenantId, table.date),
    // Index for tenant isolation queries
    index("idx_daily_stats_tenant").on(table.tenantId),
    // Composite index for date-range queries scoped to tenant
    index("idx_daily_stats_tenant_date").on(table.tenantId, table.date),
  ]
);

// Type exports for use throughout the application
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type DailyStat = typeof dailyStats.$inferSelect;
export type NewDailyStat = typeof dailyStats.$inferInsert;

/**
 * Daily aggregate statistics table v2 — stores non-PII daily stats v2 per tenant.
 */
export const dailyStatsV2 = pgTable(
  "daily_stats_v2",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    date: date("date").notNull(),
    visitorCount: integer("visitor_count").default(0).notNull(),
    uniqueVisitorCount: integer("unique_visitor_count").default(0).notNull(),
    loanCount: integer("loan_count").default(0).notNull(),
    returnCount: integer("return_count").default(0).notNull(),
    newMemberCount: integer("new_member_count").default(0).notNull(),
    newBiblioCount: integer("new_biblio_count").default(0).notNull(),
    newItemCount: integer("new_item_count").default(0).notNull(),
    finesDebetTotal: integer("fines_debet_total").default(0).notNull(),
    finesCreditTotal: integer("fines_credit_total").default(0).notNull(),
    reservationCount: integer("reservation_count").default(0).notNull(),
    totalCollectionSize: integer("total_collection_size").default(0).notNull(),
    activeMemberCount: integer("active_member_count").default(0).notNull(),
    activeOverdueCount: integer("active_overdue_count").default(0).notNull(),
    anomalyFlags: text("anomaly_flags").array().notNull().default([]),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("uq_daily_stats_v2_tenant_date").on(table.tenantId, table.date),
    index("idx_daily_stats_v2_tenant").on(table.tenantId),
    index("idx_daily_stats_v2_tenant_date").on(table.tenantId, table.date),
  ]
);

export type DailyStatV2 = typeof dailyStatsV2.$inferSelect;
export type NewDailyStatV2 = typeof dailyStatsV2.$inferInsert;

// ─── Modul C: WhatsApp Integration Tables ────────────────────────────────────

/**
 * WhatsApp sessions — tracks connected WA devices per tenant.
 * Each tenant can have at most 1 active WhatsApp session.
 */
export const whatsappSessions = pgTable(
  "whatsapp_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    phoneNumber: varchar("phone_number", { length: 20 }),
    deviceId: varchar("device_id", { length: 100 }), // Gowa device JID (e.g. 628xxx@s.whatsapp.net)
    status: varchar("status", { length: 20 }).default("pending_qr").notNull(), // pending_qr, connected, disconnected
    connectedAt: timestamp("connected_at"),
    disconnectedAt: timestamp("disconnected_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // One session per tenant
    uniqueIndex("uq_wa_sessions_tenant").on(table.tenantId),
    index("idx_wa_sessions_status").on(table.status),
  ]
);

export type WhatsappSession = typeof whatsappSessions.$inferSelect;
export type NewWhatsappSession = typeof whatsappSessions.$inferInsert;

/**
 * Knowledge base — FAQ/document entries per tenant for AI context.
 * Used by the LLM intent classifier to answer frequently asked questions.
 */
export const knowledgeBase = pgTable(
  "knowledge_base",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    title: varchar("title", { length: 255 }).notNull(),
    content: text("content").notNull(),
    category: varchar("category", { length: 100 }), // e.g. "jam_buka", "aturan", "layanan"
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_kb_tenant").on(table.tenantId),
    index("idx_kb_tenant_active").on(table.tenantId, table.isActive),
  ]
);

export type KnowledgeBaseEntry = typeof knowledgeBase.$inferSelect;
export type NewKnowledgeBaseEntry = typeof knowledgeBase.$inferInsert;

/**
 * WhatsApp message log — anonymized message metrics only (NO PII content).
 * Stores direction, intent type, and response time for analytics.
 * Compliant with UU PDP (NFR-1): no chat text is stored.
 */
export const waMessageLog = pgTable(
  "wa_message_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    direction: varchar("direction", { length: 10 }).notNull(), // 'incoming' | 'outgoing'
    intentType: varchar("intent_type", { length: 30 }), // 'faq' | 'circulation' | 'greeting' | 'unknown'
    processedAt: timestamp("processed_at").defaultNow().notNull(),
    responseTimeMs: integer("response_time_ms"), // Time taken to process and respond
  },
  (table) => [
    index("idx_wa_log_tenant").on(table.tenantId),
    index("idx_wa_log_processed").on(table.processedAt),
    index("idx_wa_log_tenant_date").on(table.tenantId, table.processedAt),
  ]
);

export type WaMessageLogEntry = typeof waMessageLog.$inferSelect;
export type NewWaMessageLogEntry = typeof waMessageLog.$inferInsert;


/**
 * Users table — central registry of platform users (Super Admins, Tenant Admins, Librarians).
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).unique().notNull(),
    passwordHash: text("password_hash").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    role: varchar("role", { length: 20 }).default("tenant_admin").notNull(), // super_admin, tenant_admin, librarian
    tenantId: uuid("tenant_id")
      .references(() => tenants.id), // Nullable for super_admin
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_users_email").on(table.email),
    index("idx_users_tenant").on(table.tenantId),
  ]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/**
 * Sessions table — stores active sessions for users.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(), // Also the session token
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_sessions_user").on(table.userId),
  ]
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

// ─── Backfill Jobs ────────────────────────────────────────────────────────────
/**
 * Tracks cloud-driven historical data backfill jobs.
 *
 * A tenant admin triggers a backfill from the dashboard (e.g. "import last 2
 * years"). The API inserts a row here with status `pending` and enqueues a
 * BullMQ job. The worker iterates the date range, calling the agent's
 * `trigger_export` endpoint per date, and updates this row as it progresses.
 * The dashboard polls `GET /api/v1/backfill/status` to render progress.
 */
export const backfillJobs = pgTable(
  "backfill_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    /** pending | running | completed | failed | cancelled */
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    dateStart: date("date_start").notNull(),
    dateEnd: date("date_end").notNull(),
    totalDays: integer("total_days").notNull(),
    processedDays: integer("processed_days").default(0).notNull(),
    failedDays: integer("failed_days").default(0).notNull(),
    lastProcessedDate: date("last_processed_date"),
    lastError: text("last_error"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_backfill_jobs_tenant").on(table.tenantId),
    index("idx_backfill_jobs_status").on(table.status),
  ]
);

export type BackfillJob = typeof backfillJobs.$inferSelect;
export type NewBackfillJob = typeof backfillJobs.$inferInsert;

// ─── Tenant Audit Log ────────────────────────────────────────────────────────
/**
 * Append-only audit log of every configuration change made to a tenant.
 * Used for security review, debugging, and compliance.
 *
 *   - `tenant_id` cascades on tenant deletion (logs don't outlive the tenant).
 *   - `actor_user_id` is nullable and `SET NULL` on user deletion — logs
 *     outlive the user; we keep `actor_email` denormalized for that case.
 *   - No `updatedAt`: this table is insert-only by design.
 */
export const tenantAuditLogs = pgTable(
  "tenant_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorEmail: text("actor_email").notNull(),
    action: varchar("action", { length: 40 }).notNull(),
    fieldName: varchar("field_name", { length: 40 }),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_audit_tenant_created").on(
      table.tenantId,
      table.createdAt.desc()
    ),
    index("idx_audit_actor").on(table.actorUserId, table.createdAt.desc()),
  ]
);

export type TenantAuditLog = typeof tenantAuditLogs.$inferSelect;
export type NewTenantAuditLog = typeof tenantAuditLogs.$inferInsert;




