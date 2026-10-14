# Habit Tracker

A habit tracker driven by the two original PRDs and the product owner's later feature list. The app includes a time-based Today agenda, routine and schedule management, week/month habit history, one manual weekly streak freeze per routine, weekly tasks and energy/focus/motivation, a 10-area goal planner, insights, account-specific analysis reports, daily journal entries with blueprints and account-saved drafts, optional AI Mentor guidance, account export/deletion, and a read-only MCP connector with local stdio and remote OAuth access. Account data is stored in PostgreSQL; the product owner removed browser-storage copies. The UI uses the approved terracotta, evergreen, cream and sage palette. See [Daily Journal and AI Mentor](docs/journal-mentor.md) for privacy and API details.

## Connect an AI agent to the hosted MCP server

The production-deployed Habit Mentor MCP endpoint is **`https://habit-tracker-xard.onrender.com/mcp`**. It uses HTTPS Streamable HTTP and OAuth; it does **not** require this repository, Docker, a local server, a local MCP token, or an OpenAI API key. The connected AI agent uses its own model. The MCP server is hosted with the app on Render Free, which can sleep after inactivity and delay the first connection; this plan does not provide always-on production availability.

1. Create or sign in to your account at [Habit Tracker](https://habit-tracker-xard.onrender.com/). The hosted account is separate from any local Docker demo account.
2. In an AI agent that supports **remote MCP over Streamable HTTP with OAuth authorization-code/PKCE and dynamic client registration**, add a custom MCP server/connector. Set its server URL to **`https://habit-tracker-xard.onrender.com/mcp`** and select OAuth authentication if the client asks. Client menu names and configuration formats vary; use the client's remote MCP setup screen. Do not enter a local `htr_` token or a static bearer token.
3. Start the connection. The client should discover the server's OAuth metadata and open the Habit Tracker consent page. Enter your **hosted** account email and password there, review the requested **`habit.read`** scope, and approve read-only access. The permission covers your habits, check-ins, tasks, goals, insights, and journal data accessible through the tools below. Only connect a client you trust with that data; the client may send tool results to its own model provider.
4. Return to the AI agent and confirm that it lists the Habit Mentor tools. Ask it to use a tool, for example: “Use `get_today_context` and tell me which routines are due today and what I should focus on.” If the client supports MCP prompts, it may also show `daily_mentor`, `weekly_mentor`, and `journal_reflection`.
5. To remove access, open **Settings → Remote AI connections** in Habit Tracker and select **Disconnect** beside the client. Its grant then loses access. The OAuth client normally refreshes one-hour access tokens automatically; a grant expires after 30 days of inactivity.

The server exposes these **read-only** tools; it cannot complete habits, edit tasks, save journal entries, export an account, or change settings:

| Tool                        | Example use                                                   |
| --------------------------- | ------------------------------------------------------------- |
| `get_today_context`         | Today's due habits, timed activities, tasks, and active goals |
| `get_habit_summary`         | Habit list and recent consistency summary                     |
| `get_habit_history`         | Check-ins across a selected date range                        |
| `get_habit_details`         | One habit and its recent logs                                 |
| `get_task_summary`          | Tasks in a selected date range                                |
| `get_goal_progress`         | Active goals and progress                                     |
| `get_journal_blueprints`    | Available journal prompts, without private entries            |
| `get_journal_entry`         | One private daily journal entry                               |
| `get_weekly_review_context` | Habits, tasks, goals, and insights for a week                 |
| `get_mentor_context`        | Bounded context for guidance; journal dates/statuses only     |

For example, ask “Use `get_weekly_review_context` to identify two strengths and one practical next step this week,” or “Use `get_habit_history` for the last 14 days and separate observed patterns from guesses.” Only ask the agent to read a journal entry when you want that private text included. Date-range tools accept at most 31 dates; narrower requests and pagination help with large accounts.

If connection fails, first check [service readiness](https://habit-tracker-xard.onrender.com/health/ready) and allow for a Render Free cold start. An OAuth/redirect error may mean the client lacks remote MCP OAuth, PKCE, or a supported HTTPS/loopback callback; try a compatible client and reconnect. A `401` after connection usually means an expired or disconnected grant; reconnect and approve again. For `429`, wait before retrying. If a tool returns no records, check the account and requested dates; if it reports a size limit, shorten the range. A `5xx` or failed readiness check indicates a hosted service/database problem rather than a local process to start.

The hosted OAuth flow and a read-only tool call were verified with the official TypeScript MCP SDK v2 client. Individual AI products, including Claude and ChatGPT, have **not** been verified; their support for remote MCP and this OAuth flow can differ. See [MCP details and compatibility](docs/mcp.md) for the security model and current test status.

## Run everything in Docker

Docker and OpenSSL are the only host dependencies; Node and npm run inside containers. From the repository root:

```sh
./scripts/docker-up.sh
./scripts/docker-seed.sh
```

The script creates ignored `.env.docker` with random local credentials on first run, builds the images, starts PostgreSQL, runs migrations, then starts the API and web containers. Open **http://127.0.0.1:8080**. The API is available through the same origin at `/api/v1`; readiness is `/health/ready` and Swagger is `/api/docs`. To change the port, edit `APP_PORT` in `.env.docker` and run the startup script again. Use the exact `127.0.0.1` origin for local auth.

```sh
docker compose --env-file .env.docker logs -f api web
docker compose --env-file .env.docker down
```

The seed command creates an isolated demo account with seven sample routines, recent check-ins, tasks, four timed agenda blocks, a goal, mindset ratings, and a daily journal entry. It prints its generated login details and stores them in ignored `.env.demo`. Reruns reuse existing named records and add missing samples; they do not modify other accounts. `down` keeps the named PostgreSQL volume. `down -v` deletes local database data. This Compose stack is for local development; it serves HTTP and does not meet production TLS, backup, or deployment requirements.

For the optional read-only local MCP connector, build the Docker profile and follow [MCP setup](docs/mcp.md):

```sh
docker compose --env-file .env.docker --profile ai build mcp
```

## Host a free preview

The repository includes a [Render Blueprint and Neon setup guide](docs/deploy-free.md). It builds the `hosted` Docker target, serving the frontend and API from one HTTPS origin and applying PostgreSQL migrations at startup. Local account data is not copied to the cloud automatically. Render Free sleeps when idle; Neon Free has database limits; optional AI Suggestions prioritization requires separate OpenAI API credits.

## Analysis reports

Open **Reports** in the app for a current comparison, habits due today, pending and overdue tasks, open goal steps, routines that slipped, and a short priority list. This account-specific analysis works without an AI key. Use **Refresh analysis** after making changes and **Download report** to save a text copy.

For optional **AI Suggestions** prioritization, put a newly created OpenAI API key in the ignored `.env.docker` file as `OPENAI_API_KEY=...`, then run `./scripts/docker-up.sh` to recreate the API container. Do not put the key in the browser, `.env.example`, or Git. The API uses the server-side Responses API with `store: false` and sends only grounded candidate actions and week totals. The model chooses candidate IDs; it cannot add unsupported actions. The default model is `gpt-4.1-mini-2025-04-14`; set `OPENAI_REPORT_MODEL` in `.env.docker` to change it. Data-based suggestions remain available without API credits.

If AI generation reports exhausted credits, check the OpenAI project linked to the key; running the app locally does not supply API credits. The Reports screen continues to work without AI generation.

For host-based development with Node 24, use `.env.example`, `npm ci`, `npm run db:migrate`, and `npm run dev` against a separately running PostgreSQL service.

## Build checks

Run `npm run check` for formatting, lint, type checking, and builds. With the local Docker stack running, `npm run test:activities`, `npm run test:journal`, `npm run test:mcp`, and `npm run test:mcp-remote` exercise Today, journal, local MCP and remote OAuth MCP using disposable accounts. The stdio MCP test requires the optional MCP image. `npm run test:mentor-provider` checks structured provider responses and failure handling without using an API key. Run `npm audit --audit-level=moderate` when the npm advisory endpoint is reachable. See [Today agenda decisions](docs/today-agenda.md) for lifecycle and API details.

## Project map

- `apps/web`: React/Vite frontend.
- `apps/api`: Fastify API, authentication, owner-scoped habits/tasks/goals/insights/reports and PostgreSQL transactions.
- `apps/mcp`: token-scoped, read-only local MCP server.
- `packages/contracts`: shared schemas.
- `packages/domain`: pure calendar, schedule, streak and metric functions.
- `db/migrations`: immutable transactional SQL migrations.
- `docker` and `compose.yaml`: local all-container web/API/database stack.
- `plans/habit-tracker.md`: reviewed construction sequence.
- `docs/adr`: documented resolutions of contradictions.
- `docs/implementation.md`: phase status and remaining work.
- `docs/traceability.md`: requirement-level acceptance tracking.

See [architecture](docs/architecture.md), [operations](docs/operations.md), [implementation status](docs/implementation.md), and the unchanged PRDs for scope. The source is in the [public GitHub repository](https://github.com/mhdnaseeel/habit-tracker), and the hosted app is at [habit-tracker-xard.onrender.com](https://habit-tracker-xard.onrender.com/).
