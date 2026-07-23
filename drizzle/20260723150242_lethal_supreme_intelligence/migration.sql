ALTER TABLE "flight_scores" ADD COLUMN "three_point_distance_meters" double precision;--> statement-breakpoint
ALTER TABLE "flight_scores" ADD COLUMN "three_point_distance_calc_version" integer;--> statement-breakpoint
ALTER TABLE "flight_scores" ADD COLUMN "three_point_distance_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "flight_scores" ADD COLUMN "four_point_distance_meters" double precision;--> statement-breakpoint
ALTER TABLE "flight_scores" ADD COLUMN "four_point_distance_calc_version" integer;--> statement-breakpoint
ALTER TABLE "flight_scores" ADD COLUMN "four_point_distance_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "flight_scores" ADD COLUMN "five_point_distance_meters" double precision;--> statement-breakpoint
ALTER TABLE "flight_scores" ADD COLUMN "five_point_distance_calc_version" integer;--> statement-breakpoint
ALTER TABLE "flight_scores" ADD COLUMN "five_point_distance_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "flight_scores" ADD CONSTRAINT "flight_scores_three_point_distance_meters_nonnegative" CHECK ("three_point_distance_meters" >= 0);--> statement-breakpoint
ALTER TABLE "flight_scores" ADD CONSTRAINT "flight_scores_three_point_distance_calc_version_positive" CHECK ("three_point_distance_calc_version" > 0);--> statement-breakpoint
ALTER TABLE "flight_scores" ADD CONSTRAINT "flight_scores_three_point_distance_complete" CHECK ((
        "three_point_distance_meters" IS NULL
        AND "three_point_distance_calc_version" IS NULL
        AND "three_point_distance_metadata" IS NULL
      ) OR (
        "three_point_distance_meters" IS NOT NULL
        AND "three_point_distance_calc_version" IS NOT NULL
        AND "three_point_distance_metadata" IS NOT NULL
      ));--> statement-breakpoint
ALTER TABLE "flight_scores" ADD CONSTRAINT "flight_scores_four_point_distance_meters_nonnegative" CHECK ("four_point_distance_meters" >= 0);--> statement-breakpoint
ALTER TABLE "flight_scores" ADD CONSTRAINT "flight_scores_four_point_distance_calc_version_positive" CHECK ("four_point_distance_calc_version" > 0);--> statement-breakpoint
ALTER TABLE "flight_scores" ADD CONSTRAINT "flight_scores_four_point_distance_complete" CHECK ((
        "four_point_distance_meters" IS NULL
        AND "four_point_distance_calc_version" IS NULL
        AND "four_point_distance_metadata" IS NULL
      ) OR (
        "four_point_distance_meters" IS NOT NULL
        AND "four_point_distance_calc_version" IS NOT NULL
        AND "four_point_distance_metadata" IS NOT NULL
      ));--> statement-breakpoint
ALTER TABLE "flight_scores" ADD CONSTRAINT "flight_scores_five_point_distance_meters_nonnegative" CHECK ("five_point_distance_meters" >= 0);--> statement-breakpoint
ALTER TABLE "flight_scores" ADD CONSTRAINT "flight_scores_five_point_distance_calc_version_positive" CHECK ("five_point_distance_calc_version" > 0);--> statement-breakpoint
ALTER TABLE "flight_scores" ADD CONSTRAINT "flight_scores_five_point_distance_complete" CHECK ((
        "five_point_distance_meters" IS NULL
        AND "five_point_distance_calc_version" IS NULL
        AND "five_point_distance_metadata" IS NULL
      ) OR (
        "five_point_distance_meters" IS NOT NULL
        AND "five_point_distance_calc_version" IS NOT NULL
        AND "five_point_distance_metadata" IS NOT NULL
      ));