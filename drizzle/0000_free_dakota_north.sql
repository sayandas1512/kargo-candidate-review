CREATE TYPE "public"."candidate_status" AS ENUM('uploaded', 'extracted', 'scored', 'ready', 'needs_identity_check', 'needs_manual_review', 'failed');--> statement-breakpoint
CREATE TYPE "public"."decision" AS ENUM('advance', 'hold', 'decline');--> statement-breakpoint
CREATE TYPE "public"."draft_kind" AS ENUM('invite', 'rejection');--> statement-breakpoint
CREATE TYPE "public"."draft_source" AS ENUM('gemini', 'fallback_template', 'edited');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('draft', 'sending', 'sent', 'failed', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."email_mode" AS ENUM('test', 'live');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('PM', 'SPM');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" text NOT NULL,
	"candidate_id" uuid,
	"actor" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "briefs" (
	"candidate_id" uuid PRIMARY KEY NOT NULL,
	"who" text NOT NULL,
	"why" text NOT NULL,
	"probe" text NOT NULL,
	"probes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_files" (
	"candidate_id" uuid PRIMARY KEY NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"bytes" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_personal_details" (
	"candidate_id" uuid PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone" text,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"original_filename" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applied_role" "role" NOT NULL,
	"status" "candidate_status" DEFAULT 'uploaded' NOT NULL,
	"file_hash" text NOT NULL,
	"cv_text_redacted" text,
	"cv_content" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_opened_at" timestamp with time zone,
	"is_calibration" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"decision" "decision" NOT NULL,
	"reason" text,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"kind" "draft_kind" NOT NULL,
	"subject" text NOT NULL,
	"body_template" text NOT NULL,
	"source" "draft_source" NOT NULL,
	"status" "draft_status" DEFAULT 'draft' NOT NULL,
	"resend_id" text,
	"sent_to" text,
	"sent_at" timestamp with time zone,
	"mode" "email_mode",
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "role" NOT NULL,
	"version" integer NOT NULL,
	"criteria" jsonb NOT NULL,
	"source" text DEFAULT 'rubric.txt' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION jsonb_scores_valid(criteria jsonb) RETURNS boolean AS $$
DECLARE
	elem jsonb;
BEGIN
	IF jsonb_typeof(criteria) IS DISTINCT FROM 'array' THEN
		RETURN false;
	END IF;
	FOR elem IN SELECT * FROM jsonb_array_elements(criteria) LOOP
		IF NOT (elem ? 'criterion_key') THEN
			RETURN false;
		END IF;
		IF jsonb_typeof(elem->'score') IS DISTINCT FROM 'number' THEN
			RETURN false;
		END IF;
		IF (elem->>'score')::numeric <> floor((elem->>'score')::numeric) THEN
			RETURN false;
		END IF;
		IF (elem->>'score')::int < 0 OR (elem->>'score')::int > 4 THEN
			RETURN false;
		END IF;
	END LOOP;
	RETURN true;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"rubric_version" integer NOT NULL,
	"model" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"weighted_total" numeric(5, 1) NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"low_confidence" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scores_weighted_total_range" CHECK ("scores"."weighted_total" >= 0 AND "scores"."weighted_total" <= 100),
	CONSTRAINT "scores_criteria_valid" CHECK (jsonb_scores_valid("scores"."criteria"))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_files" ADD CONSTRAINT "candidate_files_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_personal_details" ADD CONSTRAINT "candidate_personal_details_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_file_hash_idx" ON "candidates" USING btree ("file_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "email_drafts_sent_once_idx" ON "email_drafts" USING btree ("candidate_id","kind") WHERE "email_drafts"."status" = 'sent';--> statement-breakpoint
CREATE UNIQUE INDEX "rubrics_role_version_idx" ON "rubrics" USING btree ("role","version");--> statement-breakpoint
CREATE UNIQUE INDEX "scores_candidate_role_version_idx" ON "scores" USING btree ("candidate_id","role","rubric_version");--> statement-breakpoint

-- Append-only enforcement for decisions and audit_log: block every UPDATE,
-- and block DELETE unless running inside delete_candidate(), which sets a
-- transaction-local flag before cascading the delete.
CREATE OR REPLACE FUNCTION forbid_update() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION '% is append-only: UPDATE is not allowed', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_delete_unless_flagged() RETURNS trigger AS $$
BEGIN
	IF current_setting('app.allow_delete', true) IS DISTINCT FROM 'true' THEN
		RAISE EXCEPTION '% is append-only: DELETE is only allowed via delete_candidate()', TG_TABLE_NAME;
	END IF;
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER decisions_no_update BEFORE UPDATE ON "decisions" FOR EACH ROW EXECUTE FUNCTION forbid_update();
--> statement-breakpoint
CREATE TRIGGER decisions_no_delete BEFORE DELETE ON "decisions" FOR EACH ROW EXECUTE FUNCTION forbid_delete_unless_flagged();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION forbid_update();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION forbid_delete_unless_flagged();
--> statement-breakpoint

-- Hard-deletes every row for a candidate (file, personal details, scores,
-- briefs, drafts, decisions, audit log) in one transaction via FK cascade.
CREATE OR REPLACE FUNCTION delete_candidate(p_candidate_id uuid) RETURNS void AS $$
BEGIN
	PERFORM set_config('app.allow_delete', 'true', true);
	DELETE FROM "candidates" WHERE id = p_candidate_id;
END;
$$ LANGUAGE plpgsql;