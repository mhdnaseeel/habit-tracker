# Living implementation checklist

Updated 2026-10-06. The source PRDs remain unchanged. The later product-owner palette decision is recorded in ADR-0002. The product owner explicitly removed the browser-storage-copy feature; account data persists in PostgreSQL. ECC planning, security-review and browser-qa skills informed this work. Confidence is high for the local Docker stack and database-backed API flows. Browser accessibility and production deployment remain unverified.

| Area                                              | Current state                                                                                                                                                          | Remaining work                                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Foundation                                        | npm workspaces, strict TypeScript, Vite/React, Fastify, full local Docker Compose stack, PostgreSQL migration, CI, health/readiness and OpenAPI implemented            | Remote CI verification; telemetry and release deployment                                      |
| Authentication                                    | Signup/login, Argon2 password hashes, JWT access token, rotating HttpOnly refresh cookie, logout and owner profile routes implemented                                  | Reset, OAuth, stronger concurrent refresh handling, deployment security review                |
| Habits                                            | Owner-scoped create/edit/archive, category validation, daily/weekly/monthly schedules, check-ins, undo, freeze, streaks, Today and weekly history API implemented      | Reminder links and broader concurrency coverage                                               |
| Tasks                                             | Owner-scoped one-time task create/list/edit/complete/undo/archive and unfinished carry-over verified against PostgreSQL; Today UI exposes create/complete/undo/archive | Recurring tasks, richer task UI and history                                                   |
| Frontend                                          | Auth, Today, routine create/edit/delete, six categories, custom weekly days, weekly progress, streaks, week-by-week history and tasks implemented; responsive CSS      | Real browser/mobile/accessibility QA; broader PRD goals, analytics, journal and profile UI    |
| Goals, reflections, analytics, jobs, offline sync | Schema or pure domain functions only                                                                                                                                   | Product APIs, UI and end-to-end verification                                                  |
| Release audit                                     | Open                                                                                                                                                                   | Full PRD acceptance, security/accessibility/performance tests, operations and live deployment |

## Verification evidence

- `./scripts/docker-up.sh` built and started PostgreSQL, migration, API and web containers. PostgreSQL, API and web health checks passed; the migration applied `001_initial.sql`. Web `/`, proxied `/health/ready`, and `/api/v1/session` returned HTTP 200 on `127.0.0.1:8080`.
- `./scripts/docker-test.sh` passed inside Docker on 2026-10-06: formatting, lint, strict type checking, 18 unit/foundation tests, both builds, and 15 PostgreSQL integration tests against separate `habit_test`. Tests cover category validation, schedule-aware history, archived history and user isolation.
- A proxied HTTP smoke flow passed for signup, habit creation, task creation, and Today reads; its temporary account was removed afterward.
- Browser interaction previously verified signup, habit creation and partial/full completion with a real API/database. Browser verification of the new routine editing and history screens did not run because automatic approval review could not complete after a usage limit was hit.
- Docker build-time `npm ci` and `npm prune` audits reported 0 vulnerabilities. This is a point-in-time npm advisory check, not a full security audit.
- No supplied visual baselines or deployed environment exist. Production verdict: **DO NOT SHIP**.

## Source integrity

The original PRDs were not modified. Their recorded SHA-256 digests are:

- Backend: `0747a78ddf9944809bb4503db011cdb51e22a3ab33ae9634e0f54e619094725a`
- UI/UX: `f8b794d9652f8f32bb21b25f5f48b65f96c0526c9dacc90b2dea786ad8fb0c3b`

## Next dependency

Perform browser and accessibility QA of the current screens, then continue the remaining PRD workflows. Production deployment still needs TLS, provider accounts, backup/restore and monitoring evidence.
