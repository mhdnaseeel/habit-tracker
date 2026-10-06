# Living implementation checklist

Updated 2026-10-07. The source PRDs remain unchanged. Later product-owner choices are recorded in ADR-0002 and ADR-0003. The product owner removed the browser-storage-copy feature and later requested removal of automated test files. Account data persists in PostgreSQL. The Docker seed command supplies a separate manual-review account. Browser accessibility and production deployment remain unverified.

| Area                       | Current state                                                                                                                                                          | Remaining work                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Foundation                 | npm workspaces, strict TypeScript, Vite/React, Fastify, local Docker Compose, PostgreSQL migrations, CI, health/readiness and OpenAPI                                  | Telemetry and release deployment                                                              |
| Authentication and account | Signup/login, Argon2, JWT, rotating HttpOnly refresh cookie, logout, profile, data export and password-confirmed deletion                                              | Reset, OAuth, production security review and backup erasure process                           |
| Habits                     | Owner-scoped create/edit/archive, categories, daily/weekly/monthly schedules, check-in/undo, one manual weekly freeze, streaks, Today ring and week/month history grid | Browser interaction and mobile accessibility QA; reminders                                    |
| Tasks and mindset          | Weekly task lists and daily rings, copy yesterday idempotently, complete/undo/archive, daily 1–5 energy/focus/motivation                                               | Browser interaction QA; recurring tasks from broader PRD                                      |
| Goals and insights         | 10-area goals, steps, deadlines, habit links, progress, consistency trends, strongest/slipping and personal leaderboard                                                | Browser interaction QA; broader numeric-goal PRD semantics                                    |
| Monthly reflection and MCP | Version-checked monthly journal; revocable read-only local stdio MCP tools for account data                                                                            | Browser interaction QA; remote HTTPS MCP deployment if requested                              |
| Release audit              | Open                                                                                                                                                                   | Full PRD acceptance, security/accessibility/performance tests, operations and live deployment |

## Verification evidence

- `./scripts/docker-up.sh` built and started PostgreSQL, migration, API and web containers. PostgreSQL, API and web health checks passed; the migration applied `001_initial.sql`. Web `/`, proxied `/health/ready`, and `/api/v1/session` returned HTTP 200 on `127.0.0.1:8080`.
- Historical evidence: on 2026-10-06, the Docker suite passed 19 unit/foundation tests and 21 PostgreSQL integration tests. Their files were removed on 2026-10-07 at the product owner's request; this evidence no longer represents an active regression suite.
- Earlier [GitHub quality gates](https://github.com/mhdnaseeel/habit-tracker/actions/runs/37503236638) passed with the automated suite on commit `cb00c8d`; new commits use formatting, lint, typecheck, builds, and dependency audit only.
- A proxied HTTP smoke flow passed for signup, habit creation, task creation, and Today reads; its temporary account was removed afterward.
- Browser interaction previously verified signup, habit creation and partial/full completion with a real API/database. Browser verification of the new routine editing and history screens did not run because automatic approval review could not complete after a usage limit was hit.
- Docker build-time `npm ci` and `npm prune` audits reported 0 vulnerabilities. This is a point-in-time npm advisory check, not a full security audit.
- No supplied visual baselines or deployed environment exist. Production verdict: **DO NOT SHIP**.

## Source integrity

The original PRDs were not modified. Their recorded SHA-256 digests are:

- Backend: `0747a78ddf9944809bb4503db011cdb51e22a3ab33ae9634e0f54e619094725a`
- UI/UX: `f8b794d9652f8f32bb21b25f5f48b65f96c0526c9dacc90b2dea786ad8fb0c3b`

## Next dependency

Perform browser and accessibility QA of the expanded screens. Production deployment still needs TLS, backup/restore and monitoring evidence. The broader PRD remains open where it calls for reminders, OAuth, offline sync and cloud operations.
