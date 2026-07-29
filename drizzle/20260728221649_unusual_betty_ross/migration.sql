ALTER TYPE "bulk_import_phase" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TYPE "upload_batch_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "user_workflow_state" ADD COLUMN "dirty_revision" integer DEFAULT 0 NOT NULL;