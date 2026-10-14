# Living implementation checklist

Updated 2026-10-14. The source PRDs remain unchanged. Later product-owner decisions are recorded in ADRs 0002–0007. Account data persists in PostgreSQL; the browser-storage-copy feature was removed. The current deployment is a free Render preview backed by Neon, and a separate local Docker stack is available. Neither environment has measured availability or full PRD acceptance evidence.

| Area                       | Current state                                                                                                                                               | Remaining work                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Foundation                 | npm workspaces, strict TypeScript, Vite/React, Fastify, Docker Compose, PostgreSQL migrations, CI, health/readiness and OpenAPI                             | Telemetry, backup/restore drill and release operations                                            |
| Authentication and account | Signup/login, Argon2, JWT, rotating HttpOnly refresh cookie, logout, profile, data export and password-confirmed deletion                                   | Password reset, broader OAuth sign-in, backup erasure verification and production security review |
| Habits                     | Owner-scoped create/edit/archive, categories, daily/weekly/monthly schedules, check-in/undo, one manual weekly freeze, streaks, Today ring and history grid | Browser interaction and mobile accessibility QA; reminders                                        |
| Tasks and mindset          | Weekly task lists and daily rings, copy yesterday, complete/undo/archive, daily energy/focus/motivation                                                     | Browser interaction QA; recurring tasks from broader PRD                                          |
| Goals and insights         | 10-area goals, steps, deadlines, habit links, progress, trends and personal leaderboard                                                                     | Browser interaction QA; broader numeric-goal PRD semantics                                        |
| Daily journal and MCP      | Version-checked daily journal; read-only stdio MCP; HTTPS Streamable HTTP MCP with OAuth PKCE, revocation and account consent                               | Third-party client OAuth compatibility test; wider failure/security tests; browser interaction QA |
| Release audit              | Local checks and hosted unauthenticated MCP smoke checks pass                                                                                               | Full PRD acceptance, accessibility/performance evidence, monitoring and restore drill             |

## Verification evidence

- On 2026-10-14, `npm run check`, `npm audit --audit-level=moderate`, `npm run test:mcp`, `npm run test:mcp-remote`, `npm run test:activities`, `npm run test:journal` and `npm run test:mentor-provider` passed locally. The integration tests use disposable accounts against Docker.
- [GitHub CI for commit `70a3ff1`](https://github.com/mhdnaseeel/habit-tracker/actions/runs/38504282948) passed formatting, lint, type checking, build and dependency audit. A later revision adds the Docker-backed integration suite to CI; its first run must pass before that coverage is counted.
- The hosted preview returned HTTP 200 for `/health/ready` and OAuth protected-resource metadata, and HTTP 401 for anonymous `/mcp`. A credentialed third-party client connection to the hosted service has not been tested.
- Historical tests removed at the owner's request do not provide current regression coverage. See the [MCP phase audit](mcp-phase-audit.md) for the scoped review.

## Source integrity

The original PRDs were not modified. Their SHA-256 digests are:

- Backend: `0747a78ddf9944809bb4503db011cdb51e22a3ab33ae9634e0f54e619094725a`
- UI/UX: `f8b794d9652f8f32bb21b25f5f48b65f96c0526c9dacc90b2dea786ad8fb0c3b`

## Next dependency

Test OAuth authorization through a chosen real client against the hosted endpoint, then verify mobile/browser accessibility and complete the broader PRD and operations audit. Read-only MCP write tools remain intentionally excluded.
