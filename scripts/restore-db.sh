#!/usr/bin/env bash
set -euo pipefail
: "${RESTORE_DATABASE_URL:?Set a NEW isolated empty restore target}"
: "${1:?Supply a custom-format backup}"
export DATABASE_URL="$RESTORE_DATABASE_URL"
pg() { node "$(dirname "$0")/pg-run.mjs" psql "$@"; }
# Never replace a nonempty database. Role/extension provisioning is a separate DBA operation.
allowed=$(pg -XAtq -v ON_ERROR_STOP=1 -c "select current_database() like '%\_restore' and not exists (select from pg_class c join pg_namespace n on c.relnamespace=n.oid where n.nspname not in ('information_schema','pg_catalog') and n.nspname not like 'pg_toast%' and c.relkind in ('r','p','v','m','S'))")
[[ "$allowed" == t ]] || { echo 'Restore requires an empty *_restore database.' >&2; exit 1; }
name=$(pg -XAtq -v ON_ERROR_STOP=1 -c 'select current_database()')
# Restore in one transaction to the checked target, never to a name encoded in the archive.
pg_restore --no-owner --no-acl --file=- "$1" | pg -Xq -v ON_ERROR_STOP=1 --single-transaction >/dev/null
printf 'Restored into isolated target %s. Validate counts and application reads before any cutover.\n' "$name"
