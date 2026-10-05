# Living implementation checklist

Updated 2026-10-05. ECC blueprint used for construction planning and delegated adversarial review; ECC browser-qa used for live foundation checks. Both PRDs read completely and left unchanged. Confidence high for recorded local evidence; untested product claims remain unknown.

| Phase                 | Status                             | Files / evidence                                                                                    | Remaining acceptance work                                                                     |
| --------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| PRD analysis          | Reviewed                           | plans/habit-tracker.md; ADR-0001; docs/traceability.md                                              | Exact visual reference assets missing; deployment/provider specifics unknown                  |
| 1 Bootstrap           | Locally verified                   | npm lock/workspaces, TypeScript, ESLint/Prettier, Vite/React, Fastify, Compose, Dockerfile, CI      | Node 24/container/remote CI verification pending; app UI deliberately limited to setup        |
| 2 Foundation          | Partially implemented and verified | apps/api/src; health/OpenAPI/config/logging/security/transactions; foundation tests                 | Auth-aware rate limits, telemetry/metrics/tracing and full API conventions pending            |
| 3 Database            | Initial schema verified            | db/migrations/001_initial.sql; migration checksums/locks; real PostgreSQL negative constraint tests | Complete repository behavior, archive/delete/retention/concurrency/lifecycle coverage pending |
| 4 Authentication      | Planned                            | sessions/reset schema only                                                                          | Real signup/login/JWT/refresh/revocation/reset/OAuth/abuse tests                              |
| 5 Habit management    | Planned                            | Input schema and schedule history model                                                             | Authenticated CRUD, ownership, reminders, links                                               |
| 6 Completion engine   | Domain only, tested                | packages/domain; habit instance constraints                                                         | Transactional check-ins/partial/undo/freeze APIs; occurrence generation                       |
| 7 Streak/recovery     | Domain only, tested                | deterministic replay + best-ever distinction                                                        | Transactional audit/cache updates; allowance spending; integration/concurrency tests          |
| 8 Goals               | Domain calculation only, tested    | quantitativeGoal; temporal link schema                                                              | Full goal/milestone/link services and APIs                                                    |
| 9 Tasks               | Domain carry-over only, tested     | carryOver; recurrence/occurrence schema                                                             | Recurrence generation, authenticated task workflow and history                                |
| 10 History/calendar   | Planned                            | owner/date indexes                                                                                  | History/read-model APIs and integrated calendar                                               |
| 11 Reflections        | Planned                            | dated private journal schema                                                                        | CRUD/authorisation/privacy tests and journal UI                                               |
| 12 Today              | Planned                            | No simulated dashboard                                                                              | Consolidated read endpoint and optimistic integrated UI                                       |
| 13 Analytics          | Domain fraction only, tested       | completionRate; consent default false                                                               | Actual queries/trends/heatmaps/consistency, collection opt-out enforcement                    |
| 14 Notifications/jobs | Planned                            | Outbox/lease/dedupe/dead status schema; quiet-hours function                                        | Worker scheduling, providers, retry/crash/idempotency/DST integration                         |
| 15 Offline/sync       | Planned                            | Receipt and change-feed schema                                                                      | Account-scoped habit/task queues, conflict APIs, cursor retention/SSE                         |
| 16 Frontend           | Setup connection screen only       | apps/web                                                                                            | All five product screens, grids/goals/tasks/journal/profile/onboarding/states/themes          |
| 17 Accessibility      | Setup screen partial verification  | axe scan, responsive smoke, retry hit area/focus                                                    | Full product keyboard/screen-reader/contrast/high-contrast/reduced-motion E2E                 |
| 18 Security           | Foundation only                    | Validated config, headers, CORS, body/rate limits, private-data logging exclusions                  | Authentication/CSRF/session/owner security tests, pen test, secrets/cloud controls            |
| Release audit         | Not complete                       | This checklist                                                                                      | All source acceptance criteria and operations evidence required                               |

## Local verification evidence

- Formatter, ESLint, strict type checking, unit/API tests and both production builds pass on host Node 25.8.2. CI explicitly targets Node 24; remote CI has not run.
- Initial migration applied to a clean isolated PostgreSQL 17 database and reapplied without changes. 2 real database tests passed: cross-user habit/goal relationships, duplicate check-ins, active case-insensitive habit names, invalid recurrence/completion, monthly freeze uniqueness, archive-name reuse and transaction rollback.
- Dependency audit after patched Swagger UI upgrade: 0 reported vulnerabilities. This is a point-in-time dependency scan, not a security certification.
- Actual API startup initially failed from hook registration after ready(); fixed and guarded by a lifecycle regression test. API and database connected from the live browser.
- Browser read-only smoke checks: no horizontal overflow at actual 375px, 768px and 1440px layouts. Native window resize clamped the first attempt to 500px; corrected with device emulation before claiming 375px.
- Stopping the real API showed unavailable state; restarting and clicking Retry restored connected state. Retry target height 44px; visible solid focus outline.
- axe WCAG 2.0/2.1 A/AA scan of setup screen: 0 violations, 15 passing checks. No screen-reader or complete product audit claimed. Initial missing favicon corrected; subsequent page console had no errors/warnings.
- No supplied visual baselines: visual regression verdict INCONCLUSIVE. Overall production verdict DO NOT SHIP, because product workflows are not implemented.

## Source integrity

SHA-256 preserved during this run:

- Backend: `0747a78ddf9944809bb4503db011cdb51e22a3ab33ae9634e0f54e619094725a`
- UI/UX: `f8b794d9652f8f32bb21b25f5f48b65f96c0526c9dacc90b2dea786ad8fb0c3b`

## Next dependency

Authentication and ownership form the next implementation boundary. Do not expose domain CRUD before authenticated owner scoping. No PRD product feature is considered accepted based only on schema or pure functions. External provider credentials and a deployment account become needed for live delivery and infrastructure validation; they do not block local implementation.
