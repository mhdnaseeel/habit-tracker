# ADR 0007 — Remote MCP OAuth

Status: Accepted, 2026-10-14.

The user chose remote MCP with OAuth while retaining read-only assistant access. The existing local stdio connector and backend GET allowlist remain in place. The API now serves a stateless Streamable HTTP MCP endpoint and OAuth authorization server on the app origin. The remote resource uses authorization-code grant with PKCE S256, exact registered redirect URI matching, explicit resource binding, a sign-in and consent page, hashed tokens, one-hour access tokens, rotating refresh tokens, and account-side revocation. Every MCP request checks the grant; tools call the owner-scoped API instead of accessing SQL directly.

The 30-day grant expiry is renewed on refresh, so idle connections expire. Reuse of an old refresh token revokes its grant. Only HTTPS redirect URIs and loopback HTTP callbacks can register. OAuth endpoints have rate limits; the MCP endpoint validates Origin and Host. The local stdio token is not accepted at the remote endpoint.

The official TypeScript SDK Streamable HTTP client is exercised in local integration tests. Hosted-client UI compatibility, newer protocol revisions, and production throughput have not been independently verified. Remote deployment must keep TLS and `WEB_ORIGIN` aligned. This decision supersedes ADR 0006's prior exclusion of remote transport; its read-only trust boundary still applies.
