CREATE TABLE "daily_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"visitor_count" integer DEFAULT 0 NOT NULL,
	"loan_count" integer DEFAULT 0 NOT NULL,
	"return_count" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"slims_base_url" text NOT NULL,
	"api_secret_encrypted" text NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "daily_stats" ADD CONSTRAINT "daily_stats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_daily_stats_tenant_date" ON "daily_stats" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "idx_daily_stats_tenant" ON "daily_stats" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_daily_stats_tenant_date" ON "daily_stats" USING btree ("tenant_id","date");