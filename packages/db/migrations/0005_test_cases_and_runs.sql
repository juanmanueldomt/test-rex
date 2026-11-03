-- Test cases (linked to scenarios, versioned), datasets, automation settings, global steps,
-- test runs with their items and artifacts, recording sessions and organization LLM settings.
CREATE TYPE "public"."artifact_kind" AS ENUM('screenshot', 'trace', 'video');--> statement-breakpoint
CREATE TYPE "public"."browser_name" AS ENUM('chromium', 'firefox', 'webkit');--> statement-breakpoint
CREATE TYPE "public"."execution_mode" AS ENUM('automated', 'manual');--> statement-breakpoint
CREATE TYPE "public"."hook_phase" AS ENUM('beforeRun', 'beforeEach', 'afterEach', 'afterRun');--> statement-breakpoint
CREATE TYPE "public"."llm_provider" AS ENUM('anthropic', 'openai_compatible');--> statement-breakpoint
CREATE TYPE "public"."recording_status" AS ENUM('starting', 'active', 'stopped', 'expired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."run_item_status" AS ENUM('queued', 'untested', 'running', 'passed', 'failed', 'blocked', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."version_source" AS ENUM('editor', 'ai', 'recording', 'restore');--> statement-breakpoint
CREATE TABLE "automation_settings" (
	"application_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"base_url" text,
	"browser" "browser_name" DEFAULT 'chromium' NOT NULL,
	"viewport_width" integer DEFAULT 1280 NOT NULL,
	"viewport_height" integer DEFAULT 720 NOT NULL,
	"action_timeout_ms" integer DEFAULT 10000 NOT NULL,
	"navigation_timeout_ms" integer DEFAULT 30000 NOT NULL,
	"assertion_timeout_ms" integer DEFAULT 5000 NOT NULL,
	"trace_on_failure" boolean DEFAULT true NOT NULL,
	"video_on_failure" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_settings_ranges" CHECK ("automation_settings"."viewport_width" BETWEEN 320 AND 3840 AND "automation_settings"."viewport_height" BETWEEN 240 AND 2160
        AND "automation_settings"."action_timeout_ms" > 0 AND "automation_settings"."navigation_timeout_ms" > 0 AND "automation_settings"."assertion_timeout_ms" > 0)
);
--> statement-breakpoint
CREATE TABLE "datasets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"columns" text[] NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "datasets_name_length" CHECK (char_length("datasets"."name") BETWEEN 1 AND 80),
	CONSTRAINT "datasets_rows_array" CHECK (jsonb_typeof("datasets"."rows") = 'array')
);
--> statement-breakpoint
CREATE TABLE "global_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"phase" "hook_phase" NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"steps" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "global_steps_name_length" CHECK (char_length("global_steps"."name") BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE TABLE "llm_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"provider" "llm_provider" NOT NULL,
	"model" text NOT NULL,
	"base_url" text,
	"api_key_encrypted" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recording_commands" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recording_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"created_by" uuid,
	"status" "recording_status" DEFAULT 'starting' NOT NULL,
	"start_url" text NOT NULL,
	"current_url" text,
	"page_title" text,
	"viewport_width" integer NOT NULL,
	"viewport_height" integer NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"element" jsonb,
	"frame" "bytea",
	"frame_version" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "run_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"iteration" integer DEFAULT 0 NOT NULL,
	"kind" "artifact_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_artifacts_storage_key_key" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "test_case_scenarios" (
	"test_case_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	CONSTRAINT "test_case_scenarios_pkey" PRIMARY KEY("test_case_id","scenario_id")
);
--> statement-breakpoint
CREATE TABLE "test_case_tags" (
	"test_case_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	CONSTRAINT "test_case_tags_pkey" PRIMARY KEY("test_case_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "test_case_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"test_case_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"status" "scenario_status" NOT NULL,
	"priority" "scenario_priority" NOT NULL,
	"execution_mode" "execution_mode" NOT NULL,
	"description_md" text NOT NULL,
	"preconditions_md" text NOT NULL,
	"steps" jsonb NOT NULL,
	"dataset_id" uuid,
	"scenario_ids" uuid[] NOT NULL,
	"tag_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"changed_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" "version_source" NOT NULL,
	"restored_from" integer,
	"author_id" uuid,
	"author_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_case_versions_case_number_key" UNIQUE("test_case_id","number"),
	CONSTRAINT "test_case_versions_number_positive" CHECK ("test_case_versions"."number" > 0)
);
--> statement-breakpoint
CREATE TABLE "test_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"status" "scenario_status" DEFAULT 'draft' NOT NULL,
	"priority" "scenario_priority" DEFAULT 'medium' NOT NULL,
	"execution_mode" "execution_mode" DEFAULT 'automated' NOT NULL,
	"description_md" text DEFAULT '' NOT NULL,
	"preconditions_md" text DEFAULT '' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dataset_id" uuid,
	"search_text" text DEFAULT '' NOT NULL,
	"current_version" integer NOT NULL,
	"current_version_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "test_cases_app_number_key" UNIQUE("application_id","number"),
	CONSTRAINT "test_cases_number_positive" CHECK ("test_cases"."number" > 0),
	CONSTRAINT "test_cases_title_length" CHECK (char_length("test_cases"."title") BETWEEN 1 AND 200),
	CONSTRAINT "test_cases_steps_array" CHECK (jsonb_typeof("test_cases"."steps") = 'array')
);
--> statement-breakpoint
CREATE TABLE "test_run_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"test_case_id" uuid NOT NULL,
	"test_case_version_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"position" integer NOT NULL,
	"execution_mode" "execution_mode" NOT NULL,
	"title" text NOT NULL,
	"scenario_ids" uuid[] NOT NULL,
	"steps" jsonb NOT NULL,
	"dataset" jsonb,
	"status" "run_item_status" NOT NULL,
	"iterations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"failed_step_id" text,
	"duration_ms" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"executed_by" uuid,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "test_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"status" "run_status" NOT NULL,
	"base_url" text,
	"browser" "browser_name" NOT NULL,
	"settings" jsonb NOT NULL,
	"hooks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hook_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"cancelled_by" uuid,
	CONSTRAINT "test_runs_app_number_key" UNIQUE("application_id","number"),
	CONSTRAINT "test_runs_number_positive" CHECK ("test_runs"."number" > 0),
	CONSTRAINT "test_runs_title_length" CHECK (char_length("test_runs"."title") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "automation_settings" ADD CONSTRAINT "automation_settings_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_settings" ADD CONSTRAINT "automation_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_settings" ADD CONSTRAINT "automation_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_steps" ADD CONSTRAINT "global_steps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_steps" ADD CONSTRAINT "global_steps_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_steps" ADD CONSTRAINT "global_steps_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_steps" ADD CONSTRAINT "global_steps_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_settings" ADD CONSTRAINT "llm_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_settings" ADD CONSTRAINT "llm_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_commands" ADD CONSTRAINT "recording_commands_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_commands" ADD CONSTRAINT "recording_commands_session_id_recording_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."recording_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_sessions" ADD CONSTRAINT "recording_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_sessions" ADD CONSTRAINT "recording_sessions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_sessions" ADD CONSTRAINT "recording_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_artifacts" ADD CONSTRAINT "run_artifacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_artifacts" ADD CONSTRAINT "run_artifacts_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_artifacts" ADD CONSTRAINT "run_artifacts_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_artifacts" ADD CONSTRAINT "run_artifacts_item_id_test_run_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."test_run_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case_scenarios" ADD CONSTRAINT "test_case_scenarios_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case_scenarios" ADD CONSTRAINT "test_case_scenarios_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case_scenarios" ADD CONSTRAINT "test_case_scenarios_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case_tags" ADD CONSTRAINT "test_case_tags_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case_tags" ADD CONSTRAINT "test_case_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case_tags" ADD CONSTRAINT "test_case_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case_versions" ADD CONSTRAINT "test_case_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case_versions" ADD CONSTRAINT "test_case_versions_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case_versions" ADD CONSTRAINT "test_case_versions_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case_versions" ADD CONSTRAINT "test_case_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_run_items" ADD CONSTRAINT "test_run_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_run_items" ADD CONSTRAINT "test_run_items_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_run_items" ADD CONSTRAINT "test_run_items_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_run_items" ADD CONSTRAINT "test_run_items_test_case_version_id_test_case_versions_id_fk" FOREIGN KEY ("test_case_version_id") REFERENCES "public"."test_case_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_run_items" ADD CONSTRAINT "test_run_items_executed_by_users_id_fk" FOREIGN KEY ("executed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "datasets_app_name_key" ON "datasets" USING btree ("application_id",lower("name")) WHERE "datasets"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "global_steps_app_phase_idx" ON "global_steps" USING btree ("application_id","phase","position");--> statement-breakpoint
CREATE INDEX "recording_commands_session_idx" ON "recording_commands" USING btree ("session_id","id");--> statement-breakpoint
CREATE INDEX "recording_sessions_app_idx" ON "recording_sessions" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "run_artifacts_item_idx" ON "run_artifacts" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "test_case_scenarios_scenario_idx" ON "test_case_scenarios" USING btree ("scenario_id");--> statement-breakpoint
CREATE INDEX "test_case_tags_tag_idx" ON "test_case_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "test_cases_app_updated_idx" ON "test_cases" USING btree ("application_id","updated_at");--> statement-breakpoint
CREATE INDEX "test_cases_dataset_idx" ON "test_cases" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "test_cases_search_text_trgm_idx" ON "test_cases" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "test_run_items_run_idx" ON "test_run_items" USING btree ("run_id","position");--> statement-breakpoint
CREATE INDEX "test_run_items_case_idx" ON "test_run_items" USING btree ("test_case_id","finished_at");--> statement-breakpoint
CREATE INDEX "test_runs_app_created_idx" ON "test_runs" USING btree ("application_id","created_at");

-- Tenant isolation (see 0002_tenant_isolation.sql). Application scoping is enforced by the API
-- and by the worker, which only acts for the organization named in each job.
ALTER TABLE datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE datasets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON datasets
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE test_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON test_cases
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE test_case_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_case_scenarios FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON test_case_scenarios
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE test_case_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_case_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON test_case_tags
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE test_case_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_case_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON test_case_versions
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE automation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON automation_settings
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE global_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON global_steps
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE test_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON test_runs
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE test_run_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_run_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON test_run_items
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE run_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON run_artifacts
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE recording_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE recording_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recording_sessions
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE recording_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE recording_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recording_commands
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE llm_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON llm_settings
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
-- Versions are append-only for the application, like scenario revisions.
REVOKE UPDATE, DELETE, TRUNCATE ON test_case_versions FROM testrex_app;
--> statement-breakpoint
-- Default privileges cover tables only; recording commands use a serial id.
GRANT USAGE, SELECT ON SEQUENCE recording_commands_id_seq TO testrex_app;
