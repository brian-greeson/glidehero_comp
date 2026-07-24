ALTER TABLE "flights" ADD COLUMN "glider_hours_credited_seconds" integer;--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "glider_hours_generation" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "glider_manufacturer" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "glider_model" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "glider_size" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "glider_year" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "glider_competition_id" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "glider_en_rating" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "glider_hours_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "glider_hours_generation" integer DEFAULT 0 NOT NULL;
