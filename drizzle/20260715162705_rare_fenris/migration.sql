CREATE TABLE "launches" (
	"id" bigint PRIMARY KEY,
	"name" text NOT NULL,
	"longitude" double precision NOT NULL,
	"latitude" double precision NOT NULL,
	"country" text NOT NULL,
	"state" text NOT NULL,
	"city" text NOT NULL,
	"description" text NOT NULL,
	"xc_by_month" text NOT NULL,
	"timezone_offset" integer NOT NULL,
	"xc_by_year" text NOT NULL,
	"rank" integer NOT NULL,
	"elevation" integer DEFAULT 0 NOT NULL,
	"rank_1" integer NOT NULL,
	"rank_2" integer NOT NULL,
	"rank_3" integer NOT NULL,
	"rank_4" integer NOT NULL,
	"rank_5" integer NOT NULL,
	"rank_6" integer NOT NULL,
	"rank_7" integer NOT NULL,
	"rank_8" integer NOT NULL,
	"rank_9" integer NOT NULL,
	"rank_10" integer NOT NULL,
	"rank_11" integer NOT NULL,
	"rank_12" integer NOT NULL,
	"xcontest_launch_site" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "launches_name_idx" ON "launches" ("name");--> statement-breakpoint
CREATE INDEX "launches_country_idx" ON "launches" ("country");--> statement-breakpoint
CREATE INDEX "launches_state_idx" ON "launches" ("state");--> statement-breakpoint
CREATE INDEX "launches_xcontest_launch_site_idx" ON "launches" ("xcontest_launch_site");