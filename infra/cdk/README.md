# Hearth infrastructure (AWS CDK)

A synthesizable CDK app and CI for Hearth's cloud deployment (PRD 5.2 item 3, "AWS Builder mini"). It was written and verified without AWS credentials: `typecheck`, `test` and `synth` pass, and nothing has been deployed (see "What was not done").

```
                    Alexa+ / host-sim / MCP clients
                                 |  HTTPS
        +------------------------+------------------------+
        v                        v                        v
  CloudFront (mcp)        CloudFront (auth)        CloudFront (host)     <- free *.cloudfront.net HTTPS, no caching
        +------------------------+------------------------+
                                 |  HTTP + X-Hearth-Origin: <stack token>-<route>
                         Application Load Balancer   (rule per route, default 403)
              +------------------+------------------+
              v                  v                  v
        Fargate: mcp-server  Fargate: auth-server  Fargate: host-sim      <- desiredCount 1 each, always on
              |    ^
              |    +-- JWKS fetched from the auth issuer URL
              +--> DynamoDB hearth-home-graph (PK/SK + GSI1, PITR)     Secrets Manager x3     SES identity
                   Bedrock Guardrail (host: InvokeModel + ApplyGuardrail)
```

## Stacks

| Stack | File | What it does |
|---|---|---|
| `HearthData` | `lib/data-stack.ts` | DynamoDB `hearth-home-graph`: `PK`/`SK` strings, `GSI1` (`GSI1PK`/`GSI1SK`), on-demand billing, point-in-time recovery, deletion protection, `RETAIN`. Also the three Secrets Manager secrets (`hearth/STRIPE_SECRET_KEY`, `hearth/RESEND_API_KEY`, `hearth/HEARTH_AUTH_PRIVATE_JWK`), created with the placeholder value `REPLACE_ME` so they can be filled before any container starts. |
| `HearthService` | `lib/service-stack.ts` | VPC (public subnets, DynamoDB gateway endpoint, no NAT), ECS cluster, three Fargate services built from the three Dockerfiles (`DockerImageAsset`), one ALB, one CloudFront distribution per service, SES email identity, Bedrock Guardrail plus an immutable guardrail version, least-privilege task roles. |
| `HearthAgentCore` | `lib/agentcore-stack.ts` | Optional (`-c agentcore=true`). The mcp-server image as an AgentCore Runtime with protocol MCP, plus an AgentCore Memory store. See `AGENTCORE.md`. |

Outputs of `HearthService`: `McpUrl` (public HTTPS, ends in `/mcp`), `AuthIssuerUrl`, `TableName`, `GuardrailId`, `GuardrailVersion`, `SenderIdentityArn`, `HostSimUrl`. `HearthData` also outputs `TableName`.

## Commands

```bash
pnpm --filter @hearth/infra-cdk typecheck
pnpm --filter @hearth/infra-cdk test
pnpm --filter @hearth/infra-cdk synth          # no credentials, no Docker needed

# One-time per account/region
pnpm --filter @hearth/infra-cdk exec cdk bootstrap

# Deploy (Docker must be running: images are built and pushed here, not at synth)
cd infra/cdk
pnpm exec cdk deploy HearthData
node scripts/gen-auth-jwk.mjs > jwk.json
aws secretsmanager put-secret-value --secret-id hearth/HEARTH_AUTH_PRIVATE_JWK --secret-string file://jwk.json
pnpm exec cdk deploy HearthService -c senderEmail=you@yourdomain.com
```

The GitHub Actions workflow `.github/workflows/deploy.yml` does the same in order (data stack, secrets, services) using OIDC, then runs `pnpm bench` against the deployed URL.

Context flags (`-c key=value`, defaults in `cdk.json`):

| Key | Default | Meaning |
|---|---|---|
| `senderEmail` | `hearth-noreply@example.com` | SES identity and `HEARTH_EMAIL_FROM`. Change it, or SES will email `example.com`. |
| `hostSim` | `true` | Also run apps/host-sim (about $18/month). `false` drops it and its distribution. |
| `useResend` | `false` | Inject `RESEND_API_KEY` into the MCP server. Off by default because the server treats any non-empty value as a real key. |
| `bedrockModelId` | unset | Passed to the host as `HEARTH_BEDROCK_MODEL_ID`. |
| `agentcore` | `false` | Also synthesize/deploy `HearthAgentCore`. |
| `agentcoreDiscoveryUrl`, `agentcoreAllowedClients`, `agentcoreAllowedAudience` | unset | JWT inbound auth for AgentCore (comma separated lists). Unset means IAM SigV4. |

## Secrets

All three live in Secrets Manager and reach the containers through ECS `secrets` (never as plain environment values; a test enforces this).

| Secret | Env var | Notes |
|---|---|---|
| `hearth/STRIPE_SECRET_KEY` | `STRIPE_SECRET_KEY` | Placeholder is safe: the server ignores any key that is not `sk_test_`/`rk_test_` and falls back to simulated payments. |
| `hearth/RESEND_API_KEY` | `RESEND_API_KEY` | Only injected with `-c useResend=true`. Put the real key first. |
| `hearth/HEARTH_AUTH_PRIVATE_JWK` | `HEARTH_AUTH_PRIVATE_JWK` | Full RS256 private JWK as JSON (`scripts/gen-auth-jwk.mjs`). `apps/auth-server` reads it at boot (`src/keys.ts`, `resolveSigningKeys`), so the signing key survives restarts and is shared by every task. Populate the secret before the first service deploy: the container refuses to start on the placeholder `REPLACE_ME`, and the deployment circuit breaker rolls back. |

## Why Fargate + ALB + CloudFront (not App Runner)

I considered App Runner first (single `CfnService`, `minSize: 1`). Four things decided against it:

1. **A circular dependency.** The services need each other's public URL in their environment: the MCP server needs the auth issuer, the auth server needs the MCP base (token `aud`) and the host base (redirects). App Runner only creates `https://<random>.awsapprunner.com` once the service exists, so each URL is an attribute of the resource that needs the other. CloudFormation rejects that. Here the ALB depends on no service, the distributions depend only on the ALB, and the services depend on the distributions, so all URLs resolve in one deploy with no custom domain and no two-phase rollout.
2. **No session affinity.** The MCP server keeps `Mcp-Session-Id` sessions in memory. App Runner offers no sticky routing, so any scale-out would break sessions. We pin one task per service on both options, but Fargate gives us explicit control (`desiredCount`, rolling deploy settings) rather than an autoscaler we have to cap at 1.
3. **Long-lived streams.** `GET /mcp` opens an SSE stream. App Runner enforces a maximum request duration (120 s, from memory; check the current docs). On the ALB the idle timeout is tunable (default 60 s) and the CloudFront origin read timeout is set to 60 s, so a quiet SSE stream can still be cut; clients reconnect with the session id.
4. **Secrets.** `ecs.Secret.fromSecretsManager` injects secrets natively with the task execution role; App Runner needs a separate instance role and ARN-valued env entries.

Costs of that choice: an ALB (about $16/month fixed), and an extra hop (CloudFront to ALB over HTTP, protected by a per-stack origin token header; OAuth bearer validation on `/mcp` is the real access control).

## How the < 500 ms budget is met

PRD 7.2 asks for p95 under 500 ms and p50 under 120 ms. Infra levers, in order of impact:

- **No cold start.** Each service has `desiredCount: 1` with `minHealthyPercent: 100`; there is no autoscaling to zero. A task is always running, and the app loads playbooks and the parts catalog at boot.
- **Tools make no LLM calls**, so the server's own time is a DynamoDB round trip (single-digit ms) plus rule evaluation.
- **Same-region DynamoDB through a gateway VPC endpoint**: no NAT, no internet hop, no per-GB charge.
- **Caching disabled but connection reuse on**: CloudFront keeps HTTP/2 to viewers and keep-alive (60 s) to the ALB, so TLS and TCP setup are paid once per client, not per call. `compress: false` keeps SSE unbuffered.
- **Rolling deploys keep one healthy task** (`minHealthyPercent: 100`, `maxHealthyPercent: 200`, circuit breaker with rollback), so a deploy does not create a cold window. MCP sessions held by the old task are lost; clients re-initialize.
- **Measurement is part of the pipeline**: `pnpm bench` (50 calls per tool) runs in CI against a local stack and in `deploy.yml` against the deployed URL, failing at p95 of 500 ms.

Not measured: no number in this document is a measured latency. The bench has not run against AWS.

## Scaling and sessions

One task per service, deliberately. MCP sessions and OAuth authorization codes are in process memory. Scaling the MCP service out needs either a shared session store or the SDK in stateless mode (AgentCore also supports stateless). For the hackathon load (a demo and a bench) one 0.5 vCPU task is ample.

## IAM (least privilege)

- mcp-server task role: `dynamodb:GetItem/PutItem/UpdateItem/DeleteItem/Query/Scan/BatchGetItem/BatchWriteItem/...` on the table and `index/*` only (CDK `grantReadWriteData`; never `dynamodb:*`, never `*`), and `ses:SendEmail`, `ses:SendRawEmail` on the sender identity.
- host-sim task role: `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream` on foundation models and inference profiles, `bedrock:ApplyGuardrail` on the guardrail ARN, and `polly:SynthesizeSpeech` (Polly has no resource-level permissions, so this one is on `*`).
- Execution roles read only the specific secrets they inject. The auth-server role has no AWS permissions beyond that.
- `test/hearth.test.ts` asserts no `*` action, no `dynamodb:*`, and that DynamoDB actions are not granted on `*`.

Heads up: the mcp-server today sends email only through Resend (`RESEND_API_KEY`, else a local outbox). The SES permission and identity are in place for the PRD's "Resend (dev) / SES (prod)" plan, but the server has no SES adapter yet.

## Guardrail policy

`packages/playbooks/safety/bedrock-guardrail.json` is loaded at synth time if it exists; otherwise the built-in default in `lib/guardrail.ts` applies (denied topics: gas line work, electrical panel work, structural repair, sewage handling, content about children; refusal in Hearth's voice). The file uses the CloudFormation property names of `AWS::Bedrock::Guardrail` in camelCase, for example:

```json
{
  "blockedInputMessaging": "...",
  "blockedOutputsMessaging": "...",
  "topicPolicyConfig": { "topicsConfig": [ { "name": "Gas line work", "type": "DENY", "definition": "...", "examples": ["..."] } ] },
  "contentPolicyConfig": { "filtersConfig": [ { "type": "HATE", "inputStrength": "HIGH", "outputStrength": "HIGH" } ] }
}
```

`name` and `tags` are owned by the stack. Missing keys fall back to the defaults, so a partial file cannot weaken the blocked messaging. A new policy hash creates a new immutable guardrail version (`GuardrailVersion<hash>`); the host receives `HEARTH_GUARDRAIL_ID` and `HEARTH_GUARDRAIL_VERSION`.

## Environment contract

| Variable | Set on | Read by the app today |
|---|---|---|
| `HEARTH_MCP_BASE`, `HEARTH_AUTH_ISSUER`, `HEARTH_HOST_BASE` | all | yes (`urlsFromEnv`) |
| `HEARTH_DDB_TABLE` | mcp | yes (selects DynamoRepo) |
| `STRIPE_SECRET_KEY`, `RESEND_API_KEY` | mcp | yes |
| `HEARTH_EMAIL_FROM` | mcp | yes |
| `PORT` | all | yes (mcp, auth) |
| `HEARTH_AUTH_PRIVATE_JWK` | auth | yes |
| `HEARTH_GUARDRAIL_ID`, `HEARTH_GUARDRAIL_VERSION`, `HEARTH_BEDROCK_MODEL_ID` | host | unknown, host-sim agent should read them |
| `HEARTH_AGENTCORE_MEMORY_ID` | AgentCore runtime | no |

Requirements on the apps: listen on `0.0.0.0` (Express default) and derive public URLs from the env vars above, never from the `Host` header. TLS terminates at CloudFront, so the container only ever sees HTTP.

## Cost notes (estimates)

Estimates from list prices for us-east-1 as I recall them; they are not from a bill or the AWS pricing API, so check before relying on them.

| Item | Approx. per month |
|---|---|
| Fargate mcp (0.5 vCPU, 1 GB) | $18 |
| Fargate auth (0.25 vCPU, 0.5 GB) | $9 |
| Fargate host-sim (0.5 vCPU, 1 GB), optional | $18 |
| ALB (fixed plus a few LCUs) | $18 to $22 |
| CloudFront (3 distributions, low traffic) | about $0 to $2 |
| DynamoDB on-demand, PITR | cents at demo volume |
| Secrets Manager (3 secrets) | $1.20 |
| Guardrail, Bedrock, Polly, SES | usage based, cents at demo volume |
| NAT gateway | $0 (none; public subnets) |

Roughly $65 to $75 a month with the host, $45 to $55 without. Tear down with `cdk destroy HearthAgentCore HearthService` (the table and its backups are retained on purpose; delete them by hand).

## What was not done

No AWS account credentials exist on the build machine, so nothing here has been deployed or exercised against AWS:

- `cdk deploy`, `cdk bootstrap` and the GitHub OIDC role were never run. Passing `synth` and unit tests proves the templates are well formed and meet the assertions in `test/`; it does not prove CloudFormation will accept every property (for example the guardrail topic definitions, the AgentCore runtime properties, or ALB header conditions), nor that SES, Bedrock model access and AgentCore are enabled in the target account.
- The latency bench has not run against AWS, so no deployed latency is claimed.
- The three Docker images were built locally (Docker Desktop, `docker build -f apps/<app>/Dockerfile .`) and each container was started: mcp-server answers `/healthz` 200 and rejects an unauthenticated `POST /mcp` with 401, auth-server serves its metadata with 200, host-sim serves `/` with 200, all as the non-root `node` user. They were run with local defaults, not against real AWS services. Building them found two missing `COPY` steps (`tsconfig.base.json`, and the design-tokens build for host-sim) that are now fixed.
- SES sender verification (a click in the confirmation email) and Bedrock model access are account-side steps.
- The AgentCore variant is synthesizable but undeployed, and has real compatibility gaps with Hearth's auth model (see `AGENTCORE.md`).
