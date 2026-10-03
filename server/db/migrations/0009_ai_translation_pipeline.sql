ALTER TABLE "translation_segments" ADD COLUMN "processing_status" varchar(24) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "translation_segments" ADD COLUMN "ocr_confidence" real;--> statement-breakpoint
ALTER TABLE "translation_segments" ADD COLUMN "translation_confidence" real;--> statement-breakpoint
ALTER TABLE "translation_segments" ADD COLUMN "qa_flags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "translation_segments" SET "ocr_confidence" = "confidence", "translation_confidence" = "confidence", "processing_status" = CASE WHEN "translated_text" IS NULL THEN 'ocr_complete' ELSE 'complete' END;
--> statement-breakpoint
ALTER TABLE "translation_jobs" ALTER COLUMN "target_language" SET DEFAULT 'mn';
--> statement-breakpoint
ALTER TYPE "public"."pipeline_stage" ADD VALUE 'context_building';
