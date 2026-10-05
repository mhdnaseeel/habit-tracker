# Habit Tracker

A production application under construction, driven by the two original PRDs. **Not ready for production:** authentication and product workflows are not implemented. The web app currently shows an explicitly labelled foundation connection screen.

## Local setup

Use Node 24 LTS and npm. Docker provides PostgreSQL 17. Never use the example password in production.

```sh
npm ci
cp .env.example .env
POSTGRES_PASSWORD=habit_local_only docker compose up -d db
npm run db:migrate
npm run dev
```

Open http://127.0.0.1:5173. API: http://127.0.0.1:3001. Swagger: /api/docs (development only). Run scripts from repository root. The API intentionally fails startup if DATABASE_URL is missing; readiness returns 503 when the database is disconnected. A green readiness response verifies connectivity, not completed product features.

## Verification

```sh
npm run check
DATABASE_URL=postgresql://habit:password@localhost:5432/disposable_test npm run db:migrate
TEST_DATABASE_URL=postgresql://habit:password@localhost:5432/disposable_test npm run test:integration
npm audit --audit-level=moderate
```

Integration tests require a separate migrated disposable database and refuse to silently skip without a URL. They roll back their fixtures. CI tests Node 24 and a fresh PostgreSQL database, migration reruns, constraints, and quality gates. Domain tests cover local dates, DST boundaries, schedules, streaks, historical correction, partial goal values and quiet hours.

## Project map

- `apps/web`: React/Vite frontend.
- `apps/api`: Fastify configuration, HTTP foundation and PostgreSQL transactions.
- `packages/contracts`: shared schemas.
- `packages/domain`: pure calendar, schedule, streak and metric functions.
- `db/migrations`: immutable transactional SQL migrations.
- `plans/habit-tracker.md`: reviewed construction sequence.
- `docs/adr`: documented resolutions of contradictions.
- `docs/implementation.md`: phase status and remaining work.
- `docs/traceability.md`: requirement-level acceptance tracking.

See [architecture](docs/architecture.md), [operations](docs/operations.md) and the unchanged PRDs for scope. No external cloud deployment, paid provider account or remote Git repository is configured.
