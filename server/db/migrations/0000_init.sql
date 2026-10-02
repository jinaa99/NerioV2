CREATE TYPE "public"."chapter_access" AS ENUM('free', 'early_access');--> statement-breakpoint
CREATE TYPE "public"."chapter_status" AS ENUM('draft', 'processing', 'in_review', 'ready', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'failed', 'ready', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('new_chapter', 'payment_confirmed', 'payment_rejected', 'report_update', 'system');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('bank_transfer');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'confirmed', 'rejected', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."pipeline_stage" AS ENUM('validating', 'ocr', 'translating', 'cleaning', 'typesetting', 'optimizing', 'qa', 'ready', 'published');--> statement-breakpoint
CREATE TYPE "public"."premium_plan" AS ENUM('1m', '3m', '12m');--> statement-breakpoint
CREATE TYPE "public"."role_key" AS ENUM('reader', 'translator', 'editor', 'admin');--> statement-breakpoint
CREATE TYPE "public"."segment_kind" AS ENUM('speech', 'narration', 'sfx', 'sign', 'other');--> statement-breakpoint
CREATE TYPE "public"."segment_review" AS ENUM('pending', 'approved', 'edited', 'flagged');--> statement-breakpoint
CREATE TYPE "public"."series_status" AS ENUM('draft', 'ongoing', 'completed', 'hiatus');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"username" varchar(32) NOT NULL,
	"display_name" varchar(64) NOT NULL,
	"avatar_url" text,
	"bio" varchar(500),
	"locale" varchar(16) DEFAULT 'en' NOT NULL,
	"reader_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"email_on_new_chapter" boolean DEFAULT true NOT NULL,
	"show_activity" boolean DEFAULT false NOT NULL,
	"premium_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_username_format" CHECK ("profiles"."username" ~ '^[A-Za-z0-9_.]{3,32}$')
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" "role_key" NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" text,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapter_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"source_key" text NOT NULL,
	"output_key" text,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapter_pages_page_positive" CHECK ("chapter_pages"."page_number" > 0),
	CONSTRAINT "chapter_pages_dimensions" CHECK ("chapter_pages"."width" > 0 and "chapter_pages"."height" > 0)
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"number" numeric(7, 2) NOT NULL,
	"title" varchar(200),
	"status" "chapter_status" DEFAULT 'draft' NOT NULL,
	"access" "chapter_access" DEFAULT 'free' NOT NULL,
	"free_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"page_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapters_number_positive" CHECK ("chapters"."number" >= 0)
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"native_name" varchar(120),
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text,
	"voice_notes" text,
	"image_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "genres" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"hue" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "genres_slug_unique" UNIQUE("slug"),
	CONSTRAINT "genres_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "glossary_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"source_term" varchar(200) NOT NULL,
	"target_term" varchar(200) NOT NULL,
	"notes" text,
	"case_sensitive" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(96) NOT NULL,
	"title" varchar(200) NOT NULL,
	"alt_title" varchar(300),
	"description" text DEFAULT '' NOT NULL,
	"author" varchar(120) NOT NULL,
	"artist" varchar(120),
	"status" "series_status" DEFAULT 'draft' NOT NULL,
	"source_language" varchar(16) DEFAULT 'ko' NOT NULL,
	"cover_key" text,
	"cover_hue" smallint DEFAULT 40 NOT NULL,
	"rating_avg" numeric(3, 2) DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"view_count" bigint DEFAULT 0 NOT NULL,
	"follower_count" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "series_slug_unique" UNIQUE("slug"),
	CONSTRAINT "series_slug_format" CHECK ("series"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "series_cover_hue_range" CHECK ("series"."cover_hue" between 0 and 360),
	CONSTRAINT "series_rating_range" CHECK ("series"."rating_avg" between 0 and 5)
);
--> statement-breakpoint
CREATE TABLE "series_genres" (
	"series_id" uuid NOT NULL,
	"genre_id" uuid NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "series_genres_series_id_genre_id_pk" PRIMARY KEY("series_id","genre_id")
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"user_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookmarks_user_id_series_id_pk" PRIMARY KEY("user_id","series_id")
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"user_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"notify" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_user_id_series_id_pk" PRIMARY KEY("user_id","series_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text,
	"href" varchar(500),
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_href_relative" CHECK ("notifications"."href" is null or "notifications"."href" ~ '^/([^/\\]|$)')
);
--> statement-breakpoint
CREATE TABLE "reading_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reading_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"first_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reading_progress" (
	"user_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"page_number" integer DEFAULT 1 NOT NULL,
	"percent" smallint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_progress_user_id_series_id_pk" PRIMARY KEY("user_id","series_id"),
	CONSTRAINT "reading_progress_percent_range" CHECK ("reading_progress"."percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "translation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"stage" "pipeline_stage" DEFAULT 'validating' NOT NULL,
	"stage_progress" smallint DEFAULT 0 NOT NULL,
	"source_language" varchar(16) NOT NULL,
	"target_language" varchar(16) DEFAULT 'en' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"error_code" varchar(64),
	"error_message" text,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requested_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translation_jobs_progress_range" CHECK ("translation_jobs"."stage_progress" between 0 and 100),
	CONSTRAINT "translation_jobs_attempt_positive" CHECK ("translation_jobs"."attempt" > 0)
);
--> statement-breakpoint
CREATE TABLE "translation_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" "segment_kind" DEFAULT 'speech' NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"w" real NOT NULL,
	"h" real NOT NULL,
	"source_text" text NOT NULL,
	"translated_text" text,
	"confidence" real,
	"warning" text,
	"review_status" "segment_review" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translation_segments_box" CHECK ("translation_segments"."x" between 0 and 1 and "translation_segments"."y" between 0 and 1 and "translation_segments"."w" > 0 and "translation_segments"."w" <= 1 and "translation_segments"."h" > 0 and "translation_segments"."h" <= 1),
	CONSTRAINT "translation_segments_confidence_range" CHECK ("translation_segments"."confidence" is null or "translation_segments"."confidence" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "payment_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan" "premium_plan" NOT NULL,
	"period_days" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"method" "payment_method" DEFAULT 'bank_transfer' NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"reference_code" varchar(32) NOT NULL,
	"external_reference" varchar(128),
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_records_referenceCode_unique" UNIQUE("reference_code"),
	CONSTRAINT "payment_records_amount_positive" CHECK ("payment_records"."amount_cents" > 0),
	CONSTRAINT "payment_records_period_positive" CHECK ("payment_records"."period_days" > 0),
	CONSTRAINT "payment_records_currency_upper" CHECK ("payment_records"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_records_period_order" CHECK ("payment_records"."period_end" is null or "payment_records"."period_end" > "payment_records"."period_start")
);
--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_id" uuid,
	"action" varchar(64) NOT NULL,
	"target_type" varchar(64) NOT NULL,
	"target_id" varchar(64),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_pages" ADD CONSTRAINT "chapter_pages_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glossary_terms" ADD CONSTRAINT "glossary_terms_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glossary_terms" ADD CONSTRAINT "glossary_terms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_genres" ADD CONSTRAINT "series_genres_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_genres" ADD CONSTRAINT "series_genres_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_history" ADD CONSTRAINT "reading_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_history" ADD CONSTRAINT "reading_history_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_history" ADD CONSTRAINT "reading_history_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_jobs" ADD CONSTRAINT "translation_jobs_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_jobs" ADD CONSTRAINT "translation_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_segments" ADD CONSTRAINT "translation_segments_job_id_translation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."translation_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_segments" ADD CONSTRAINT "translation_segments_page_id_chapter_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."chapter_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_segments" ADD CONSTRAINT "translation_segments_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_username_lower_uq" ON "profiles" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_pages_chapter_page_uq" ON "chapter_pages" USING btree ("chapter_id","page_number");--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_series_number_uq" ON "chapters" USING btree ("series_id","number");--> statement-breakpoint
CREATE INDEX "chapters_series_published_idx" ON "chapters" USING btree ("series_id","published_at");--> statement-breakpoint
CREATE INDEX "chapters_status_idx" ON "chapters" USING btree ("status");--> statement-breakpoint
CREATE INDEX "chapters_published_at_idx" ON "chapters" USING btree ("published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "characters_series_name_uq" ON "characters" USING btree ("series_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "glossary_terms_series_source_uq" ON "glossary_terms" USING btree ("series_id","source_term");--> statement-breakpoint
CREATE INDEX "series_status_published_idx" ON "series" USING btree ("status","published_at");--> statement-breakpoint
CREATE INDEX "series_views_idx" ON "series" USING btree ("view_count");--> statement-breakpoint
CREATE INDEX "series_genres_genre_idx" ON "series_genres" USING btree ("genre_id");--> statement-breakpoint
CREATE INDEX "bookmarks_user_recent_idx" ON "bookmarks" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bookmarks_series_idx" ON "bookmarks" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "follows_series_notify_idx" ON "follows" USING btree ("series_id") WHERE "follows"."notify";--> statement-breakpoint
CREATE INDEX "notifications_user_recent_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "reading_history_user_chapter_uq" ON "reading_history" USING btree ("user_id","chapter_id");--> statement-breakpoint
CREATE INDEX "reading_history_user_recent_idx" ON "reading_history" USING btree ("user_id","last_read_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reading_progress_user_recent_idx" ON "reading_progress" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "translation_jobs_chapter_idx" ON "translation_jobs" USING btree ("chapter_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "translation_jobs_pickup_idx" ON "translation_jobs" USING btree ("priority" DESC NULLS LAST,"created_at") WHERE "translation_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "translation_jobs_status_idx" ON "translation_jobs" USING btree ("status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "translation_segments_job_idx" ON "translation_segments" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "translation_segments_page_idx" ON "translation_segments" USING btree ("page_id","position");--> statement-breakpoint
CREATE INDEX "translation_segments_review_idx" ON "translation_segments" USING btree ("job_id","review_status");--> statement-breakpoint
CREATE INDEX "payment_records_user_idx" ON "payment_records" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payment_records_status_idx" ON "payment_records" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_created_idx" ON "admin_audit_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_audit_logs_actor_idx" ON "admin_audit_logs" USING btree ("actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_audit_logs_target_idx" ON "admin_audit_logs" USING btree ("target_type","target_id");