ALTER TABLE "tenants" ADD COLUMN "ed25519_public_key" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ed25519_private_key_encrypted" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ed25519_rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ed25519_key_id" text;