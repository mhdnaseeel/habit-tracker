# AWS EC2 deployment

This deployment runs the existing Docker application on one Ubuntu EC2 instance and continues using Neon PostgreSQL. Caddy terminates HTTPS and proxies the website, API, OAuth, and MCP endpoint to the application container.

## Verified account status

On October 15, 2026, the inspected AWS account showed **0 active credits** and **$0 remaining credit**. Do not assume resources created in that account are free. AWS charges vary by region and include EC2 compute, EBS storage, public IPv4, and outbound data.

## Components

- **EC2:** runs Docker and the application.
- **EBS gp3:** stores the operating system, Docker layers, and Caddy certificates.
- **Security group:** permits inbound TCP 80 and TCP/UDP 443. Do not expose PostgreSQL or port 3001.
- **Neon:** remains the PostgreSQL system of record.
- **Caddy:** obtains and renews TLS certificates for the chosen domain.
- **AWS Budget:** alerts before unexpected charges grow.

## Console setup

1. In Billing, verify credits and create a monthly cost budget before provisioning anything.
2. In EC2, launch an **Ubuntu Server 24.04 LTS** instance in the intended region. Select only an instance type explicitly marked eligible for the account's Free Tier, when applicable. A small burstable instance is sufficient for initial testing; monitor memory during Docker builds.
3. Use an 8–16 GiB encrypted gp3 root volume. Disable termination protection only if the instance is disposable.
4. Create a security group with inbound TCP 80, TCP 443, and UDP 443 from anywhere. Add SSH only from the administrator's current IP, or use EC2 Instance Connect Session Manager instead.
5. Paste `deploy/aws/cloud-init.sh` into **Advanced details → User data**. Launching the instance starts billable resources.
6. Assign a stable public address or DNS name. Point a domain's A record to that address. Public IPv4 addresses can incur an hourly charge.
7. Connect to the instance and create `/opt/habit-tracker/.env.aws`:

   ```dotenv
   APP_DOMAIN=habits.example.com
   NODE_ENV=production
   HOST=0.0.0.0
   PORT=3001
   HOSTED=true
   DB_SSL=true
   LOG_LEVEL=info
   WEB_ORIGIN=https://habits.example.com
   DATABASE_URL=postgresql://REDACTED
   ACCESS_TOKEN_SECRET=REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS
   OPENAI_API_KEY=
   ```

   Keep the Neon URL, token secret, and optional OpenAI key private. Then run:

   ```sh
   sudo chmod 600 /opt/habit-tracker/.env.aws
   sudo systemctl start habit-tracker
   sudo systemctl status habit-tracker
   ```

8. Verify `https://<domain>/health/live`, `https://<domain>/health/ready`, account creation and sign-in, a habit check-in, a journal entry, AI Suggestions, and OAuth MCP at `https://<domain>/mcp`.
9. Update public documentation and connected MCP clients only after verification. Keep Render until the AWS cutover passes, then remove the old service to avoid duplicate hosting.

## Operations

Deploy an update:

```sh
cd /opt/habit-tracker
sudo git pull --ff-only
sudo systemctl restart habit-tracker
```

Inspect status and logs:

```sh
sudo docker compose --env-file .env.aws -f deploy/aws/compose.yaml ps
sudo docker compose --env-file .env.aws -f deploy/aws/compose.yaml logs --tail=200
```

Stop charges by deleting the EC2 instance, attached EBS volumes, snapshots, Elastic IPs, and other resources that are no longer needed. Stopping an instance does not remove every related charge.
