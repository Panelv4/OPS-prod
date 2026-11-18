#!/usr/bin/env bash
# Fresh synthetic stack only. Never read a customer .env, reuse a volume, or use a remote daemon.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo 'Docker Engine and Compose v2 are required; no rehearsal ran.' >&2; exit 1; }
endpoint=${DOCKER_HOST:-}
if [[ -n ${DOCKER_CONTEXT:-} || -z $endpoint ]]; then
  endpoint=$(docker context inspect --format '{{(index .Endpoints "docker").Host}}')
fi
[[ $endpoint == unix:///* ]] || { echo 'Use a local Unix-socket Docker context only.' >&2; exit 1; }
unset DOCKER_CONTEXT BUILDKIT_HOST COMPOSE_ENV_FILES COMPOSE_PROFILES
export DOCKER_HOST="$endpoint" BUILDX_BUILDER=default
docker info >/dev/null
docker compose version >/dev/null
project="opspilot-rehearsal-$(openssl rand -hex 8)"
export COMPOSE_PROJECT_NAME="$project" OPSPILOT_DB_NAME=opspilot_packaging_test APP_ORIGIN=http://127.0.0.1:3000
# Let Docker allocate private loopback host ports. The probe runs inside the app and uses its canonical origin.
export LOCAL_APP_PORT=0 LOCAL_MAIL_PORT=0
POSTGRES_PASSWORD=$(openssl rand -hex 32); OPSPILOT_MIGRATOR_PASSWORD=$(openssl rand -hex 32)
OPSPILOT_RUNTIME_PASSWORD=$(openssl rand -hex 32); OPSPILOT_SECRET_KEY=$(openssl rand -hex 32); REHEARSAL_KEY=$(openssl rand -hex 24)
export POSTGRES_PASSWORD OPSPILOT_MIGRATOR_PASSWORD OPSPILOT_RUNTIME_PASSWORD OPSPILOT_SECRET_KEY REHEARSAL_KEY
stack=(docker compose -p "$project" --env-file /dev/null -f docker-compose.yml)
"${stack[@]}" config --quiet
cleanup() {
  local status=$?
  trap - EXIT
  if ! "${stack[@]}" down --volumes --timeout 30; then status=1; fi
  if docker image inspect "$project-runtime" >/dev/null 2>&1; then
    if ! docker image rm "$project-runtime" >/dev/null; then status=1; fi
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"${stack[@]}" build app
"${stack[@]}" up --no-build --wait --wait-timeout 180 app worker
"${stack[@]}" run --no-deps --rm -T migrate
address=$("${stack[@]}" port app 3000)
[[ $address =~ ^127\.0\.0\.1:[0-9]+$ ]]
curl --noproxy '*' --max-time 5 -fsS "http://$address/api/health" >/dev/null
for service in app worker; do
  uid=$("${stack[@]}" exec -T "$service" id -u)
  [[ $uid =~ ^[1-9][0-9]*$ ]] || { echo "Expected non-root $service" >&2; exit 1; }
  "${stack[@]}" exec -T "$service" node --input-type=module - acl < tests/ops-rehearsal.mjs
done
"${stack[@]}" stop worker
"${stack[@]}" exec -T -e REHEARSAL_KEY app node --input-type=module - enqueue < tests/ops-rehearsal.mjs
"${stack[@]}" start worker
"${stack[@]}" exec -T -e REHEARSAL_KEY app node --input-type=module - verify < tests/ops-rehearsal.mjs
echo 'PASS packaged stack: migrated twice, loopback readiness, non-root services, restricted roles and inbox delivery after worker restart.'
