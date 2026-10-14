# Habit Mentor MCP (local and remote)

The Habit Mentor MCP server lets a compatible local AI client read one Habit Tracker account and reason with that client's existing model. It makes **no model API calls** and requires no model-provider key. The web app's separate AI Guidance feature may still use `OPENAI_API_KEY`; MCP does not.

## Architecture and trust boundary

`Local client → stdio MCP process → Habit Tracker REST API → PostgreSQL`

`Remote client → HTTPS /mcp → account-bound MCP server → Habit Tracker REST API → PostgreSQL`

The connector holds a 90-day read-only account token created in Settings. The backend stores only its SHA-256 hash, checks expiry and revocation on **every API request**, joins the token to its owner, and accepts it only for an explicit allowlist of GET routes. It cannot use account export, account settings, token management, mentor inference, or any write route. No tool accepts a user ID. The backend remains authoritative for schedules, streaks, goal progress, task status, and journal ownership. The connector has no database credentials.

The local stdio process exposes no TCP port. The remote Streamable HTTP endpoint uses OAuth authorization code with PKCE S256, resource binding, short-lived access tokens, rotating refresh tokens, and account-side revocation. Its read-only tool catalog and backend route allowlist are the same as local MCP. Never put a local `htr_` token into a remote client or public proxy.

## Remote HTTPS setup

In a remote MCP client that supports OAuth, add `https://habit-tracker-xard.onrender.com/mcp` as a custom connector URL. The client discovers OAuth via the protected-resource and authorization-server metadata, registers as a public client, and opens the Habit Tracker consent page. Sign in there and approve **read-only** access. Settings lists remote connections and lets you disconnect each one. The app does not display or store raw OAuth tokens in the browser.

Local development uses `http://127.0.0.1:8080/mcp`; public deployments require HTTPS. Access tokens expire after one hour, refresh tokens rotate on use, and a grant expires after 30 days of inactivity. A disconnected grant immediately loses tool access. The consent page asks for the account password because this OAuth flow does not reuse the SPA's JavaScript access token. A connected client may send account data to its own model provider; review the client before approving.

The remote implementation has been tested with the official TypeScript SDK client over Streamable HTTP. Compatibility with Claude.ai, ChatGPT, and other hosted clients needs an actual connection test; it is not inferred from SDK success. The server uses SDK 1.32.1 and its supported protocol version, so clients requiring only a newer protocol revision may need an SDK upgrade.

## Setup

1. Start the local stack with `./scripts/docker-up.sh`. Build the optional connector with `docker compose --env-file .env.docker --profile ai build mcp`.
2. In the app, open **Settings → Read-only assistant access**. Create a labeled token with your account password. Copy it once. At most five active tokens are allowed. Each expires after 90 days and may be revoked in Settings.
3. Configure a local client that supports MCP stdio. Replace the path and token in this example:

```json
{
  "mcpServers": {
    "habit-tracker": {
      "command": "/ABSOLUTE/PATH/TO/Habit Tracker/scripts/mcp-run.sh",
      "env": {
        "MCP_READ_TOKEN": "PASTE_READ_ONLY_TOKEN_FROM_SETTINGS"
      }
    }
  }
}
```

The launcher uses Docker and sets `HABIT_API_URL=http://api:3001` inside the private Compose network. The main stack must remain running. Do not commit tokens or put them into shell history. Stdio stdout contains only MCP messages; diagnostics use stderr. Revoke the token in Settings if a client is no longer trusted.

For a non-Docker local API, set `HABIT_API_URL=http://127.0.0.1:3001` and `MCP_READ_TOKEN`, then run `npm run build -w @habit/mcp && npm start -w @habit/mcp`. HTTP is accepted only for the Compose hostname and loopback; use HTTPS for any other backend host.

## Tool catalog

All tools are read-only. Inputs use ISO local dates (`YYYY-MM-DD`), positive numeric habit IDs, and ranges of at most 31 dates.

| Tool                        | Data and limits                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `get_today_context`         | Account timezone, local date, due habits, activity blocks, tasks, up to 10 active goals |
| `get_habit_summary`         | One 20-habit page, existing four-week insights                                          |
| `get_habit_history`         | Backend habit grid/history for up to 31 dates                                           |
| `get_habit_details`         | One owned habit and its logs for up to 31 dates                                         |
| `get_task_summary`          | Tasks for up to 31 dates                                                                |
| `get_goal_progress`         | Up to 30 active goals with backend-computed progress; includes total count              |
| `get_journal_blueprints`    | Template names and prompts, no private entries                                          |
| `get_journal_entry`         | One private entry; use only when relevant to the user's request                         |
| `get_weekly_review_context` | A Monday-to-Sunday week of habit, task, goal, and insight data, without journal text    |
| `get_mentor_context`        | Selected bounded categories; journal **dates/statuses** only, never entry text          |

The server also advertises `daily_mentor`, `weekly_mentor`, and `journal_reflection` prompts. Client support for prompts and server instructions varies. Their guidance asks the client's model to distinguish observed facts, established metrics, interpretations, and unknowns, and to offer at most three practical next actions without diagnosing or judging the user.

No completion or journal-save tool is exposed. This preserves the account's earlier read-only assistant-access choice. The backend's normal UI actions still work independently of MCP.

## Errors, limits, and privacy

Authentication failures, missing records, rate limiting and backend outages return MCP tool errors without a fabricated success. A startup authentication check fails closed. Each backend call has an eight-second timeout and a 256 KiB response cap; combined tool output has a 256 KiB cap. The API's per-IP rate limit also applies. Date-range tools use server-side validation. If a request is too large, narrow its date range or use pagination.

The connector does not persist journal content or send it to a model provider. A connected client may transmit tool results to **its own model service** according to that client's privacy terms; only connect a client you trust with account data. Journal text is untrusted user content, never an authorization instruction.

Troubleshooting: if startup says authorization failed, check that the main Docker stack is healthy and the token is active. A 401 after connection means the token expired or was revoked; create a new one. A 429 means wait before retrying. A size-limit error means request a shorter range or fewer categories. `docker compose --env-file .env.docker ps` checks local service health without printing secrets.

## Verification and compatibility

See the [requirement check](mcp-requirements.md) for implemented, tested, and intentionally unsupported items.

`npm run check` validates formatting, lint, types and build. `npm run test:mcp` exercises the stdio transport. `npm run test:mcp-remote` exercises discovery, dynamic registration, PKCE, consent, token exchange, SDK Streamable HTTP tool calls, refresh rotation, blocked writes, and disconnection. Both create disposable local accounts and delete them afterward. They refuse a non-loopback `TEST_BASE_URL`.

| Client                             | Transport                 | Status                                                             | Authentication                         |
| ---------------------------------- | ------------------------- | ------------------------------------------------------------------ | -------------------------------------- |
| Official TypeScript MCP SDK client | stdio via Docker launcher | Verified by `test:mcp` when it passes locally                      | Read-only token in process environment |
| Official TypeScript MCP SDK client | Streamable HTTP           | Verified by `test:mcp-remote` locally                              | OAuth authorization code with PKCE     |
| Claude Desktop                     | stdio                     | Configuration documented; manual UI compatibility not yet verified | Read-only token in process environment |
| Hosted AI clients                  | Streamable HTTP           | Manual UI compatibility not yet verified                           | OAuth, where supported                 |

The connector pins `@modelcontextprotocol/sdk` 1.32.1. Its remote authorization design follows the [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization). Protocol-version compatibility beyond the tested SDK client is not claimed.
