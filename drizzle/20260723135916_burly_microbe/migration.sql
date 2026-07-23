ALTER TABLE "flight_scores" ALTER COLUMN "six_point_distance_meters" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "flight_scores" ALTER COLUMN "six_point_distance_calc_version" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "flight_scores" ALTER COLUMN "six_point_distance_calc_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "flight_scores" ALTER COLUMN "six_point_distance_metadata" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "flight_scores" ADD CONSTRAINT "flight_scores_six_point_distance_complete" CHECK ((
        "six_point_distance_meters" IS NULL
        AND "six_point_distance_calc_version" IS NULL
        AND "six_point_distance_metadata" IS NULL
      ) OR (
        "six_point_distance_meters" IS NOT NULL
        AND "six_point_distance_calc_version" IS NOT NULL
        AND "six_point_distance_metadata" IS NOT NULL
      ));