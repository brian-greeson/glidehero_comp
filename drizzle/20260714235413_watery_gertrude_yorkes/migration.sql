ALTER TABLE "user_grid_claims" DROP CONSTRAINT "user_grid_claims_pkey";--> statement-breakpoint
ALTER TABLE "user_grid_claims" ADD PRIMARY KEY ("claim_user","cell_size","x","y","claim_flight");