CREATE TABLE "competition_grid_claims" (
	"competition_month" date,
	"cell_size" integer,
	"x" integer,
	"y" integer,
	"claim_flight" uuid,
	"claim_user" uuid NOT NULL,
	"claim_timestamp" timestamp with time zone NOT NULL,
	CONSTRAINT "competition_grid_claims_pkey" PRIMARY KEY("competition_month","cell_size","x","y","claim_flight")
);
--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "content_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "launch_timezone" text;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_content_hash_unique" UNIQUE("content_hash");--> statement-breakpoint
CREATE INDEX "competition_grid_claims_month_cell_timestamp_idx" ON "competition_grid_claims" ("competition_month","cell_size","x","y","claim_timestamp");--> statement-breakpoint
CREATE INDEX "competition_grid_claims_cell_history_idx" ON "competition_grid_claims" ("cell_size","x","y","competition_month","claim_timestamp");--> statement-breakpoint
CREATE INDEX "competition_grid_claims_claim_flight_idx" ON "competition_grid_claims" ("claim_flight");--> statement-breakpoint
ALTER TABLE "competition_grid_claims" ADD CONSTRAINT "competition_grid_claims_claim_flight_flights_flight_id_fkey" FOREIGN KEY ("claim_flight") REFERENCES "flights"("flight_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "competition_grid_claims" ADD CONSTRAINT "competition_grid_claims_claim_user_users_user_id_fkey" FOREIGN KEY ("claim_user") REFERENCES "users"("user_id") ON DELETE CASCADE;