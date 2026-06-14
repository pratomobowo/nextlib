CREATE TABLE "daily_stats_v2" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"visitor_count" integer DEFAULT 0 NOT NULL,
	"unique_visitor_count" integer DEFAULT 0 NOT NULL,
	"loan_count" integer DEFAULT 0 NOT NULL,
	"return_count" integer DEFAULT 0 NOT NULL,
	"new_member_count" integer DEFAULT 0 NOT NULL,
	"new_biblio_count" integer DEFAULT 0 NOT NULL,
	"new_item_count" integer DEFAULT 0 NOT NULL,
	"fines_debet_total" integer DEFAULT 0 NOT NULL,
	"fines_credit_total" integer DEFAULT 0 NOT NULL,
	"reservation_count" integer DEFAULT 0 NOT NULL,
	"total_collection_size" integer DEFAULT 0 NOT NULL,
	"active_member_count" integer DEFAULT 0 NOT NULL,
	"active_overdue_count" integer DEFAULT 0 NOT NULL,
	"anomaly_flags" text[] DEFAULT '{}' NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_stats_v2" ADD CONSTRAINT "daily_stats_v2_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_daily_stats_v2_tenant_date" ON "daily_stats_v2" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "idx_daily_stats_v2_tenant" ON "daily_stats_v2" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_daily_stats_v2_tenant_date" ON "daily_stats_v2" USING btree ("tenant_id","date");