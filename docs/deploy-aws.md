# AWS Deployment Guide

Two paths — choose based on your timeline.

| Path | Time | Best for |
|---|---|---|
| **A — EC2 + PM2** | ~20 min | Getting the MVP running today |
| **B — ECS Fargate** | ~2–3 hrs | Production, auto-scaling, zero SSH |

Keycloak is already running on EC2 — no changes needed there.

---

## Path A — EC2 + PM2 (recommended to start fast)

### AWS infrastructure to create

**1. RDS — PostgreSQL 15**

- Engine: PostgreSQL 15
- Instance: `db.t3.micro` (upgrade later)
- Create **two databases** on the same instance:
  ```sql
  CREATE DATABASE medipulse;
  CREATE DATABASE medipulse_audit;
  ```
- Security group: allow port 5432 from your app EC2 security group only

**2. ElastiCache — Redis 7**

- Engine: Redis 7, cluster mode OFF
- Node: `cache.t3.micro`
- Enable in-transit encryption + set an auth token (password)
- Security group: allow port 6379 from app EC2 security group only

**3. EC2 — App server**

- AMI: Amazon Linux 2023
- Instance: `t3.medium` (2 vCPU / 4GB RAM)
- Security group:
  - Inbound: 22 (SSH, your IP only), 3000 (API, 0.0.0.0/0 or ALB only)
  - Outbound: all
- Attach an IAM role with `AmazonSSMManagedInstanceCore` (optional, for Session Manager)

---

### EC2 setup (SSH in once)

```bash
# 1. Install Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs git

# 2. Install PM2
sudo npm install -g pm2

# 3. Create app directory
sudo mkdir -p /opt/medipulse
sudo chown ec2-user:ec2-user /opt/medipulse
cd /opt/medipulse

# 4. Clone repo (or copy files via scp/S3)
git clone <your-repo-url> .

# 5. Install dependencies and build
npm ci
npm run build

# 6. Create logs directory
mkdir logs

# 7. Set environment variables
cp .env.example .env
nano .env   # fill in all values (see below)
```

**Fill in `.env`:**
```bash
NODE_ENV=production
PORT=3000
WORKER_PORT=3001

# RDS endpoint from AWS console
DATABASE_URL=postgresql://postgres:<password>@<rds-endpoint>:5432/medipulse
AUDIT_DATABASE_URL=postgresql://postgres:<password>@<rds-endpoint>:5432/medipulse_audit

# KC is already running — use its existing URL
KC_URL=https://<your-kc-domain>
KC_REALM=medipulse
KC_CLIENT_ID=medipulse-api
KC_CLIENT_SECRET=<from-kc-admin-console>

# ElastiCache endpoint
REDIS_HOST=<elasticache-endpoint>
REDIS_PORT=6379
REDIS_PASSWORD=<auth-token-you-set>

OPENAI_API_KEY=sk-...
BULL_BOARD_API_KEY=<generate: openssl rand -hex 32>
FRONTEND_URL=https://<your-frontend-domain>
```

**Start with PM2:**
```bash
# Start both API + Worker
NODE_ENV=production pm2 start ecosystem.config.js --env production

# Verify both are running
pm2 status

# Persist across reboots
pm2 save
pm2 startup   # follow the printed command (sudo ...)
```

**Verify it's working:**
```bash
# Liveness
curl http://localhost:3000/api/v1/health

# Readiness (checks DB)
curl http://localhost:3000/api/v1/health/ready

# Worker liveness
curl http://localhost:3001/api/v1/health
```

**PM2 useful commands:**
```bash
pm2 status                    # running processes
pm2 logs medipulse-api        # tail API logs
pm2 logs medipulse-worker     # tail worker logs
pm2 restart medipulse-api     # rolling restart (zero downtime in cluster mode)
pm2 reload ecosystem.config.js --env production   # reload after code update
```

---

### Deploying updates

```bash
cd /opt/medipulse
git pull
npm ci
npm run build
pm2 reload ecosystem.config.js --env production
```

---

### Optional: Put ALB in front (HTTPS)

1. Create Application Load Balancer (internet-facing, HTTPS:443)
2. Target group: instances, port 3000, health check `GET /api/v1/health`
3. Add your SSL certificate (ACM — free)
4. Update security group: allow 3000 from ALB security group only (not 0.0.0.0)
5. Update `FRONTEND_URL` in `.env` to your domain, restart

---

## Path B — ECS Fargate (when ready to productionize)

### Prerequisites
- AWS CLI configured locally
- Docker installed locally **or** use GitHub Actions / AWS CodeBuild (no local Docker needed — see below)
- ECR repository created

### 1. Create ECR repositories

```bash
aws ecr create-repository --repository-name medipulse-api    --region <region>
aws ecr create-repository --repository-name medipulse-worker --region <region>
```

### 2. Build and push (without local Docker — GitHub Actions)

Create `.github/workflows/deploy.yml`:

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]

env:
  AWS_REGION: eu-west-1
  ECR_REGISTRY: <account-id>.dkr.ecr.eu-west-1.amazonaws.com

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to ECR
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push API image
        run: |
          docker build --target api -t $ECR_REGISTRY/medipulse-api:${{ github.sha }} .
          docker push $ECR_REGISTRY/medipulse-api:${{ github.sha }}

      - name: Build and push Worker image
        run: |
          docker build --target worker -t $ECR_REGISTRY/medipulse-worker:${{ github.sha }} .
          docker push $ECR_REGISTRY/medipulse-worker:${{ github.sha }}

      - name: Deploy to ECS (API)
        run: |
          aws ecs update-service \
            --cluster medipulse \
            --service medipulse-api \
            --force-new-deployment

      - name: Deploy to ECS (Worker)
        run: |
          aws ecs update-service \
            --cluster medipulse \
            --service medipulse-worker \
            --force-new-deployment
```

### 3. ECS setup outline

**Cluster:** `medipulse` (Fargate)

**Task definitions — create two:**

| | medipulse-api | medipulse-worker |
|---|---|---|
| CPU | 512 | 256 |
| Memory | 1024 MB | 512 MB |
| Image | ECR: medipulse-api | ECR: medipulse-worker |
| Port | 3000 | 3001 (internal) |
| Health check | `GET /api/v1/health` | `GET /api/v1/health` |

Both tasks use the same environment variables (store in AWS Secrets Manager or SSM Parameter Store — **never hardcode in task definition**).

**Services:**
- `medipulse-api` — behind ALB, desired count 2, auto-scaling on CPU > 60%
- `medipulse-worker` — no ALB, desired count 1–3, scale independently

---

## Architecture on AWS

```
Internet
    │
    ▼
Application Load Balancer (HTTPS:443, ACM cert)
    │
    ▼
EC2 / ECS — medipulse-api  :3000
    │  (enqueues jobs, serves REST)
    │
    ├──────────────────────────────────────────┐
    │                                          │
    ▼                                          ▼
ElastiCache Redis                     EC2 / ECS — medipulse-worker  :3001
(ai-recommendations queue)                  (processes queues only)
(audit-events queue)                               │
    ▲                                              │
    └──────────────────────────────────────────────┘
                                                   │
                    ┌──────────────────────────────┤
                    │                              │
                    ▼                              ▼
             RDS PostgreSQL                 RDS PostgreSQL
             medipulse DB                  medipulse_audit DB
             (main app data)               (append-only audit events)

    + Keycloak on existing EC2 — no changes needed
```

---

## Quick reference — what each service needs network access to

| Service | Needs to reach |
|---|---|
| medipulse-api | RDS:5432, ElastiCache:6379, Keycloak (HTTPS) |
| medipulse-worker | RDS:5432, ElastiCache:6379, OpenAI (HTTPS), Keycloak Admin API (HTTPS) |
| Keycloak (existing) | No changes |

---

## DB-Level Audit — pgaudit (RDS PostgreSQL)

pgaudit provides statement-level audit logging for direct DB access (bypassing the API).
This covers: direct RDS connections, DBA operations, schema changes.

### Enable on RDS

```bash
# In RDS parameter group — create a new one if using the default (can't modify default)
aws rds modify-db-parameter-group \
  --db-parameter-group-name medipulse-pg15 \
  --parameters "ParameterName=shared_preload_libraries,ParameterValue=pgaudit,ApplyMethod=pending-reboot" \
               "ParameterName=pgaudit.log,ParameterValue=ddl\,write\,role,ApplyMethod=immediate" \
               "ParameterName=pgaudit.log_catalog,ParameterValue=0,ApplyMethod=immediate"

# Apply parameter group to both RDS instances (medipulse + medipulse_audit)
aws rds modify-db-instance \
  --db-instance-identifier medipulse-main \
  --db-parameter-group-name medipulse-pg15 \
  --apply-immediately

aws rds modify-db-instance \
  --db-instance-identifier medipulse-audit \
  --db-parameter-group-name medipulse-pg15 \
  --apply-immediately
```

### Audit levels configured

| Level | What it logs |
|---|---|
| `ddl` | CREATE, ALTER, DROP statements — schema changes |
| `write` | INSERT, UPDATE, DELETE, TRUNCATE — all data mutations |
| `role` | GRANT, REVOKE — permission changes |

`read` (SELECT) is intentionally excluded — too high volume. Application-level read audit is handled by `AuditReadInterceptor` + `ReadAccessLog`.

### View pgaudit logs

pgaudit writes to PostgreSQL logs, which RDS publishes to CloudWatch Logs:

```bash
# Enable CloudWatch log export for RDS
aws rds modify-db-instance \
  --db-instance-identifier medipulse-main \
  --enable-cloudwatch-logs-exports '["postgresql"]' \
  --apply-immediately

# Query recent DDL events
aws logs filter-log-events \
  --log-group-name /aws/rds/instance/medipulse-main/postgresql \
  --filter-pattern "AUDIT: SESSION"
```

---

## Keycloak Auth Event Collection — One-Time Setup

MediPulse polls KC Admin API for auth events. Requires one-time KC configuration:

### 1. Enable KC event logging

KC Admin Console → realm `medipulse` → **Realm Settings** → **Events** tab:
- **Save Events**: ON
- **Saved Types**: LOGIN, LOGOUT, LOGIN_ERROR, REGISTER, UPDATE_PASSWORD, RESET_PASSWORD, SEND_VERIFY_EMAIL, TOKEN_EXCHANGE
- **Expiration**: 30 days

### 2. Add view-events role to service account

KC Admin Console → **Clients** → `medipulse-api` → **Service Account Roles** → **realm-management** → add `view-events`

### 3. Verify collection is working

```bash
curl -X POST https://your-api-domain/api/v1/admin/kc-events/poll \
  -H "Authorization: Bearer <system-admin-token>"
# Returns: { "imported": <number of events collected> }
```

