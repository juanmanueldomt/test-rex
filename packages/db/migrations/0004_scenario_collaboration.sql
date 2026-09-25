-- Scenario revisions (append-only), comments, requirement links and attachments.
CREATE TYPE "public"."requirement_provider" AS ENUM('jira', 'github', 'azure_devops', 'other');--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"scenario_id" uuid,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "attachments_storage_key_key" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "scenario_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"body_md" text NOT NULL,
	"revision_number" integer NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "scenario_comments_body_length" CHECK (char_length("scenario_comments"."body_md") BETWEEN 1 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "scenario_requirement_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"provider" "requirement_provider" NOT NULL,
	"issue_key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scenario_requirement_links_scenario_url_key" UNIQUE("scenario_id","url"),
	CONSTRAINT "scenario_requirement_links_url_scheme" CHECK ("scenario_requirement_links"."url" ~* '^https?://')
);
--> statement-breakpoint
CREATE TABLE "scenario_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"status" "scenario_status" NOT NULL,
	"priority" "scenario_priority" NOT NULL,
	"module_id" uuid,
	"version_from" text,
	"version_to" text,
	"description_md" text NOT NULL,
	"steps_md" text NOT NULL,
	"tag_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"changed_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"restored_from" integer,
	"author_id" uuid,
	"author_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scenario_revisions_scenario_number_key" UNIQUE("scenario_id","number"),
	CONSTRAINT "scenario_revisions_number_positive" CHECK ("scenario_revisions"."number" > 0)
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_comments" ADD CONSTRAINT "scenario_comments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_comments" ADD CONSTRAINT "scenario_comments_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_comments" ADD CONSTRAINT "scenario_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_comments" ADD CONSTRAINT "scenario_comments_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_requirement_links" ADD CONSTRAINT "scenario_requirement_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_requirement_links" ADD CONSTRAINT "scenario_requirement_links_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_requirement_links" ADD CONSTRAINT "scenario_requirement_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_revisions" ADD CONSTRAINT "scenario_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_revisions" ADD CONSTRAINT "scenario_revisions_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_revisions" ADD CONSTRAINT "scenario_revisions_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_revisions" ADD CONSTRAINT "scenario_revisions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_scenario_idx" ON "attachments" USING btree ("scenario_id");--> statement-breakpoint
CREATE INDEX "attachments_pending_idx" ON "attachments" USING btree ("organization_id","created_at") WHERE "attachments"."scenario_id" IS NULL;--> statement-breakpoint
CREATE INDEX "scenario_comments_scenario_idx" ON "scenario_comments" USING btree ("scenario_id","created_at");--> statement-breakpoint

-- Tenant isolation (see 0002_tenant_isolation.sql). Application scoping is enforced by the API.
ALTER TABLE scenario_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON scenario_revisions
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE scenario_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_comments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON scenario_comments
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE scenario_requirement_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_requirement_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON scenario_requirement_links
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attachments
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint

-- Revisions are immutable history (like the audit log): the application may only add them.
REVOKE UPDATE, DELETE, TRUNCATE ON scenario_revisions FROM testrex_app;
