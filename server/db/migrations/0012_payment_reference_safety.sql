ALTER TABLE "payment_records" ADD COLUMN "submitted_reference" varchar(128);--> statement-breakpoint
UPDATE "payment_records" SET "submitted_reference" = "external_reference", "external_reference" = NULL WHERE "status" = 'pending' AND "external_reference" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_records_pending_user_plan_uq" ON "payment_records" USING btree ("user_id", "plan") WHERE "payment_records"."status" = 'pending';--> statement-breakpoint
