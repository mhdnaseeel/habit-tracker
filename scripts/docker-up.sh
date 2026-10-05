#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

if [ ! -f .env.docker ]; then
  command -v openssl >/dev/null 2>&1 || {
    echo 'OpenSSL is required to generate local Docker credentials.' >&2
    exit 1
  }
  umask 077
  printf 'POSTGRES_PASSWORD=%s\nACCESS_TOKEN_SECRET=%s\nAPP_PORT=8080\n' \
    "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env.docker
  echo 'Created .env.docker with random local credentials.'
fi

docker compose --env-file .env.docker up --build -d
echo "Habit Tracker: http://$(docker compose --env-file .env.docker port web 80)"
