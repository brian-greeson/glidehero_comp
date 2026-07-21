CREATE TABLE "donations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"message_id" text NOT NULL CONSTRAINT "donations_message_id_unique" UNIQUE,
	"kofi_transaction_id" text,
	"payment_timestamp" timestamp with time zone NOT NULL,
	"payment_type" text NOT NULL,
	"amount" numeric(12,2) NOT NULL,
	"currency" text NOT NULL,
	"is_public" boolean NOT NULL,
	"is_subscription_payment" boolean NOT NULL,
	"is_first_subscription_payment" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donations_amount_nonnegative" CHECK ("amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX "donations_kofi_transaction_id_idx" ON "donations" ("kofi_transaction_id");