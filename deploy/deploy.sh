#!/usr/bin/env bash
# Deploy one built image to the cluster in a safe order:
#   1. shared objects, the database, the tunnel and the job templates (new image),
#   2. a pre-migration encrypted backup (skipped with --skip-backup, e.g. on an empty database),
#   3. the migration job, which must succeed,
#   4. everything else (web rollout, workers), then a health check through the public URL.
#
# Usage: deploy/deploy.sh <image-tag> [--skip-backup]
# Needs kubectl pointed at the cluster. IMAGE_REPOSITORY and PUBLIC_URL override the defaults.
set -euo pipefail

tag="${1:?usage: deploy/deploy.sh <image-tag> [--skip-backup]}"
skip_backup="${2:-}"
namespace=stardust
overlay="${OVERLAY:-deploy/k8s/overlays/gke}"
public_url="${PUBLIC_URL:-https://stardust-itinerary.chl-work.com}"
[[ $tag =~ ^[A-Za-z0-9._-]{1,128}$ ]] || { echo "invalid image tag" >&2; exit 64; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp -r deploy/k8s "$work/k8s"
relative_overlay="${overlay#deploy/k8s/}"
sed -i "s|^    newTag: .*|    newTag: ${tag}|" "$work/k8s/$relative_overlay/kustomization.yaml"
if [[ -n ${IMAGE_REPOSITORY:-} ]]; then
  sed -i "s|^    newName: .*|    newName: ${IMAGE_REPOSITORY}/stardust-itinerary|" "$work/k8s/$relative_overlay/kustomization.yaml"
fi
kubectl kustomize "$work/k8s/$relative_overlay" > "$work/all.yaml"

suffix="${tag:0:12}-$(date -u +%H%M%S)"
run_job() {
  local cronjob="$1" name="$2"
  kubectl -n "$namespace" create job "$name" --from="cronjob/$cronjob"
  if ! kubectl -n "$namespace" wait --for=condition=complete "job/$name" --timeout=20m; then
    echo "job $name did not complete" >&2
    kubectl -n "$namespace" logs "job/$name" --all-containers --tail=200 >&2 || true
    exit 1
  fi
  kubectl -n "$namespace" logs "job/$name" --all-containers --tail=20 || true
}

echo "== shared objects, database, tunnel and job templates"
kubectl apply -f "$work/all.yaml" -l '!app.kubernetes.io/component'
kubectl apply -f "$work/all.yaml" -l 'app.kubernetes.io/component in (db,tunnel,backup,migrate)'
kubectl -n "$namespace" rollout status statefulset/stardust-db --timeout=15m

if [[ $skip_backup != --skip-backup ]]; then
  echo "== pre-migration backup"
  run_job stardust-backup "stardust-backup-pre-$suffix"
fi

echo "== migrations"
run_job stardust-migrate "stardust-migrate-$suffix"

echo "== application"
kubectl apply -f "$work/all.yaml"
kubectl -n "$namespace" rollout status deployment/stardust-web --timeout=15m
kubectl -n "$namespace" rollout status deployment/stardust-tunnel --timeout=10m

echo "== health"
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 10 "$public_url/api/health" >/dev/null; then
    echo "healthy: $public_url"
    exit 0
  fi
  sleep 10
done
echo "health check failed for $public_url" >&2
exit 1
