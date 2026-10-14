# Cloudflare deployment

The Habit Tracker can run unchanged as a Cloudflare Container behind a Worker. This preserves the Fastify API, React frontend, PostgreSQL migrations, OAuth MCP endpoint, and Argon2 authentication in the existing Docker image.

Cloudflare Containers require the Workers Paid plan. Cloudflare currently lists no free Container tier; the minimum Workers Paid charge is USD 5 per month. Do not deploy this configuration while expecting a free trial.

## Prerequisites

- A Cloudflare account with Workers Paid enabled.
- Docker running on the deployment machine.
- The existing Neon PostgreSQL connection string.
- A random `ACCESS_TOKEN_SECRET` of at least 32 characters.
- An OpenAI API key only when model-prioritized AI Suggestions are wanted.

## First deployment

1. Authenticate Wrangler with `npx wrangler login`.
2. Store secrets without committing them:

   ```sh
   npx wrangler secret put DATABASE_URL
   npx wrangler secret put ACCESS_TOKEN_SECRET
   npx wrangler secret put WEB_ORIGIN
   npx wrangler secret put OPENAI_API_KEY
   ```

   Set `WEB_ORIGIN` to the exact final HTTPS origin, without a trailing slash. Omit `OPENAI_API_KEY` if external AI prioritization is disabled.

3. Run `npm run cloudflare:check` to validate the Worker bundle and Docker image.
4. Run `npm run cloudflare:deploy`.
5. Wait several minutes for the first Container provisioning, then verify `/health/live` and `/health/ready` on the assigned `workers.dev` URL.
6. Create a new account and verify sign-in, one habit check-in, one daily journal entry, AI Suggestions, and the OAuth MCP flow.
7. Update the public MCP documentation and any connected clients to the new `/mcp` URL.
8. Remove the Render service only after the Cloudflare checks pass. This keeps a rollback path during cutover.

## Runtime design

`cloudflare/worker.ts` routes all requests to one named Durable Object Container. The Container starts from the repository Dockerfile, receives secrets only at runtime, listens on port 8080, and sleeps after five idle minutes to limit usage. Application data remains in Neon rather than the Container filesystem.

Cloudflare Container usage can exceed the Workers Paid included allowance. Review usage and billing in the Cloudflare dashboard after deployment.
