# ADR-0004: Daily journal replaces monthly reflections

Date: 2026-10-12

The product owner changed the journal cadence from monthly to daily. Each account can save one plain-text entry per calendar date. The API, web interface, account export, demo seed, and read-only MCP tool use the entry date. Version checks continue to reject stale edits and deletes.

Migrations 005 and 006 add the daily table and copy each prior monthly reflection to the first day of its month, retaining its content and version. The legacy table remains in place so the original records are preserved. This decision supersedes the monthly-journal sentence in ADR-0003.
