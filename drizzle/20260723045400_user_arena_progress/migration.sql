CREATE TABLE "user_arena_progress" (
	"user_id" uuid,
	"arena_id" uuid,
	"claimed_cell_count" integer DEFAULT 0 NOT NULL,
	"visited" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_arena_progress_pkey" PRIMARY KEY("user_id","arena_id"),
	CONSTRAINT "user_arena_progress_claimed_cell_count_nonnegative" CHECK ("claimed_cell_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "user_arena_progress_arena_id_claimed_cell_count_idx" ON "user_arena_progress" ("arena_id","claimed_cell_count") WHERE "claimed_cell_count" > 0;--> statement-breakpoint
ALTER TABLE "user_arena_progress" ADD CONSTRAINT "user_arena_progress_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_arena_progress" ADD CONSTRAINT "user_arena_progress_arena_id_arenas_id_fkey" FOREIGN KEY ("arena_id") REFERENCES "arenas"("id") ON DELETE CASCADE;