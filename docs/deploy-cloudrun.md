# Cloud Run deployment

This deployment builds the existing Dockerfile in Google Cloud Build using the `hosted` target, then runs one Fastify service on Cloud Run. The service includes the React frontend, REST API, OAuth endpoints and remote MCP endpoint. Caddy is not used: Cloud Run provides the public HTTPS endpoint and routing.

Neon PostgreSQL remains the database. Do not migrate or reset the Neon database as part of this deployment.

## Prerequisites

- A Google Cloud project with billing enabled.
- Cloud Run, Cloud Build, Artifact Registry and Secret Manager APIs enabled.
- `gcloud` authenticated with permission to deploy Cloud Run services, submit builds, write Artifact Registry images, and read Secret Manager versions.
- The existing Neon connection string and a new application access-token secret.
- An OpenAI API key only if AI-prioritized suggestions are enabled.

The Google Cloud free trial is subject to account eligibility, credits and billing verification. Confirm the trial and create a budget before deploying. Cloud Run, Cloud Build, Artifact Registry, Secret Manager, network egress and Neon usage can still incur charges.

## Choose the region

Start with `asia-south1` (Mumbai) because it is closer to the operator than Stockholm, then compare measured database latency with `asia-southeast1` (Singapore), where the Neon project currently resides. The best region is the one with the lower measured application-to-Neon latency and acceptable Cloud Run availability and pricing.

```sh
export PROJECT_ID='your-gcp-project-id'
export REGION='asia-south1'
export SERVICE='habit-tracker'
export REPOSITORY='habit-tracker'
gcloud config set project "$PROJECT_ID"
```

## Enable services and create the image repository

```sh
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com

gcloud artifacts repositories create "$REPOSITORY" \
  --repository-format=docker \
  --location="$REGION" \
  --description='Habit Tracker container images'
```

If the repository already exists, keep it and continue.

## Store runtime secrets

Create or update secrets without putting values in Git, shell history, Docker layers or Cloud Run YAML:

```sh
printf '%s' "$DATABASE_URL_VALUE" | gcloud secrets versions add habit-tracker-database-url --data-file=-
printf '%s' "$ACCESS_TOKEN_SECRET_VALUE" | gcloud secrets versions add habit-tracker-access-token-secret --data-file=-
printf '%s' "$OPENAI_API_KEY_VALUE" | gcloud secrets versions add habit-tracker-openai-key --data-file=-
```

For a first creation, use `gcloud secrets create NAME --replication-policy=automatic` before adding the version. Omit the OpenAI secret if data-grounded non-AI suggestions are sufficient.

Grant the Cloud Run service identity access to only these secrets:

```sh
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding habit-tracker-database-url \
  --member="serviceAccount:${SERVICE_ACCOUNT}" --role=roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding habit-tracker-access-token-secret \
  --member="serviceAccount:${SERVICE_ACCOUNT}" --role=roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding habit-tracker-openai-key \
  --member="serviceAccount:${SERVICE_ACCOUNT}" --role=roles/secretmanager.secretAccessor
```

Use a dedicated service account instead of the default compute identity for a stricter production deployment.

## Build in Google Cloud

The build explicitly selects the existing `hosted` Docker target. It does not require Docker on the developer machine or on EC2:

```sh
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/habit-tracker:$(git rev-parse HEAD)"
gcloud builds submit . \
  --config=deploy/cloudrun/cloudbuild.yaml \
  --substitutions="_IMAGE=$IMAGE,_CACHE_IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/habit-tracker:latest"
```

## Deploy one Cloud Run service

Set `WEB_ORIGIN` to the final Cloud Run URL after the first deployment. For the initial revision, use the service URL returned by Cloud Run, then deploy again with the exact URL.

```sh
gcloud run deploy "$SERVICE" \
  --image="$IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --execution-environment=gen2 \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=1 \
  --concurrency=20 \
  --timeout=120 \
  --set-env-vars='NODE_ENV=production,HOST=0.0.0.0,HOSTED=true,DB_SSL=true,LOG_LEVEL=info' \
  --update-secrets='DATABASE_URL=habit-tracker-database-url:latest,ACCESS_TOKEN_SECRET=habit-tracker-access-token-secret:latest' \
  --allow-unauthenticated
```

If AI Suggestions are enabled, add the OpenAI secret to the service after creating it:

```sh
gcloud run services update "$SERVICE" --region="$REGION" \
  --update-secrets='OPENAI_API_KEY=habit-tracker-openai-key:latest'
```

Cloud Run supplies `PORT`; the existing API reads it in `apps/api/src/config.ts` and listens on `HOST:PORT` in `apps/api/src/main.ts`. `/mcp`, `/oauth/*`, `/.well-known/*`, `/api/*`, `/health/*`, and frontend assets therefore remain on the same service and origin.

Configure an explicit startup probe so Cloud Run checks promptly while the hosted process applies database migrations before it opens the HTTP listener. The `/health/live` endpoint is only registered after migrations and Fastify setup complete, so passing the probe means the app has finished startup. A 60-attempt, 2-second HTTP probe allows up to two minutes for startup while avoiding the default 240-second TCP probe interval:

```sh
gcloud run services update "$SERVICE" --region="$REGION" \
  --startup-probe='httpGet.path=/health/live,httpGet.port=8080,timeoutSeconds=1,periodSeconds=2,failureThreshold=60'
```

The Cloud Build trigger must use the same cache strategy as `deploy/cloudrun/cloudbuild.yaml`: pull the previous Artifact Registry image (allowing the first pull to fail), build with `--cache-from`, and publish the newly built image as both the commit SHA and `latest`. Cloud Build's Docker build step currently runs with `--no-cache`; removing it is expected to reduce repeat build time, although it does not shorten the Cloud Run revision startup itself.

After obtaining the service URL, set the exact HTTPS origin and redeploy:

```sh
SERVICE_URL="$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')"
gcloud run services update "$SERVICE" --region="$REGION" \
  --update-env-vars="WEB_ORIGIN=$SERVICE_URL"
```

## Verification before cutover

```sh
curl --fail "$SERVICE_URL/health/live"
curl --fail "$SERVICE_URL/health/ready"
curl --fail "$SERVICE_URL/.well-known/oauth-authorization-server"
curl --fail "$SERVICE_URL/.well-known/oauth-protected-resource/mcp"
```

Then verify account creation/sign-in, a habit check-in, daily journal save, Reports, AI Suggestions when the OpenAI secret is present, and the full remote MCP OAuth flow. Confirm the new service reads the existing Neon data before changing any connected clients.

Inspect logs and revisions:

```sh
gcloud run services describe "$SERVICE" --region="$REGION"
gcloud run revisions list --service="$SERVICE" --region="$REGION"
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE" --limit=100
```

Keep Render and the stopped AWS instance until these checks pass. Delete old compute only after the Cloud Run URL, OAuth callbacks and data access are verified. Create a Cloud Billing budget with alert thresholds before enabling broader traffic.
