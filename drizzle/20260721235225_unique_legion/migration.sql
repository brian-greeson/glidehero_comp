ALTER TABLE "competition_grid_claims" DROP CONSTRAINT IF EXISTS "competition_grid_claims_pkey";--> statement-breakpoint
ALTER TABLE "user_grid_claims" DROP CONSTRAINT IF EXISTS "user_grid_claims_pkey";--> statement-breakpoint
DROP INDEX IF EXISTS "user_grid_claims_claim_user_cell_size_idx";--> statement-breakpoint
ALTER TABLE "competition_grid_claims" DROP COLUMN "cell_size";--> statement-breakpoint
ALTER TABLE "user_grid_claims" DROP COLUMN "cell_size";--> statement-breakpoint
ALTER TABLE "competition_grid_claims" ADD PRIMARY KEY ("competition_month","x","y","claim_flight");--> statement-breakpoint
ALTER TABLE "user_grid_claims" ADD PRIMARY KEY ("claim_user","x","y","claim_flight");--> statement-breakpoint
DROP INDEX IF EXISTS "competition_grid_claims_month_cell_timestamp_idx";--> statement-breakpoint
CREATE INDEX "competition_grid_claims_month_cell_timestamp_idx" ON "competition_grid_claims" ("competition_month","x","y","claim_timestamp");--> statement-breakpoint
DROP INDEX IF EXISTS "competition_grid_claims_cell_history_idx";--> statement-breakpoint
CREATE INDEX "competition_grid_claims_cell_history_idx" ON "competition_grid_claims" ("x","y","competition_month","claim_timestamp");--> statement-breakpoint
CREATE INDEX "user_grid_claims_claim_user_idx" ON "user_grid_claims" ("claim_user");--> statement-breakpoint
