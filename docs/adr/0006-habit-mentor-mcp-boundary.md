# ADR 0006 — Habit Mentor MCP boundary

Status: Accepted (2026-10-14)

The backend and UI PRDs describe account-owned habits, tasks, goals, Today planning, analytics and journal data. They place recurrence, streak and progress rules in the backend. The existing connector duplicated queries and some calculations directly against PostgreSQL. The app already issues expiring, revocable read-only assistant tokens.

We use the existing TypeScript MCP service and the official SDK's stable v1 stdio transport. The MCP process calls allowlisted REST GET routes using an assistant token. The API resolves token ownership on every request and applies its normal owner-scoped handlers. The connector has no database credential, no separate model key and no write capability. The existing AI Guidance feature is independent and may use its provider key.

At this stage we did not add Streamable HTTP. The later, user-approved remote OAuth implementation is recorded in ADR 0007. We continue to omit write tools under the established read-only permission.

The MCP tool catalog uses existing API responses for Today, schedules, streaks, goal steps, tasks, insights and journal. It limits ranges, pages and output size, and retrieves journal content only through a dedicated single-date tool. MCP prompts guide the connected model but cannot force host-client behavior. We do not claim that a prompt, resource or remote client is verified without a protocol test.

The local stdio SDK client integration test covers initialization, discovery, tools, prompts, ownership, revocation and negative permissions. The backend continues to serve the app when the optional MCP process is stopped.
