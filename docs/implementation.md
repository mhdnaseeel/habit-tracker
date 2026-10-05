# Living implementation checklist

Updated 2026-10-05. The source PRDs remain unchanged. The later product-owner palette decision is recorded in ADR-0002. ECC planning, security-review and browser-qa skills informed this work. Confidence is high for the local Docker stack and tested authentication, habit, and one-time task API flows. Browser accessibility and production deployment remain unverified.

| Area                                              | Current state                                                                                                                                                          | Remaining work                                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Foundation                                        | npm workspaces, strict TypeScript, Vite/React, Fastify, full local Docker Compose stack, PostgreSQL migration, CI, health/readiness and OpenAPI implemented            | Remote CI verification; telemetry and release deployment                                      |
| Authentication                                    | Signup/login, Argon2 password hashes, JWT access token, rotating HttpOnly refresh cookie, logout and owner profile routes implemented                                  | Reset, OAuth, stronger concurrent refresh handling, deployment security review                |
| Habits                                            | Authenticated owner-scoped CRUD, partial check-ins, skip/freeze, undo, streak recalculation and Today habit read implemented                                           | Reminder links, richer editing, complete history/calendar and concurrency coverage            |
| Tasks                                             | Owner-scoped one-time task create/list/edit/complete/undo/archive and unfinished carry-over verified against PostgreSQL; Today UI exposes create/complete/undo/archive | Recurring tasks, richer task UI and history                                                   |
| Frontend                                          | Auth, Today habits and tasks, habit creation/list/archive, accessible form labels and responsive layout implemented                                                    | Goals, calendar, analytics, journal, profile, offline and full screen-reader/mobile QA        |
| Goals, reflections, analytics, jobs, offline sync | Schema or pure domain functions only                                                                                                                                   | Product APIs, UI and end-to-end verification                                                  |
| Release audit                                     | Open                                                                                                                                                                   | Full PRD acceptance, security/accessibility/performance tests, operations and live deployment |

## Verification evidence

- `./scripts/docker-up.sh` built and started PostgreSQL, migration, API and web containers. PostgreSQL, API and web health checks passed; the migration applied `001_initial.sql`. Web `/`, proxied `/health/ready`, and `/api/v1/session` returned HTTP 200 on `127.0.0.1:8080`.
- `./scripts/docker-test.sh` passed inside Docker: formatting, lint, strict type checking, 17 unit/foundation tests, both builds, and 14 PostgreSQL integration tests against separate `habit_test`.
- A proxied HTTP smoke flow passed for signup, habit creation, task creation, and Today reads; its temporary account was removed afterward.
- Browser interaction previously verified signup, habit creation and partial/full completion with a real API/database. Browser verification after the latest changes did not run because automatic approval review could not complete after a usage limit was hit.
- Docker build-time `npm ci` and `npm prune` audits reported 0 vulnerabilities. This is a point-in-time npm advisory check, not a full security audit.
- No supplied visual baselines or deployed environment exist. Production verdict: **DO NOT SHIP**.

## Source integrity

The original PRDs were not modified. Their recorded SHA-256 digests are:

- Backend: `0747a78ddf9944809bb4503db011cdb51e22a3ab33ae9634e0f54e619094725a`
- UI/UX: `f8b794d9652f8f32bb21b25f5f48b65f96c0526c9dacc90b2dea786ad8fb0c3b`

## Next dependency

Perform browser and accessibility QA of the current screens, then continue the remaining PRD workflows. Production deployment still needs TLS, provider accounts, backup/restore and monitoring evidence.
