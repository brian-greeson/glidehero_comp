CREATE TYPE "arena_type" AS ENUM('launch', 'general', 'state', 'country');--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "arena_type" "arena_type" DEFAULT 'general'::"arena_type" NOT NULL;--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "country_code" text;--> statement-breakpoint
UPDATE "arenas"
SET "country_code" = CASE "country"
  WHEN 'Austria' THEN 'AT'
  WHEN 'Brazil' THEN 'BR'
  WHEN 'Canada' THEN 'CA'
  WHEN 'Colombia' THEN 'CO'
  WHEN 'Czechia' THEN 'CZ'
  WHEN 'France' THEN 'FR'
  WHEN 'Germany' THEN 'DE'
  WHEN 'India' THEN 'IN'
  WHEN 'Italy' THEN 'IT'
  WHEN 'Liechtenstein' THEN 'LI'
  WHEN 'Mexico' THEN 'MX'
  WHEN 'Portugal' THEN 'PT'
  WHEN 'Slovenia' THEN 'SI'
  WHEN 'Spain' THEN 'ES'
  WHEN 'Switzerland' THEN 'CH'
  WHEN 'United Kingdom' THEN 'GB'
  WHEN 'United States' THEN 'US'
  ELSE NULL
END;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "arenas" WHERE "country_code" IS NULL) THEN
    RAISE EXCEPTION 'Arena classification migration aborted: unsupported Arena country';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "arenas" ALTER COLUMN "country_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "claimable_cell_count" bigint;--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "claimable_cell_size" integer;--> statement-breakpoint
ALTER TABLE "arenas" ADD CONSTRAINT "arenas_country_code_iso2_check" CHECK ("country_code" ~ '^[A-Z]{2}$');
