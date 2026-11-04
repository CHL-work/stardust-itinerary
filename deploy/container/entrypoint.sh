#!/bin/sh
# One image, several run modes. Secrets arrive as dotenv files mounted under STARDUST_ENV_DIR
# (one directory per secret); each *.env file is passed to Node with --env-file.
set -eu
cd /app

env_dir="${STARDUST_ENV_DIR:-/var/run/stardust/env}"
env_flags=""
if [ -d "$env_dir" ]; then
  # Skip the ..data / ..timestamp entries Kubernetes uses for atomic secret updates.
  for file in $(find -L "$env_dir" -mindepth 1 -maxdepth 2 -name '*.env' -not -path '*/..*' | sort); do
    env_flags="$env_flags --env-file=$file"
  done
fi

# Migration and backup jobs receive only the administrator password file; build their direct URL.
if [ -n "${STARDUST_DB_ADMIN_PASSWORD_FILE:-}" ] && [ -z "${DATABASE_DIRECT_URL:-}" ]; then
  admin_password="$(cat "$STARDUST_DB_ADMIN_PASSWORD_FILE")"
  case "$admin_password" in
    ''|*[!0-9a-fA-F]*) echo "the administrator password file must contain only hexadecimal characters" >&2; exit 64 ;;
  esac
  DATABASE_DIRECT_URL="postgresql://${STARDUST_DATABASE_ADMIN_USER:-postgres}:${admin_password}@${STARDUST_DATABASE_HOST:-stardust-db}:${STARDUST_DATABASE_PORT:-5432}/${STARDUST_DATABASE_NAME:-stardust}"
  export DATABASE_DIRECT_URL
  unset admin_password
fi

mode="${1:-web}"
if [ "$#" -gt 0 ]; then shift; fi

case "$mode" in
  web)
    # shellcheck disable=SC2086
    exec node $env_flags .next/standalone/server.js ;;
  disruption)
    # shellcheck disable=SC2086
    exec node $env_flags --import tsx scripts/run-disruption-monitor.ts "$@" ;;
  feedback)
    # shellcheck disable=SC2086
    exec node $env_flags --import tsx scripts/run-feedback-worker.ts "$@" ;;
  migrate)
    # shellcheck disable=SC2086
    node $env_flags scripts/db/migrate.mjs
    # shellcheck disable=SC2086
    exec node $env_flags scripts/db/runtime-role.mjs ;;
  backup)
    # shellcheck disable=SC2086
    exec node $env_flags scripts/db/backup.mjs "$@" ;;
  provider-smoke)
    # shellcheck disable=SC2086
    exec node $env_flags --import tsx scripts/provider-smoke.ts "$@" ;;
  guest-purge)
    # shellcheck disable=SC2086
    exec node $env_flags --import tsx scripts/run-guest-purge.ts "$@" ;;
  scheduler)
    # Single-host stand-in for the Kubernetes CronJobs: disruption checks every 5 minutes, the
    # feedback worker and the guest purge once an hour. Failures are logged and retried later.
    tick=0
    while :; do
      # shellcheck disable=SC2086
      node $env_flags --import tsx scripts/run-disruption-monitor.ts || echo "disruption run failed" >&2
      if [ $((tick % 12)) -eq 0 ]; then
        # shellcheck disable=SC2086
        node $env_flags --import tsx scripts/run-feedback-worker.ts || echo "feedback run failed" >&2
        # shellcheck disable=SC2086
        node $env_flags --import tsx scripts/run-guest-purge.ts || echo "guest purge run failed" >&2
      fi
      tick=$((tick + 1))
      sleep 300
    done ;;
  *)
    echo "usage: entrypoint.sh web|disruption|feedback|guest-purge|migrate|backup|scheduler|provider-smoke" >&2
    exit 64 ;;
esac
