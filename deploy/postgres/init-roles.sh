#!/bin/sh
# Creates the testrex database roles. The postgres image runs this once, when it initializes
# an empty data directory (docker-entrypoint-initdb.d), as the superuser POSTGRES_USER.
#   testrex_owner  owns the database; runs migrations and the job queue
#   testrex_app    runtime role; not superuser, not BYPASSRLS, so Row-Level Security applies
# Both use POSTGRES_PASSWORD. The superuser's password is then removed, so it is reachable only
# through the container's local socket.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v db="$POSTGRES_DB" -v password="$POSTGRES_PASSWORD" -v superuser="$POSTGRES_USER" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', role, :'password')
  FROM unnest(ARRAY['testrex_owner', 'testrex_app']) AS role
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role)
\gexec

ALTER DATABASE :"db" OWNER TO testrex_owner;

SELECT format('ALTER ROLE %I PASSWORD NULL', :'superuser')
 WHERE :'superuser' NOT IN ('testrex_owner', 'testrex_app')
\gexec
SQL
