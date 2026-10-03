ALTER TABLE "chapter_pages" ADD COLUMN "output_bytes" integer;--> statement-breakpoint
ALTER TABLE "chapter_pages" ADD COLUMN "visual_qa_flags" jsonb DEFAULT '[]'::jsonb NOT NULL;
