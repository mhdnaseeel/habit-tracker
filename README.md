# Habit Tracker

A habit tracker driven by the two original PRDs and the product owner's later feature list. The app includes a time-based Today agenda, routine and schedule management, week/month habit history, one manual weekly streak freeze per routine, weekly tasks and energy/focus/motivation, a 10-area goal planner, insights, account-specific analysis reports, daily journal entries with blueprints and account-saved drafts, optional AI Mentor guidance, account export/deletion, and a read-only remote MCP connector. Account data is stored in PostgreSQL; the product owner removed browser-storage copies. The UI uses the approved terracotta, evergreen, cream and sage palette. See [Daily Journal and AI Mentor](docs/journal-mentor.md) for privacy and API details.

## Connect an AI agent to the hosted MCP server

The deployed Habit Mentor MCP endpoint is **`https://habit-tracker-xard.onrender.com/mcp`**. It uses HTTPS Streamable HTTP and OAuth; connecting requires only a compatible AI client and a Habit Tracker account. The client uses its own model, so no OpenAI API key is needed for MCP. The server is hosted with the app on Render Free, which can sleep after inactivity and delay the first connection; this plan does not provide always-on production availability.

1. Create or sign in to your account at [Habit Tracker](https://habit-tracker-xard.onrender.com/).
2. In an AI agent that supports **remote MCP over Streamable HTTP with OAuth authorization-code/PKCE and dynamic client registration**, add a custom MCP server/connector. Set its server URL to **`https://habit-tracker-xard.onrender.com/mcp`** and select OAuth authentication if the client asks. Client menu names and configuration formats vary; use the client's remote MCP setup screen. Do not enter a static bearer token.
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

If connection fails, first check [service readiness](https://habit-tracker-xard.onrender.com/health/ready) and allow for a Render Free cold start. An OAuth/redirect error may mean the client lacks remote MCP OAuth, PKCE, or a supported callback; try a compatible client and reconnect. A `401` after connection usually means an expired or disconnected grant; reconnect and approve again. For `429`, wait before retrying. If a tool returns no records, check the account and requested dates; if it reports a size limit, shorten the range. A `5xx` or failed readiness check indicates a hosted service/database problem.

The hosted OAuth flow and a read-only tool call were verified with the official TypeScript MCP SDK v2 client. Individual AI products, including Claude and ChatGPT, have **not** been verified; their support for remote MCP and this OAuth flow can differ. See [MCP details and compatibility](docs/mcp.md) for the security model and current test status.

## Host a free preview

The repository includes a [Render Blueprint and Neon setup guide](docs/deploy-free.md). It builds the `hosted` Docker target, serving the frontend and API from one HTTPS origin and applying PostgreSQL migrations at startup. Render Free sleeps when idle; Neon Free has database limits; optional AI Suggestions prioritization requires separate OpenAI API credits.

## Analysis reports

Open **Reports** in the app for a current comparison, habits due today, pending and overdue tasks, open goal steps, routines that slipped, and a short priority list. This account-specific analysis works without an AI key. Use **Refresh analysis** after making changes and **Download report** to save a text copy.

Optional **AI Suggestions** prioritization uses a server-side OpenAI API key and the Responses API with `store: false`. It sends only grounded candidate actions and week totals. The model chooses candidate IDs; it cannot add unsupported actions. Data-based suggestions remain available without API credits. If AI generation reports exhausted credits, check the OpenAI project linked to the server's key; the Reports screen continues to work without AI generation.

## Build checks

Run `npm run check` for formatting, lint, type checking, and builds. CI also runs the integration suite and `npm audit --audit-level=moderate`. See [development setup and tests](docs/local-development.md) and [Today agenda decisions](docs/today-agenda.md) for implementation details.

## Project map

- `apps/web`: React/Vite frontend.
- `apps/api`: Fastify API, authentication, owner-scoped habits/tasks/goals/insights/reports and PostgreSQL transactions.
- `apps/mcp`: read-only MCP tool definitions shared by the hosted connector.
- `packages/contracts`: shared schemas.
- `packages/domain`: pure calendar, schedule, streak and metric functions.
- `db/migrations`: immutable transactional SQL migrations.
- `docker` and `compose.yaml`: container images and development stack.
- `plans/habit-tracker.md`: reviewed construction sequence.
- `docs/adr`: documented resolutions of contradictions.
- `docs/implementation.md`: phase status and remaining work.
- `docs/traceability.md`: requirement-level acceptance tracking.

See [architecture](docs/architecture.md), [operations](docs/operations.md), [implementation status](docs/implementation.md), and the unchanged PRDs for scope. The source is in the [public GitHub repository](https://github.com/mhdnaseeel/habit-tracker), and the hosted app is at [habit-tracker-xard.onrender.com](https://habit-tracker-xard.onrender.com/).
