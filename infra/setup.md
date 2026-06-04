# One-time AWS Setup

Run these once. After this, every `git push main` deploys automatically.

Replace `ACCOUNT_ID`, `AWS_REGION`, and `YOUR_ORG` throughout.

---

## 1. GitHub OIDC Provider (once per AWS account)

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

> Skip if already done for another repo in the same AWS account.

---

## 2. IAM Roles

### GitHub Actions deploy role
```bash
# Edit trust policy first: replace ACCOUNT_ID and YOUR_ORG in infra/iam/github-actions-trust-policy.json

aws iam create-role \
  --role-name MedipulseGithubDeploy \
  --assume-role-policy-document file://infra/iam/github-actions-trust-policy.json

aws iam create-policy \
  --policy-name MedipulseGithubDeployPolicy \
  --policy-document file://infra/iam/github-actions-policy.json

aws iam attach-role-policy \
  --role-name MedipulseGithubDeploy \
  --policy-arn arn:aws:iam::ACCOUNT_ID:policy/MedipulseGithubDeployPolicy
```

### ECS task execution role (ECS agent — pulls images + injects secrets)
```bash
aws iam create-role \
  --role-name MedipulseEcsExecutionRole \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

aws iam create-policy \
  --policy-name MedipulseEcsExecutionPolicy \
  --policy-document file://infra/iam/ecs-execution-role-policy.json

aws iam attach-role-policy \
  --role-name MedipulseEcsExecutionRole \
  --policy-arn arn:aws:iam::ACCOUNT_ID:policy/MedipulseEcsExecutionPolicy
```

### ECS task roles (the running container itself — minimal permissions)
```bash
# API task role — no special AWS permissions needed
aws iam create-role \
  --role-name MedipulseApiTaskRole \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

# Worker task role — no special AWS permissions needed
aws iam create-role \
  --role-name MedipulseWorkerTaskRole \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
```

---

## 3. ECR Repositories

```bash
aws ecr create-repository --repository-name medipulse-api    --region AWS_REGION
aws ecr create-repository --repository-name medipulse-worker --region AWS_REGION
```

---

## 4. CloudWatch Log Groups

```bash
aws logs create-log-group --log-group-name /medipulse/api    --region AWS_REGION
aws logs create-log-group --log-group-name /medipulse/worker --region AWS_REGION

# 30-day retention
aws logs put-retention-policy --log-group-name /medipulse/api    --retention-in-days 30
aws logs put-retention-policy --log-group-name /medipulse/worker --retention-in-days 30
```

---

## 5. Secrets Manager — all app config in one secret

```bash
aws secretsmanager create-secret \
  --name medipulse/production \
  --region AWS_REGION \
  --secret-string '{
    "DATABASE_URL":       "postgresql://user:pass@rds-endpoint:5432/medipulse",
    "AUDIT_DATABASE_URL": "postgresql://user:pass@rds-endpoint:5432/medipulse_audit",
    "KC_URL":             "https://your-kc-domain",
    "KC_REALM":           "medipulse",
    "KC_CLIENT_ID":       "medipulse-api",
    "KC_CLIENT_SECRET":   "from-kc-admin-console",
    "REDIS_HOST":         "your-elasticache-endpoint",
    "REDIS_PORT":         "6379",
    "REDIS_PASSWORD":     "your-redis-auth-token",
    "OPENAI_API_KEY":     "sk-...",
    "FRONTEND_URL":       "https://your-frontend-domain",
    "BULL_BOARD_API_KEY": "run: openssl rand -hex 32"
  }'
```

To update a value later:
```bash
aws secretsmanager update-secret \
  --secret-id medipulse/production \
  --secret-string '{ ...full JSON with updated values... }'
```

---

## 6. ECS Cluster

```bash
aws ecs create-cluster \
  --cluster-name medipulse \
  --capacity-providers FARGATE FARGATE_SPOT \
  --region AWS_REGION
```

---

## 7. Replace placeholders in task definitions and register them

```bash
# Replace ACCOUNT_ID and AWS_REGION in both files
sed -i 's/ACCOUNT_ID/123456789012/g; s/AWS_REGION/eu-west-1/g' \
  infra/ecs/api-task-definition.json \
  infra/ecs/worker-task-definition.json

# Register initial task definition revisions
aws ecs register-task-definition \
  --cli-input-json file://infra/ecs/api-task-definition.json \
  --region AWS_REGION

aws ecs register-task-definition \
  --cli-input-json file://infra/ecs/worker-task-definition.json \
  --region AWS_REGION
```

---

## 8. ECS Services

```bash
# API service — behind ALB
aws ecs create-service \
  --cluster medipulse \
  --service-name medipulse-api \
  --task-definition medipulse-api \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx,subnet-yyy],securityGroups=[sg-xxx],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=medipulse-api,containerPort=3000" \
  --health-check-grace-period-seconds 30 \
  --region AWS_REGION

# Worker service — no ALB
aws ecs create-service \
  --cluster medipulse \
  --service-name medipulse-worker \
  --task-definition medipulse-worker \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx,subnet-yyy],securityGroups=[sg-xxx],assignPublicIp=ENABLED}" \
  --region AWS_REGION
```

---

## 9. GitHub repository variables

In GitHub → repo → Settings → **Variables** → Actions (not Secrets):

| Variable | Value |
|---|---|
| `AWS_ROLE_ARN` | `arn:aws:iam::ACCOUNT_ID:role/MedipulseGithubDeploy` |
| `AWS_REGION`   | `eu-west-1` |
| `ECR_REGISTRY` | `ACCOUNT_ID.dkr.ecr.eu-west-1.amazonaws.com` |
| `ECS_CLUSTER`  | `medipulse` |

**No AWS secrets needed.** The OIDC role handles all authentication.

---

## Done

Push to `main` and the workflow runs:

```
build (api + worker in parallel)
  └─ deploy-worker  (waits for ECS stability)
       └─ deploy-api  (waits for ECS stability)
```

Every secret is injected by ECS from Secrets Manager at container start — nothing lives in GitHub.
