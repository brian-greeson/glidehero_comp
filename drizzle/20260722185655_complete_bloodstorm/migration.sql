CREATE TABLE "user_achievement_progress" (
	"user_id" uuid PRIMARY KEY,
	"lifetime_unique_cell_count" integer DEFAULT 0 NOT NULL,
	"launch_arenas_visited" integer DEFAULT 0 NOT NULL,
	"general_arenas_explored" integer DEFAULT 0 NOT NULL,
	"states_flown_in" integer DEFAULT 0 NOT NULL,
	"countries_flown_in" integer DEFAULT 0 NOT NULL,
	"best_general_arena_id" uuid,
	"best_general_claimed_cell_count" integer DEFAULT 0 NOT NULL,
	"best_general_claimable_cell_count" integer DEFAULT 0 NOT NULL,
	"projection_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_achievement_progress_lifetime_unique_cell_count_nonnegative" CHECK ("lifetime_unique_cell_count" >= 0),
	CONSTRAINT "user_achievement_progress_launch_arenas_visited_nonnegative" CHECK ("launch_arenas_visited" >= 0),
	CONSTRAINT "user_achievement_progress_general_arenas_explored_nonnegative" CHECK ("general_arenas_explored" >= 0),
	CONSTRAINT "user_achievement_progress_states_flown_in_nonnegative" CHECK ("states_flown_in" >= 0),
	CONSTRAINT "user_achievement_progress_countries_flown_in_nonnegative" CHECK ("countries_flown_in" >= 0),
	CONSTRAINT "user_achievement_progress_best_general_claimed_cell_count_nonnegative" CHECK ("best_general_claimed_cell_count" >= 0),
	CONSTRAINT "user_achievement_progress_best_general_claimable_cell_count_nonnegative" CHECK ("best_general_claimable_cell_count" >= 0),
	CONSTRAINT "user_achievement_progress_best_general_claimed_not_above_claimable" CHECK ("best_general_claimable_cell_count" = 0 OR "best_general_claimed_cell_count" <= "best_general_claimable_cell_count"),
	CONSTRAINT "user_achievement_progress_projection_version_positive" CHECK ("projection_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "user_achievement_progress" ADD CONSTRAINT "user_achievement_progress_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_achievement_progress" ADD CONSTRAINT "user_achievement_progress_best_general_arena_id_arenas_id_fkey" FOREIGN KEY ("best_general_arena_id") REFERENCES "arenas"("id") ON DELETE SET NULL;