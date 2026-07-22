CREATE TABLE "pilot_follows" (
	"follower_user_id" uuid,
	"followed_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pilot_follows_pkey" PRIMARY KEY("follower_user_id","followed_user_id"),
	CONSTRAINT "pilot_follows_no_self_follow" CHECK ("follower_user_id" <> "followed_user_id")
);
--> statement-breakpoint
CREATE INDEX "pilot_follows_follower_user_id_idx" ON "pilot_follows" ("follower_user_id");--> statement-breakpoint
CREATE INDEX "pilot_follows_followed_user_id_idx" ON "pilot_follows" ("followed_user_id");--> statement-breakpoint
ALTER TABLE "pilot_follows" ADD CONSTRAINT "pilot_follows_follower_user_id_users_user_id_fkey" FOREIGN KEY ("follower_user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pilot_follows" ADD CONSTRAINT "pilot_follows_followed_user_id_users_user_id_fkey" FOREIGN KEY ("followed_user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;