CREATE TABLE "flight_scores" (
	"flight_id" uuid PRIMARY KEY,
	"total_distance_meters" double precision NOT NULL,
	"total_distance_calc_version" integer DEFAULT 1 NOT NULL,
	"total_distance_metadata" jsonb NOT NULL,
	"six_point_distance_meters" double precision NOT NULL,
	"six_point_distance_calc_version" integer DEFAULT 1 NOT NULL,
	"six_point_distance_metadata" jsonb NOT NULL,
	CONSTRAINT "flight_scores_total_distance_meters_nonnegative" CHECK ("total_distance_meters" >= 0),
	CONSTRAINT "flight_scores_total_distance_calc_version_positive" CHECK ("total_distance_calc_version" > 0),
	CONSTRAINT "flight_scores_six_point_distance_meters_nonnegative" CHECK ("six_point_distance_meters" >= 0),
	CONSTRAINT "flight_scores_six_point_distance_calc_version_positive" CHECK ("six_point_distance_calc_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "flight_scores" ADD CONSTRAINT "flight_scores_flight_id_flights_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("flight_id") ON DELETE CASCADE;