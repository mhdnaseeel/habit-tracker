# Habit Tracker construction plan

Source: both root PRDs, fully reviewed 2026-10-05. The actual UI filename contains a colon. Preserve both documents unchanged. This plan governs sequencing; PRDs govern product requirements. No implementation is production-ready until all acceptance gates pass.

## Baseline

Only two PRDs and .DS_Store existed. Node 25.8.2, npm 11.11.1, Python, Git, gh and Docker CLI available. No Git repository, app, database configuration, CI or environment files. PostgreSQL CLI absent. Docker socket initially inaccessible within sandbox. Production targets Node 24 LTS; host Node is development-only until CI verifies Node 24.

## Construction steps

1. Bootstrap npm TypeScript workspaces: React/Vite web, Fastify REST API, domain and contract packages, lint/format/typecheck/build/CI/Compose. Exit: clean install and all applicable checks pass. Rollback: remove only generated bootstrap files.
2. Foundation: validated configuration, structured redacted logging, errors, validation, headers, request IDs, health/readiness, PostgreSQL pool and transactional migration runner. Exit: API contract tests and clean migration tests pass.
3. Persistence: all PRD entities, ownership constraints, recurrence revisions, task occurrences, freeze ledger, refresh sessions, audit/outbox, sync changes and idempotency. Exit: clean PostgreSQL migrations plus negative constraint tests.
4. Authentication: signup/login/refresh/logout/all sessions/password reset, hashing, rotation, replay protection, abuse limits, owner checks. Exit: real database API tests for every endpoint, cross-user attacks and token replay.
5. Habits: CRUD/archive, goals, schedules, quantitative check-ins/undo/skip, deterministic local-date occurrences and streak engine. Exit: DST/leap/timezone/schedule-history/concurrency/idempotency tests.
6. Goals/tasks/reflections: complete CRUD, milestones/progress definitions, weekly recurrence and carry-over, private dated journals. Exit: owner isolation, partial goal values/link intervals, analytics consent enforcement, concurrency and calculation tests.
7. Read models: today, history/calendar, analytics, pagination/search/order. Exit: mathematically defined metrics, contract tests, realistic query performance/load measurements.
8. Jobs: reminder eligibility, quiet hours, provider adapters, transactional outbox, leased workers, retries/dead letters, export/erasure, retention and cleanup. Exit: crash/retry/DST/provider integration tests; real credentials required for live deliveries.
9. Sync: durable account-scoped habit and task mutation queue, cursor feed, revisions/conflicts, reconnect and duplicate prevention. Exit: two-device/offline/replay tests. Then authenticated SSE invalidation.
10. Frontend: tokens/components, five primary sections, journal/settings utilities, onboarding, real APIs, grids/charts/forms, all states, high-contrast/light/dark themes, en-IN dates, persisted once-only onboarding. Exit: E2E flows, keyboard/focus, axe and viewport checks.
11. Operations: containers, IaC, TLS/encryption/secrets, monitoring/runbooks, backups/restore, dependency scans, load tests. Exit: staging rehearsal with deployment account and provider configuration.
12. Final audit: every traceability row accepted, no fake logic, all checks green, verified clean startup and restoration. Exit: evidence recorded against each PRD acceptance criterion.

Each step depends on the previous stable foundation. Step 10 can proceed by integrated feature slices after steps 4–7; do not expose unimplemented controls. Every step updates docs/implementation.md and docs/traceability.md. Every commit must be coherent and pass applicable checks. No remote configured: local workflow until one is supplied. Deployment and paid service provisioning require a concrete target and credentials; code and validation continue independently.

## Invariants

Backend authoritative; ownership from auth; explicit local calendar dates; UTC instants; transactionally consistent writes; existing history survives schedule changes and archive; no journal text in logs; PRDs unchanged. Never mark a phase complete on code existence alone.
