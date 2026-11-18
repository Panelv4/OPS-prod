#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Set source DATABASE_URL}"
umask 077
dir="${1:-./backups}"
mkdir -p "$dir"
tmp=$(mktemp "$dir/.opspilot-XXXXXXXX")
trap 'rm -f "$tmp"' EXIT
node "$(dirname "$0")/pg-run.mjs" pg_dump --format=custom --no-owner --no-acl --file="$tmp"
pg_restore --list "$tmp" >/dev/null
final="$dir/opspilot-$(date -u +%Y%m%dT%H%M%SZ)-${tmp##*-}.dump"
mv "$tmp" "$final"
printf 'Created private logical backup: %s\n' "$final"
