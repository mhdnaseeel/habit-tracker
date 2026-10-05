#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

if [ ! -f .env.docker ]; then
  echo 'Run ./scripts/docker-up.sh first.' >&2
  exit 1
fi

if [ "$(docker compose --env-file .env.docker exec -T db psql -U habit -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='habit_test'")" != '1' ]; then
  docker compose --env-file .env.docker exec -T db createdb -U habit habit_test
fi

docker compose --env-file .env.docker run --rm --no-deps migrate sh -c '
  npm run check
  export DATABASE_URL="${DATABASE_URL%/habit}/habit_test"
  npm run db:migrate
  TEST_DATABASE_URL="$DATABASE_URL" npm run test:integration
'
