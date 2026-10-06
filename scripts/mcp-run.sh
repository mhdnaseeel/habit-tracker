#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

if [ ! -f .env.docker ]; then
  echo 'Run ./scripts/docker-up.sh first.' >&2
  exit 1
fi
if [ -z "${MCP_READ_TOKEN:-}" ]; then
  echo 'MCP_READ_TOKEN is required.' >&2
  exit 1
fi

exec docker compose --env-file .env.docker --profile ai run --rm --no-deps -T -e MCP_READ_TOKEN mcp
