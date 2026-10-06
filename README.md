# Habit Tracker

A habit tracker under construction, driven by the two original PRDs and the product owner's later feature list. The app now includes Today check-ins, routine and schedule management, week/month habit history, one manual weekly streak freeze per routine, weekly tasks and energy/focus/motivation, a 10-area goal planner, insights, monthly reflections, account export/deletion, and a read-only local MCP connector. Account data is stored in PostgreSQL; the product owner removed browser-storage copies. The UI uses the approved terracotta, evergreen, cream and sage palette. **The local feature flows are implemented and database-tested; public production deployment remains unverified.**

## Run everything in Docker

Docker and OpenSSL are the only host dependencies; Node and npm run inside containers. From the repository root:

```sh
./scripts/docker-up.sh
```

The script creates ignored `.env.docker` with random local credentials on first run, builds the images, starts PostgreSQL, runs migrations, then starts the API and web containers. Open **http://127.0.0.1:8080**. The API is available through the same origin at `/api/v1`; readiness is `/health/ready` and Swagger is `/api/docs`. To change the port, edit `APP_PORT` in `.env.docker` and run the startup script again. Use the exact `127.0.0.1` origin for local auth.

```sh
./scripts/docker-test.sh
docker compose --env-file .env.docker logs -f api web
docker compose --env-file .env.docker down
```

The test script runs quality checks and migration/integration tests in Docker against a separate `habit_test` database. `down` keeps the named PostgreSQL volume. `down -v` deletes local database data. This Compose stack is for local development; it serves HTTP and does not meet production TLS, backup, or deployment requirements.

For the optional read-only Claude Desktop MCP connector, build the Docker profile and follow [MCP setup](docs/mcp.md):

```sh
docker compose --env-file .env.docker --profile ai build mcp
```

For host-based development with Node 24, use `.env.example`, `npm ci`, `npm run db:migrate`, and `npm run dev` against a separately running PostgreSQL service.

## Verification

Run `./scripts/docker-test.sh` for the complete local Docker check. Run `npm audit --audit-level=moderate` when the npm advisory endpoint is reachable. Integration tests use a separate migrated `habit_test` database and refuse to silently skip without a URL. CI tests Node 24 and a fresh PostgreSQL database, migration reruns, constraints, and quality gates.

## Project map

- `apps/web`: React/Vite frontend.
- `apps/api`: Fastify API, authentication, owner-scoped habits/tasks/goals/insights and PostgreSQL transactions.
- `apps/mcp`: token-scoped, read-only local MCP server.
- `packages/contracts`: shared schemas.
- `packages/domain`: pure calendar, schedule, streak and metric functions.
- `db/migrations`: immutable transactional SQL migrations.
- `docker` and `compose.yaml`: local all-container web/API/database stack.
- `plans/habit-tracker.md`: reviewed construction sequence.
- `docs/adr`: documented resolutions of contradictions.
- `docs/implementation.md`: phase status and remaining work.
- `docs/traceability.md`: requirement-level acceptance tracking.

See [architecture](docs/architecture.md), [operations](docs/operations.md), [implementation status](docs/implementation.md), and the unchanged PRDs for scope. The source is in the [public GitHub repository](https://github.com/mhdnaseeel/habit-tracker). No cloud deployment or paid provider account is configured.
