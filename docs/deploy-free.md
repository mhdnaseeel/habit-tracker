# Free hosted preview: Render + Neon

This setup uses one Render Free Docker web service for the website and API, plus one Neon Free PostgreSQL project for account data. It is suitable for a personal preview, not a production availability guarantee. Render's Free web service sleeps after 15 minutes without traffic and can take about a minute to wake up. Neon Free has usage and storage limits; check the current plan before creating it. AI Suggestions prioritization requires separate OpenAI API credits; data-based suggestions work without them.

Provider references: [Render Free limits](https://render.com/docs/free), [Render Docker deployment](https://render.com/docs/docker), [Render Blueprint specification](https://render.com/docs/blueprint-spec), [Neon Free plan](https://neon.com/blog/neon-free-plan-1-gb-per-project).

## Create the database

1. Sign in to [Neon](https://console.neon.tech/) and create a Free project near the Render region you intend to use.
2. Copy the project's **direct** PostgreSQL connection string from Neon. Keep it private. The app uses a small connection pool and verifies the database TLS certificate when `DB_SSL=true`.
3. Decide whether the hosted app should start empty or receive a copy of the local PostgreSQL data. Local and hosted databases do not sync automatically. If copying data, do it before the first Render deployment so the hosted account starts with the same records.

## Create the web service

1. Sign in to [Render](https://dashboard.render.com/) and connect the public [habit-tracker repository](https://github.com/mhdnaseeel/habit-tracker).
2. Choose **New → Blueprint**, select this repository's `render.yaml`, and review the resources. It declares one `plan: free` Docker web service and no Render database. Confirm that the plan shown is **Free** before creating it.
3. Enter the Neon direct connection string for `DATABASE_URL` when Render requests it. Render generates `ACCESS_TOKEN_SECRET`. Leave `OPENAI_API_KEY` unset unless you add a newly rotated key privately in Render's Environment page.
4. Deploy. Render supplies its HTTPS `RENDER_EXTERNAL_URL`; the app uses that URL as its trusted browser origin. The container applies forward-only migrations before accepting traffic.
5. Open the assigned `https://…onrender.com` URL. Check `/health/ready`, create an account, sign out and in again, and save a daily journal entry. The web service serves both the React page and `/api/v1` from the same origin.

The default Render URL is supported automatically. If you attach a custom domain, set `WEB_ORIGIN` in Render to its exact HTTPS origin, without a trailing slash. Mismatched origins prevent login and refresh requests.

The local Compose stack still uses its own PostgreSQL volume and `http://127.0.0.1:8080`. The local stdio MCP connector remains local; this deployment does not expose an MCP endpoint. Do not copy `.env.docker` or `.env.demo` to either provider. Keep database credentials and API keys only in provider environment settings.
