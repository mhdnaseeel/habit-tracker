# Development setup

This page keeps the development-only workflows separate from the [hosted MCP connector guide](mcp.md). The hosted app and MCP endpoint do not depend on this stack.

## Docker stack

Docker and OpenSSL are the only host dependencies; Node and npm run inside containers. From the repository root:

```sh
./scripts/docker-up.sh
./scripts/docker-seed.sh
```

The startup script creates ignored `.env.docker` with random credentials on first run, builds the images, starts PostgreSQL, runs migrations, and starts the API and web containers. Open `http://127.0.0.1:8080`. The API is available through the same origin at `/api/v1`; readiness is `/health/ready` and Swagger is `/api/docs`. To change the port, edit `APP_PORT` in `.env.docker` and rerun the startup script. Use the exact `127.0.0.1` origin for development auth.

```sh
docker compose --env-file .env.docker logs -f api web
docker compose --env-file .env.docker down
```

The seed script creates an isolated demo account with seven sample routines, recent check-ins, tasks, four timed agenda blocks, a goal, mindset ratings, and a daily journal entry. It prints generated login details and stores them in ignored `.env.demo`. Reruns reuse existing named records and add missing samples; they do not modify other accounts. `down` keeps the named PostgreSQL volume; `down -v` deletes development database data. This Compose stack serves HTTP and does not meet production TLS, backup, or deployment requirements.

## Optional stdio MCP connector

The development connector uses a 90-day read-only account token created in **Settings → Read-only assistant access**. The backend stores only its SHA-256 hash, checks expiry and revocation on every request, joins the token to its owner, and accepts it only for an explicit allowlist of GET routes. At most five active tokens are allowed. Do not put this `htr_` token into a public proxy or remote OAuth client.

Build the connector image:

```sh
docker compose --env-file .env.docker --profile ai build mcp
```

In Settings, create a labeled token using the development account's password and copy it once. Configure a client that supports MCP stdio, replacing the path and token:

```json
{
  "mcpServers": {
    "habit-tracker": {
      "command": "/ABSOLUTE/PATH/TO/Habit Tracker/scripts/mcp-run.sh",
      "env": {
        "MCP_READ_TOKEN": "PASTE_READ_ONLY_TOKEN_FROM_SETTINGS"
      }
    }
  }
}
```

The launcher uses Docker and sets `HABIT_API_URL=http://api:3001` inside the private Compose network. The stack must remain running. Do not commit tokens or put them in shell history. Stdio stdout contains only MCP messages; diagnostics use stderr. Revoke the token in Settings when the client is no longer trusted.

For a host-run API, set `HABIT_API_URL=http://127.0.0.1:3001` and `MCP_READ_TOKEN`, then run `npm run build -w @habit/mcp && npm start -w @habit/mcp`. The connector accepts HTTP only for the Compose hostname and loopback; use HTTPS for any other backend host.

## AI suggestions and verification

For optional AI Suggestions prioritization, put a newly created OpenAI API key in ignored `.env.docker` as `OPENAI_API_KEY=...`, then run `./scripts/docker-up.sh` to recreate the API container. Do not put the key in the browser, `.env.example`, or Git. The default model is `gpt-4.1-mini-2025-04-14`; set `OPENAI_REPORT_MODEL` in `.env.docker` to change it. AI generation requires credits in the OpenAI project associated with the key.

For host-based development with Node 24, use `.env.example`, `npm ci`, `npm run db:migrate`, and `npm run dev` against a separately running PostgreSQL service.

Run `npm run check` for formatting, lint, type checking, and builds. With the Docker stack running, `npm run test:activities`, `npm run test:journal`, `npm run test:mcp`, and `npm run test:mcp-remote` exercise Today, journal, stdio MCP, and remote OAuth MCP using disposable accounts. The stdio test requires the optional MCP image. `npm run test:mentor-provider` checks structured provider responses and failure handling without using an API key. Run `npm audit --audit-level=moderate` when the npm advisory endpoint is reachable.

If the stdio connector reports authorization failure, check that the stack is healthy with `docker compose --env-file .env.docker ps` and that its token is active. A `401` means the token expired or was revoked; create a new one. A `429` means wait before retrying. For a size-limit error, narrow the request range.
