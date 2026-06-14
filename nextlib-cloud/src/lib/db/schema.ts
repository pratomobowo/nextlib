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



