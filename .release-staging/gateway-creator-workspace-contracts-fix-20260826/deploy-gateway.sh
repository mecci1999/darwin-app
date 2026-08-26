#!/usr/bin/env bash
set -Eeuo pipefail

release_root="$(cd "$(dirname "$0")/../.." && pwd)"
source_root="/opt/darwin-app/source"
new_image="darwin-app:gateway-creator-workspace-contracts-amd64-20260826.1"
compose=(docker compose --env-file .env.production -f docker/docker-compose.app.yml)

cd "$source_root"
previous_image="$(sed -n 's/^GATEWAY_IMAGE=//p' .env.production | head -n 1)"
if [[ -z "$previous_image" ]]; then
  echo "GATEWAY_DEPLOY=missing-current-image" >&2
  exit 1
fi

rewrite_gateway_image() {
  local image="$1"
  local next_file
  next_file="$(mktemp .env.production.gateway.XXXXXX)"
  awk -v image="$image" '
    BEGIN { replaced = 0 }
    /^GATEWAY_IMAGE=/ { print "GATEWAY_IMAGE=" image; replaced = 1; next }
    { print }
    END { if (!replaced) exit 1 }
  ' .env.production > "$next_file"
  chmod --reference=.env.production "$next_file"
  chown --reference=.env.production "$next_file"
  mv "$next_file" .env.production
}

gateway_image_updated=0
rollback() {
  local status=$?
  if [[ "$gateway_image_updated" == "1" ]]; then
    echo "GATEWAY_DEPLOY=failed-rolling-back" >&2
    rewrite_gateway_image "$previous_image"
    "${compose[@]}" up -d --no-deps --force-recreate gateway || true
  fi
  exit "$status"
}
trap rollback ERR

docker build \
  --build-arg "BASE_IMAGE=$previous_image" \
  -t "$new_image" \
  -f "$release_root/.release-staging/gateway-creator-workspace-contracts-fix-20260826/Dockerfile" \
  "$release_root"

rewrite_gateway_image "$new_image"
gateway_image_updated=1
"${compose[@]}" config --quiet
"${compose[@]}" up -d --no-deps --force-recreate gateway

health=""
for _ in {1..24}; do
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' darwin-app-gateway-1)"
  [[ "$health" == "healthy" ]] && break
  sleep 5
done

test "$health" = "healthy"
curl --fail --silent --show-error http://127.0.0.1:6670/api/health >/dev/null
docker image inspect "$new_image" --format 'GATEWAY_IMAGE_ID={{.Id}}'
echo "GATEWAY_DEPLOY=ok"
trap - ERR
