ALTER TABLE "tenants" ADD COLUMN "last_pull_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "last_pull_status" varchar(20);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "last_pull_error" text;