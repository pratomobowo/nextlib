CREATE TABLE "knowledge_base" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"category" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_message_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"direction" varchar(10) NOT NULL,
	"intent_type" varchar(30),
	"processed_at" timestamp DEFAULT now() NOT NULL,
	"response_time_ms" integer
);
--> statement-breakpoint
CREATE TABLE "whatsapp_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"phone_number" varchar(20),
	"device_id" varchar(100),
	"status" varchar(20) DEFAULT 'pending_qr' NOT NULL,
	"connected_at" timestamp,
	"disconnected_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_message_log" ADD CONSTRAINT "wa_message_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_kb_tenant" ON "knowledge_base" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_kb_tenant_active" ON "knowledge_base" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_wa_log_tenant" ON "wa_message_log" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_wa_log_processed" ON "wa_message_log" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "idx_wa_log_tenant_date" ON "wa_message_log" USING btree ("tenant_id","processed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wa_sessions_tenant" ON "whatsapp_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_wa_sessions_status" ON "whatsapp_sessions" USING btree ("status");