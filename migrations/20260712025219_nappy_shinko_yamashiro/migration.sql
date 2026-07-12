CREATE TABLE "app_sessions" (
	"session_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_follows" (
	"source_profile_id" uuid,
	"followed_profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "profile_follows_pkey" PRIMARY KEY("source_profile_id","followed_profile_id")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid UNIQUE,
	"display_name" text NOT NULL,
	"handedness" text,
	"avatar_url" text,
	"created_by_user_id" uuid,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_passwords" (
	"user_id" uuid PRIMARY KEY,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"apple_subject" text UNIQUE,
	"email" text,
	"last_login" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "app_sessions_user_id_idx" ON "app_sessions" ("user_id");--> statement-breakpoint
CREATE INDEX "profile_follows_source_profile_id_idx" ON "profile_follows" ("source_profile_id");--> statement-breakpoint
CREATE INDEX "profile_follows_followed_profile_id_idx" ON "profile_follows" ("followed_profile_id");--> statement-breakpoint
CREATE INDEX "profiles_user_id_idx" ON "profiles" ("user_id");--> statement-breakpoint
CREATE INDEX "profiles_created_by_user_id_idx" ON "profiles" ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "passwords_user_id_idx" ON "user_passwords" ("user_id");--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "profile_follows" ADD CONSTRAINT "profile_follows_source_profile_id_profiles_id_fkey" FOREIGN KEY ("source_profile_id") REFERENCES "profiles"("id");--> statement-breakpoint
ALTER TABLE "profile_follows" ADD CONSTRAINT "profile_follows_followed_profile_id_profiles_id_fkey" FOREIGN KEY ("followed_profile_id") REFERENCES "profiles"("id");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_created_by_user_id_users_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("user_id");--> statement-breakpoint
ALTER TABLE "user_passwords" ADD CONSTRAINT "user_passwords_user_id_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;