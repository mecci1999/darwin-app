#!/usr/bin/env bash
set -euo pipefail

compose_file="docker/docker-compose.trails-mysql-it.yml"
cleanup() { docker compose -f "$compose_file" down --volumes --remove-orphans; }
trap cleanup EXIT

docker compose -f "$compose_file" up -d
container_id="$(docker compose -f "$compose_file" ps -q mysql)"
if [ -z "$container_id" ]; then
  docker compose -f "$compose_file" ps
  exit 1
fi
for _ in $(seq 1 60); do
  if docker exec "$container_id" mysql --protocol=TCP -h 127.0.0.1 -udarwin_trails_it -pdarwin_trails_it darwin_trails_it -e 'SELECT 1' >/dev/null 2>&1; then break; fi
  sleep 2
done
if ! docker exec "$container_id" mysql --protocol=TCP -h 127.0.0.1 -udarwin_trails_it -pdarwin_trails_it darwin_trails_it -e 'SELECT 1' >/dev/null 2>&1; then
  docker compose -f "$compose_file" ps
  exit 1
fi
# Both suites bootstrap the same disposable schema; serialize their DDL to avoid MySQL migration races.
TRAILS_MYSQL_INTEGRATION=1 pnpm exec jest --runInBand --runTestsByPath __tests__/trails/mysql-portfolio-category-sync.integration.test.ts __tests__/trails/mysql-durable-media-commerce.integration.test.ts __tests__/trails/mysql-media-asset-registry.integration.test.ts
