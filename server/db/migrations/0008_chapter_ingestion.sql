ALTER TYPE "public"."pipeline_stage" ADD VALUE 'extracting';--> statement-breakpoint
ALTER TYPE "public"."pipeline_stage" ADD VALUE 'sorting';--> statement-breakpoint
ALTER TYPE "public"."pipeline_stage" ADD VALUE 'validating_images';--> statement-breakpoint
ALTER TYPE "public"."pipeline_stage" ADD VALUE 'optimizing_images';--> statement-breakpoint
ALTER TYPE "public"."pipeline_stage" ADD VALUE 'uploading';--> statement-breakpoint
ALTER TYPE "public"."pipeline_stage" ADD VALUE 'creating_records';--> statement-breakpoint
ALTER TABLE "chapter_pages" ADD COLUMN "original_filename" varchar(512);--> statement-breakpoint
ALTER TABLE "chapter_pages" ADD COLUMN "content_hash" varchar(64);
