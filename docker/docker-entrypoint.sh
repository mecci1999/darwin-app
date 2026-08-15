#!/bin/sh
set -eu

if [ "$(id -u)" -eq 0 ]; then
  mkdir -p /app/uploads /app/logs
  chown -R node:node /app/uploads /app/logs
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
