ALTER TABLE "chapter_pages" ADD COLUMN "ocr_status" varchar(16) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_pages" ADD COLUMN "ocr_error" varchar(500);--> statement-breakpoint
ALTER TABLE "chapter_pages" ADD COLUMN "edit_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_pages" ADD COLUMN "rendered_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_pages" ADD COLUMN "render_status" varchar(16) DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_pages" ADD COLUMN "render_error" varchar(500);--> statement-breakpoint
ALTER TABLE "translation_jobs" ADD COLUMN "workflow" varchar(16) DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "translation_segments" ADD COLUMN "corrected_source_text" text;--> statement-breakpoint
ALTER TABLE "translation_segments" ADD COLUMN "detected_language" varchar(16);--> statement-breakpoint
ALTER TABLE "translation_segments" ADD COLUMN "origin" varchar(8) DEFAULT 'ocr' NOT NULL;--> statement-breakpoint
ALTER TABLE "translation_segments" ADD COLUMN "translation_status" varchar(16) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "translation_segments" ADD COLUMN "typeset_status" varchar(16) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "translation_segments" ADD COLUMN "style" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "translation_jobs_workflow_idx" ON "translation_jobs" USING btree ("workflow","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "chapter_pages" ADD CONSTRAINT "chapter_pages_ocr_status" CHECK ("chapter_pages"."ocr_status" in ('pending', 'done', 'failed'));--> statement-breakpoint
ALTER TABLE "chapter_pages" ADD CONSTRAINT "chapter_pages_render_status" CHECK ("chapter_pages"."render_status" in ('idle', 'queued', 'rendering', 'failed'));--> statement-breakpoint
ALTER TABLE "translation_jobs" ADD CONSTRAINT "translation_jobs_workflow" CHECK ("translation_jobs"."workflow" in ('ai', 'manual'));--> statement-breakpoint
ALTER TABLE "translation_segments" ADD CONSTRAINT "translation_segments_translation_status" CHECK ("translation_segments"."translation_status" in ('pending', 'draft', 'translated', 'approved', 'failed'));--> statement-breakpoint
ALTER TABLE "translation_segments" ADD CONSTRAINT "translation_segments_typeset_status" CHECK ("translation_segments"."typeset_status" in ('pending', 'rendered', 'needs_review', 'accepted', 'failed'));--> statement-breakpoint
ALTER TABLE "translation_segments" ADD CONSTRAINT "translation_segments_origin" CHECK ("translation_segments"."origin" in ('ocr', 'manual'));