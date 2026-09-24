-- Tenant isolation: Row-Level Security on every table with organization_id.
--
-- Runtime queries run as the `testrex_app` role (not superuser, not BYPASSRLS, not table
-- owner). Requests set `app.org_id` (and `app.user_id`) with transaction-local scope.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'testrex_app') THEN
    RAISE EXCEPTION 'Database role "testrex_app" does not exist. Create it before migrating: CREATE ROLE testrex_app LOGIN PASSWORD ''...''; (see deploy/postgres/init-roles.sh)';
  END IF;
END $$;
--> statement-breakpoint

-- After a transaction-local set_config ends, the setting reverts to '' rather than NULL,
-- so NULLIF keeps "no context" meaning "no rows" instead of a cast error.
CREATE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON memberships
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
-- A user may list their own memberships across organizations (organization switcher).
CREATE POLICY own_memberships ON memberships FOR SELECT
  USING (user_id = app_current_user());
--> statement-breakpoint

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitations
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON applications
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint

ALTER TABLE application_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON application_members
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_events
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint

-- Application keys are embedded in item identifiers and must never change.
CREATE FUNCTION applications_key_immutable() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'application key cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER applications_key_immutable BEFORE UPDATE OF key ON applications
  FOR EACH ROW EXECUTE FUNCTION applications_key_immutable();
--> statement-breakpoint

-- Runtime role privileges. Tables created by later migrations get the same DML grants.
GRANT USAGE ON SCHEMA public TO testrex_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO testrex_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO testrex_app;
-- The audit log is append-only for the application.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM testrex_app;
-- The application may check which migrations are applied (readiness) but not change them.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON _testrex_migrations FROM testrex_app;
