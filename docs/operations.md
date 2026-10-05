# Development and operational notes

## Configuration

For the local all-Docker stack, `scripts/docker-up.sh` creates ignored `.env.docker` with random credentials. Its HTTP origin is `http://127.0.0.1:8080` by default. Production must provide DATABASE_URL from a secret store, DB_SSL=true (verified CA TLS), HTTPS WEB_ORIGIN, NODE_ENV=production and HOST=0.0.0.0. Do not disable certificate verification. Database credentials never belong in Git. `.env` is loaded only by entrypoints, not by pure modules or test imports.

## Database and Compose lifecycle

Start the local stack with `./scripts/docker-up.sh`. Compose starts PostgreSQL, waits for its health check, runs checksum-verified migrations, then starts the API and web proxy. `./scripts/docker-test.sh` uses a separate `habit_test` database in the same local server. `docker compose --env-file .env.docker down` preserves the named volume; adding `-v` deletes all local data. Back up existing databases before applying migrations; the runner takes an advisory lock and checksums each file. New changes require new numbered migrations. Recovery uses forward fixes or backup restore, never editing applied migrations. Do not run integration tests against production. PostgreSQL image is pinned by major; deployers should pin audited image digests and patch routinely.

## Current deployment limits

Dockerfile builds frontend assets, a migration image, a pruned API runtime image, and an Nginx web image. The local Compose stack binds only the web port on loopback; API and PostgreSQL stay on the internal Compose network. This local stack serves HTTP. TLS termination and production cloud IaC are still pending for an internet deployment. CI is configured but has not run on a remote repository. Availability/latency SLOs have not been measured. Hosting at-rest encryption, encrypted backups/PITR, multi-AZ, secrets rotation, metrics/tracing, provider adapters, erasure replay, disaster recovery and canary rollout remain required release work.

## Troubleshooting

- Startup configuration error: set DATABASE_URL; production also requires TLS and HTTPS origin.
- Readiness 503: inspect database availability/credentials; do not return a successful fake response.
- Migration checksum mismatch: restore the applied SQL and write a new migration.
- Docker connection denied: start Docker Desktop and authorise access to its socket. Check configuration without a daemon with `docker compose --env-file .env.docker config --quiet`.
- Browser cannot sign in: use `http://127.0.0.1:8080` (or the port set in `.env.docker`), not a different hostname.

## Privacy and security

Do not log body payloads, journal text or credentials. Request logs include route templates rather than arbitrary query strings. Nonessential analytics defaults to no consent. Audit retention is planned at 90 days with configurable policy; core user history stays until erasure. Privacy-policy publication, consent enforcement, account export/erasure and backup expiration verification are pending. No claim of GDPR/PDPA compliance is made by schema existence.
