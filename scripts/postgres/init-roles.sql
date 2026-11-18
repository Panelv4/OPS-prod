-- psql 16; fresh, dedicated local cluster/DB only. Executed by the postgres image on first init.
-- Pass credentials via environment, not psql arguments or source-controlled SQL literals.
\set ON_ERROR_STOP on
\getenv migrator_pw OPSPILOT_MIGRATOR_PASSWORD
\getenv runtime_pw OPSPILOT_RUNTIME_PASSWORD
\getenv bootstrap_pw POSTGRES_PASSWORD
BEGIN;
DO $$ BEGIN
  IF current_database() IN ('postgres','template0','template1')
     OR EXISTS (SELECT FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema'))
     OR EXISTS (SELECT FROM pg_roles WHERE rolname IN ('opspilot_migrator','opspilot_runtime')) THEN
    RAISE EXCEPTION 'Use a fresh dedicated database and unallocated role names; existing data is never adopted';
  END IF;
END $$;
SELECT length(:'migrator_pw') >= 32 AND length(:'runtime_pw') >= 32 AND :'migrator_pw' <> :'runtime_pw'
  AND :'bootstrap_pw' NOT IN (:'migrator_pw', :'runtime_pw') AS distinct_passwords \gset
\if :distinct_passwords
CREATE ROLE opspilot_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'migrator_pw';
CREATE ROLE opspilot_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'runtime_pw';
\else
DO $$ BEGIN RAISE EXCEPTION 'Supply independent random role passwords of at least 32 characters'; END $$;
\endif
REVOKE ALL ON DATABASE :"DBNAME" FROM PUBLIC;
GRANT CONNECT, CREATE ON DATABASE :"DBNAME" TO opspilot_migrator;
GRANT CONNECT ON DATABASE :"DBNAME" TO opspilot_runtime;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO opspilot_migrator;
GRANT USAGE ON SCHEMA public TO opspilot_runtime;
COMMIT;
\unset migrator_pw
\unset runtime_pw
\unset bootstrap_pw
