-- Test scenarios, modules, tags and key sequences.
-- pg_trgm is a trusted extension: the database owner can create it without superuser. Its
-- trigram index serves substring search (search_text LIKE '%term%').
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TYPE "public"."scenario_priority" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."scenario_status" AS ENUM('draft', 'ready', 'deprecated');--> statement-breakpoint
CREATE TABLE "modules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "modules_name_length" CHECK (char_length("modules"."name") BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE TABLE "scenario_tags" (
	"scenario_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	CONSTRAINT "scenario_tags_pkey" PRIMARY KEY("scenario_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"status" "scenario_status" DEFAULT 'draft' NOT NULL,
	"priority" "scenario_priority" DEFAULT 'medium' NOT NULL,
	"module_id" uuid,
	"version_from" text,
	"version_from_parts" integer[],
	"version_to" text,
	"version_to_parts" integer[],
	"description_md" text DEFAULT '' NOT NULL,
	"steps_md" text DEFAULT '' NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"current_revision" integer NOT NULL,
	"current_revision_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "scenarios_app_number_key" UNIQUE("application_id","number"),
	CONSTRAINT "scenarios_number_positive" CHECK ("scenarios"."number" > 0),
	CONSTRAINT "scenarios_title_length" CHECK (char_length("scenarios"."title") BETWEEN 1 AND 200),
	CONSTRAINT "scenarios_version_parts" CHECK (("scenarios"."version_from" IS NULL) = ("scenarios"."version_from_parts" IS NULL)
        AND ("scenarios"."version_to" IS NULL) = ("scenarios"."version_to_parts" IS NULL)
        AND ("scenarios"."version_from_parts" IS NULL OR cardinality("scenarios"."version_from_parts") = 4)
        AND ("scenarios"."version_to_parts" IS NULL OR cardinality("scenarios"."version_to_parts") = 4)),
	CONSTRAINT "scenarios_version_range" CHECK ("scenarios"."version_from_parts" IS NULL OR "scenarios"."version_to_parts" IS NULL OR "scenarios"."version_from_parts" <= "scenarios"."version_to_parts")
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"last_value" integer NOT NULL,
	CONSTRAINT "sequences_pkey" PRIMARY KEY("application_id","kind"),
	CONSTRAINT "sequences_kind" CHECK ("sequences"."kind" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_app_name_key" UNIQUE("application_id","name")
);
--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_tags" ADD CONSTRAINT "scenario_tags_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_tags" ADD CONSTRAINT "scenario_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_tags" ADD CONSTRAINT "scenario_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "modules_app_name_key" ON "modules" USING btree ("application_id",lower("name")) WHERE "modules"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "scenario_tags_tag_idx" ON "scenario_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "scenarios_app_updated_idx" ON "scenarios" USING btree ("application_id","updated_at");--> statement-breakpoint
CREATE INDEX "scenarios_app_module_idx" ON "scenarios" USING btree ("application_id","module_id");--> statement-breakpoint
CREATE INDEX "scenarios_app_created_by_idx" ON "scenarios" USING btree ("application_id","created_by");--> statement-breakpoint
CREATE INDEX "scenarios_search_text_trgm_idx" ON "scenarios" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint

-- Tenant isolation (see 0002_tenant_isolation.sql). Application scoping is enforced by the API.
ALTER TABLE sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sequences
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE modules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modules
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tags
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenarios FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON scenarios
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE scenario_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON scenario_tags
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
