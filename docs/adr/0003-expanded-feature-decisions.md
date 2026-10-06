# ADR-0003: Expanded feature decisions

Date: 2026-10-06. Status: accepted. Decider: product owner for the three explicit choices; engineering judgment for unspecified details.

The owner requested the additional feature groups described on Thedashbit's public pages. This decision supersedes ADR-0001 where scope changed.

- A streak freeze is manual, limited to one per habit per Monday–Sunday calendar week, and can be applied only after a two-day streak. It preserves continuity without adding a completed check-in. Tokens do not accumulate. Weekly usage is stored separately from the legacy monthly-freeze table.
- The assistant connector initially exposes read-only account data. The implementation is a local stdio MCP server with a revocable, hashed account token and a read-only database role setting. It supports Claude Desktop's local connector pattern; a public remote HTTPS MCP endpoint is outside the current deployment. No paid-plan gate is applied to MCP or the journal.
- The 10 goal areas are Health, Career, Finances, Relationships, Creativity, Learning, Mindfulness, Home, Community, and Leisure. The first five are examples on the source site; the remaining names are our product choices, not claimed as source-site categories.
- The insights leaderboard ranks only the user's own habits by scheduled completion rate. Weekly comparison uses the same elapsed weekdays for the current and preceding week. These definitions are local product choices because the source does not specify them.
- Tasks copied from yesterday are new one-time tasks due on the selected next day. A copy receipt makes repeat requests idempotent. Daily energy, focus, and motivation use 1–5 scales. Monthly journal entries are plain text with version-checked saves/deletes to reject stale edits.
- Navigation shows the expanded sections directly. Account data stays in PostgreSQL; the owner removed browser-storage copies. The app refreshes account-backed views when the window regains focus.

These features have local API and database tests. Browser interaction, mobile accessibility, public deployment, remote MCP compatibility, billing, and cloud operations remain separate verification work.
