ALTER TABLE "translation_jobs" ALTER COLUMN "stage" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "translation_jobs" ALTER COLUMN "stage" SET DATA TYPE text USING "stage"::text;--> statement-breakpoint
UPDATE "translation_jobs" SET "stage" = CASE
  WHEN "status" = 'failed' THEN 'failed'
  WHEN "status" IN ('queued', 'cancelled') THEN 'queued'
  WHEN "stage" IN ('extracting', 'sorting', 'validating_images', 'optimizing_images', 'uploading', 'creating_records') THEN 'processing_images'
  WHEN "stage" = 'context_building' THEN 'translating'
  WHEN "stage" = 'optimizing' THEN 'typesetting'
  ELSE "stage"
END;--> statement-breakpoint
DROP TYPE "public"."pipeline_stage";--> statement-breakpoint
CREATE TYPE "public"."pipeline_stage" AS ENUM('queued', 'validating', 'processing_images', 'ocr', 'translating', 'cleaning', 'typesetting', 'qa', 'ready', 'published', 'failed');--> statement-breakpoint
ALTER TABLE "translation_jobs" ALTER COLUMN "stage" SET DEFAULT 'queued'::"public"."pipeline_stage";--> statement-breakpoint
ALTER TABLE "translation_jobs" ALTER COLUMN "stage" SET DATA TYPE "public"."pipeline_stage" USING "stage"::"public"."pipeline_stage";--> statement-breakpoint
CREATE TABLE "translation_job_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL REFERENCES "translation_jobs"("id") ON DELETE CASCADE,
  "attempt" integer NOT NULL,
  "stage" "public"."pipeline_stage" NOT NULL,
  "level" varchar(12) DEFAULT 'info' NOT NULL,
  "message" varchar(500) NOT NULL,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "translation_job_logs_level" CHECK ("level" in ('info', 'warning', 'error'))
);--> statement-breakpoint
CREATE INDEX "translation_job_logs_job_idx" ON "translation_job_logs" USING btree ("job_id", "created_at");
