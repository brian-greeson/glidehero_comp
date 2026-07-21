CREATE TYPE "arena_leadership_event_type" AS ENUM('took', 'reclaimed', 'lost');--> statement-breakpoint
CREATE TABLE "arena_current_leaders" (
	"arena_id" uuid,
	"user_id" uuid,
	"cells_claimed" integer NOT NULL,
	"took_lead_at" timestamp with time zone NOT NULL,
	"decisive_source_flight_id" uuid,
	"decisive_cell_size" integer NOT NULL,
	"decisive_cell_x" integer NOT NULL,
	"decisive_cell_y" integer NOT NULL,
	CONSTRAINT "arena_current_leaders_pkey" PRIMARY KEY("arena_id","user_id"),
	CONSTRAINT "arena_current_leaders_cells_claimed_positive" CHECK ("cells_claimed" > 0),
	CONSTRAINT "arena_current_leaders_decisive_cell_size_positive" CHECK ("decisive_cell_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "arena_leadership_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"event_key" text NOT NULL CONSTRAINT "arena_leadership_events_event_key_unique" UNIQUE,
	"arena_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" "arena_leadership_event_type" NOT NULL,
	"claim_timestamp" timestamp with time zone NOT NULL,
	"source_flight_id" uuid,
	"cell_size" integer NOT NULL,
	"cell_x" integer NOT NULL,
	"cell_y" integer NOT NULL,
	CONSTRAINT "arena_leadership_events_cell_size_positive" CHECK ("cell_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "arena_leadership_states" (
	"arena_id" uuid PRIMARY KEY,
	"arena_type" "arena_type" NOT NULL,
	"leading_cell_count" integer DEFAULT 0 NOT NULL,
	"next_rank_cell_count" integer DEFAULT 0 NOT NULL,
	"last_reconciled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reconciliation_key" text,
	CONSTRAINT "arena_leadership_states_eligible_arena_type_check" CHECK ("arena_type" IN ('general', 'state', 'country')),
	CONSTRAINT "arena_leadership_states_leading_cell_count_nonnegative" CHECK ("leading_cell_count" >= 0),
	CONSTRAINT "arena_leadership_states_next_rank_cell_count_nonnegative" CHECK ("next_rank_cell_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "arenas" ADD CONSTRAINT "arenas_id_arena_type_unique" UNIQUE("id","arena_type");--> statement-breakpoint
CREATE INDEX "arena_current_leaders_user_id_took_lead_at_idx" ON "arena_current_leaders" ("user_id","took_lead_at");--> statement-breakpoint
CREATE INDEX "arena_current_leaders_arena_id_took_lead_at_idx" ON "arena_current_leaders" ("arena_id","took_lead_at");--> statement-breakpoint
CREATE INDEX "arena_leadership_events_arena_id_claim_timestamp_idx" ON "arena_leadership_events" ("arena_id","claim_timestamp");--> statement-breakpoint
CREATE INDEX "arena_leadership_events_arena_id_user_id_claim_timestamp_idx" ON "arena_leadership_events" ("arena_id","user_id","claim_timestamp");--> statement-breakpoint
CREATE INDEX "arena_leadership_events_source_flight_id_idx" ON "arena_leadership_events" ("source_flight_id");--> statement-breakpoint
CREATE INDEX "arena_leadership_states_arena_type_idx" ON "arena_leadership_states" ("arena_type");--> statement-breakpoint
ALTER TABLE "arena_current_leaders" ADD CONSTRAINT "arena_current_leaders_5yQZydzKtITF_fkey" FOREIGN KEY ("arena_id") REFERENCES "arena_leadership_states"("arena_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "arena_current_leaders" ADD CONSTRAINT "arena_current_leaders_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "arena_current_leaders" ADD CONSTRAINT "arena_current_leaders_UxtTXkabWXx5_fkey" FOREIGN KEY ("decisive_source_flight_id") REFERENCES "flights"("flight_id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "arena_leadership_events" ADD CONSTRAINT "arena_leadership_events_6PlqmHmHoUXs_fkey" FOREIGN KEY ("arena_id") REFERENCES "arena_leadership_states"("arena_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "arena_leadership_events" ADD CONSTRAINT "arena_leadership_events_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "arena_leadership_events" ADD CONSTRAINT "arena_leadership_events_source_flight_id_flights_flight_id_fkey" FOREIGN KEY ("source_flight_id") REFERENCES "flights"("flight_id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "arena_leadership_states" ADD CONSTRAINT "arena_leadership_states_arena_id_arena_type_fkey" FOREIGN KEY ("arena_id","arena_type") REFERENCES "arenas"("id","arena_type") ON DELETE CASCADE;