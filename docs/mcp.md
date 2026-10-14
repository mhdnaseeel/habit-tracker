# Habit Mentor MCP: hosted connector

The hosted Habit Mentor MCP server lets a compatible AI client read one Habit Tracker account and reason with that client's model. The server itself makes no model API calls and requires no model-provider key. It is available at **`https://habit-tracker-xard.onrender.com/mcp`** over HTTPS Streamable HTTP, without running a server on your device.

## Connect a remote AI client

1. Create or sign in to a [Habit Tracker account](https://habit-tracker-xard.onrender.com/).
2. In a client supporting remote MCP over Streamable HTTP, OAuth authorization code with PKCE S256, and dynamic client registration, add a custom connector with the URL **`https://habit-tracker-xard.onrender.com/mcp`**. Choose OAuth authentication if the client offers a choice; no static token is needed.
3. Follow the client's authorization link. The Habit Tracker consent page asks for your account email and password and displays the **`habit.read`** permission. Approve only if you trust the client with the account data listed below. The client may send tool results to its own model provider.
4. After returning to the client, confirm it discovers tools. Ask, for example, “Use `get_today_context` to show what is due today and identify up to three practical priorities.”
5. To end access, open **Settings → Remote AI connections** in Habit Tracker and select **Disconnect** next to the client.

The client discovers the protected-resource and authorization-server metadata, registers as a public client, and exchanges an authorization code for an account-bound token. Access tokens expire after one hour; refresh tokens rotate on use; grants expire after 30 days of inactivity. Disconnecting immediately blocks further tool access. The app does not display raw OAuth tokens in the browser.

## Data and permissions

The backend checks the OAuth token's expiry, resource, grant and account owner on each request. The MCP route can call only an explicit allowlist of owner-scoped GET endpoints. No tool accepts a user ID or unrestricted database query. The connector cannot export an account, change settings, invoke AI Mentor inference, or write any habit, task, goal or journal data.

All tools are read-only. Dates use the account's timezone and `YYYY-MM-DD` format; date ranges are limited to 31 dates.

| Tool                        | Data and limits                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `get_today_context`         | Account timezone, local date, due habits, activity blocks, tasks, up to 10 active goals |
| `get_habit_summary`         | One 20-habit page and existing four-week insights                                       |
| `get_habit_history`         | Habit grid/history for up to 31 dates                                                   |
| `get_habit_details`         | One owned habit and its logs for up to 31 dates                                         |
| `get_task_summary`          | Tasks for up to 31 dates                                                                |
| `get_goal_progress`         | Up to 30 active goals with backend-computed progress and total count                    |
| `get_journal_blueprints`    | Template names and prompts, without private entries                                     |
| `get_journal_entry`         | One private daily entry; use only when relevant to the user's request                   |
| `get_weekly_review_context` | A Monday-to-Sunday week of habit, task, goal and insight data, without journal text     |
| `get_mentor_context`        | Selected bounded categories; journal dates/statuses only, never entry text              |

The server also advertises `daily_mentor`, `weekly_mentor` and `journal_reflection` prompts. Client support for prompts and server instructions varies. Their guidance asks the client's model to separate observed facts, interpretations and unknowns, then offer at most three practical next actions without invented causes or guilt-driven language. For example: “Use `get_weekly_review_context` to identify two strengths and one next step,” or “Use `get_habit_history` for the past 14 days and distinguish measured consistency from guesses.”

Journal text is returned only by `get_journal_entry`; ask the client to use that tool only when you want private entry text considered. The server does not forward tool results to a model provider; a connected client may do so under its own privacy terms.

## Troubleshooting and limits

- Check [service readiness](https://habit-tracker-xard.onrender.com/health/ready) first. Render Free sleeps after inactivity and may delay the first request; this plan does not provide always-on availability.
- If authorization or redirect fails, confirm the client supports remote Streamable HTTP, OAuth PKCE, dynamic registration and a supported callback. Reconnect after correcting the client configuration.
- A `401` means authorization is missing, expired, or disconnected. Reconnect and approve access again. A `429` means wait before retrying.
- If a tool has no records, check the account and requested dates. For a size-limit error, shorten the range or use pagination. A `5xx` or failed readiness check indicates a hosted service or database problem.

Each backend call has an eight-second timeout and a 256 KiB response cap; combined tool output is capped at 256 KiB. Date-range tools also validate their inputs. Authentication failures, missing records, rate limits and backend outages return errors rather than fabricated results.

## Verification and compatibility

The official TypeScript MCP SDK v2 client completed automatic discovery, dynamic registration, PKCE authorization, token exchange, tool discovery and a read-only tool call against the hosted URL. A disposable account used for that check was deleted afterward. Named AI products such as Claude and ChatGPT have not been verified with this endpoint; their remote MCP and OAuth support may differ.

The server currently uses `@modelcontextprotocol/sdk` 1.32.1 and interoperated with the tested SDK v2 client. Other protocol revisions are not claimed. See the [requirement check](mcp-requirements.md) and [phase audit](mcp-phase-audit.md) for the exact evidence and open checks. The authorization design follows the [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).
