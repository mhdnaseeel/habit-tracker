# Read-only MCP connector

The local MCP server lets Claude Desktop or another local MCP client read one Habit Tracker account. It exposes seven read-only tools: today's dashboard, routines, a date-limited habit grid, tasks, goals, monthly reflection and mindset entries. It has no mutation tools. Each tool checks the token again, so revocation takes effect on the next call.

1. Start the Docker stack with `./scripts/docker-up.sh` and build the optional connector with `docker compose --env-file .env.docker --profile ai build mcp`.
2. In Habit Tracker, open **Settings → Read-only assistant access**. Enter a label and your account password, create a token, and copy it immediately. The token is shown only once, expires after 90 days and can be revoked in Settings. Do not commit it to Git.
3. Configure a local MCP client to launch `scripts/mcp-run.sh` with the token in its `MCP_READ_TOKEN` environment variable. For Claude Desktop's local MCP configuration, use the equivalent of:

```json
{
  "mcpServers": {
    "habit-tracker": {
      "command": "/ABSOLUTE/PATH/TO/Habit Tracker/scripts/mcp-run.sh",
      "env": {
        "MCP_READ_TOKEN": "PASTE_TOKEN_FROM_SETTINGS"
      }
    }
  }
}
```

The script starts the MCP process inside Docker and connects it to the local PostgreSQL container. Keep the main Docker stack running while using the connector. It does not expose a network port and does not need a Claude API key. The token grants access to account content to whichever local MCP client holds it. Revoke it in Settings when no longer needed.

This is a **local stdio connector**. Anthropic's remote custom connectors connect from its cloud and require a publicly reachable, authenticated HTTPS MCP endpoint; this local Docker connector is not a Claude.ai or Cowork remote connector. See the [MCP TypeScript SDK transport guide](https://ts.sdk.modelcontextprotocol.io/server) and [Anthropic's remote connector guidance](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).
