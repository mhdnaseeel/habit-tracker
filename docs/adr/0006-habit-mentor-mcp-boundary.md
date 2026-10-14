# ADR 0006 — Habit Mentor MCP boundary

Status: Accepted (2026-10-14)

The backend and UI PRDs describe account-owned habits, tasks, goals, Today planning, analytics and journal data. They place recurrence, streak and progress rules in the backend. The existing connector duplicated queries and some calculations directly against PostgreSQL. The app already issues expiring, revocable read-only assistant tokens.

We use the existing TypeScript MCP service and the official SDK's stable v1 stdio transport. The MCP process calls allowlisted REST GET routes using an assistant token. The API resolves token ownership on every request and applies its normal owner-scoped handlers. The connector has no database credential, no separate model key and no write capability. The existing AI Guidance feature is independent and may use its provider key.

We intentionally do not add Streamable HTTP at this stage. The account's current permission is read-only, and a public multi-client MCP endpoint would require OAuth, protected-resource metadata, origin validation, transport isolation and actual remote-client tests. A public endpoint with a copied local bearer token would not meet that standard. We also do not add write tools; the established read-only grant does not authorize them. Both can be designed as separate opt-in changes.

The MCP tool catalog uses existing API responses for Today, schedules, streaks, goal steps, tasks, insights and journal. It limits ranges, pages and output size, and retrieves journal content only through a dedicated single-date tool. MCP prompts guide the connected model but cannot force host-client behavior. We do not claim that a prompt, resource or remote client is verified without a protocol test.

The local stdio SDK client integration test covers initialization, discovery, tools, prompts, ownership, revocation and negative permissions. The backend continues to serve the app when the optional MCP process is stopped.
