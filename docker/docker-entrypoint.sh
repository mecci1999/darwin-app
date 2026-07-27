#!/bin/sh
set -eu

if [ "$(id -u)" -eq 0 ]; then
  mkdir -p /app/uploads
  chown -R node:node /app/uploads
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
