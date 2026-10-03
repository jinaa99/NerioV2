CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "series_tags" (
	"series_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "series_tags_series_id_tag_id_pk" PRIMARY KEY("series_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "alt_titles" varchar(300)[] DEFAULT '{}'::varchar[] NOT NULL;--> statement-breakpoint
UPDATE "series" SET "alt_titles" = ARRAY["alt_title"] WHERE "alt_title" IS NOT NULL AND btrim("alt_title") <> '';--> statement-breakpoint
ALTER TABLE "series_tags" ADD CONSTRAINT "series_tags_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_tags" ADD CONSTRAINT "series_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "series_tags_tag_idx" ON "series_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "series_title_trgm_idx" ON "series" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "series_author_trgm_idx" ON "series" USING gin ("author" gin_trgm_ops);