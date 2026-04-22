#!/usr/bin/env bash
# One-time DB bootstrap. Requires sudo.
# Creates the lennys_roundtable database, an app role, and enables pgvector.
set -euo pipefail

DB_NAME="lennys_roundtable"
APP_USER="lr_app"
APP_PASS="${APP_PASS:-roundtable_dev}"

sudo -u postgres psql <<SQL
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$APP_USER') THEN
        CREATE ROLE $APP_USER LOGIN PASSWORD '$APP_PASS';
    END IF;
END
\$\$;

SELECT 'CREATE DATABASE $DB_NAME OWNER $APP_USER'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec

GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $APP_USER;
SQL

sudo -u postgres psql -d "$DB_NAME" <<SQL
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
GRANT ALL ON SCHEMA public TO $APP_USER;
SQL

echo
echo "Done."
echo "  Database: $DB_NAME"
echo "  User:     $APP_USER"
echo "  Password: $APP_PASS"
echo "  DSN:      postgresql://$APP_USER:$APP_PASS@localhost:5432/$DB_NAME"
