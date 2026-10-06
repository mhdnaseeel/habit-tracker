#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
if [ ! -f .env.docker ]; then
  echo 'Run ./scripts/docker-up.sh first.' >&2
  exit 1
fi
if [ ! -f .env.demo ]; then
  umask 077
  printf 'DEMO_EMAIL=demo-%s@example.test\nDEMO_PASSWORD=%s\n' \
    "$(openssl rand -hex 6)" "$(openssl rand -hex 18)" > .env.demo
fi
set -a
. ./.env.demo
set +a
DEMO_ORIGIN="http://$(docker compose --env-file .env.docker port web 80)"
export DEMO_ORIGIN
docker compose --env-file .env.docker run --rm --no-deps \
  -e DEMO_EMAIL -e DEMO_PASSWORD -e DEMO_ORIGIN \
  -e DEMO_API_URL=http://api:3001 \
  migrate node --import tsx scripts/seed-demo.ts
printf 'Open %s and sign in with:\nEmail: %s\nPassword: %s\n' \
  "$DEMO_ORIGIN" "$DEMO_EMAIL" "$DEMO_PASSWORD"
