# Hearth on Amazon Bedrock AgentCore (AWS Builder mini)

`aws-cdk-lib` 2.274 ships AgentCore in the stable library (`aws-cdk-lib/aws-bedrockagentcore`: L1 `CfnRuntime`, `CfnMemory`, plus L2 `Runtime`, `Memory`, `Gateway`). So the variant is code, not just a runbook: `lib/agentcore-stack.ts`, enabled with context `agentcore=true`. It synthesizes and is unit tested; it has not been deployed (no AWS credentials on the build machine).

Status of each claim below is marked: **verified** means read from the AWS documentation on 2026-10-21 (links at the end); **inferred** means not confirmed by a document or a run.

## What the stack creates

- `AWS::BedrockAgentCore::Runtime` `hearth_mcp`: the `apps/mcp-server` image, `ProtocolConfiguration: MCP`, public network mode, IAM (SigV4) inbound auth by default, or a custom JWT authorizer when `agentcoreDiscoveryUrl` is set.
- `AWS::BedrockAgentCore::Memory` `hearth_home_recall`: built-in semantic and user-preference strategies, 90 day event expiry, read/write granted to the runtime role.
- The runtime role also gets DynamoDB read/write on `hearth-home-graph` (same least-privilege grant as the Fargate task).
- Outputs: `AgentRuntimeArn`, `AgentCoreMcpUrl` (invocation URL with the URL-encoded ARN), `AgentCoreMemoryId`.

```bash
cd infra/cdk
pnpm exec cdk deploy HearthData HearthService HearthAgentCore -c agentcore=true -c senderEmail=you@yourdomain.com
```

The image must be ARM64. On an x86 machine or runner enable emulation first (`docker run --privileged --rm tonistiigi/binfmt --install arm64`, or `docker/setup-qemu-action` in CI, which `deploy.yml` does when the `agentcore` input is true). The stack builds this image from `apps/mcp-server/Dockerfile` with `platform: linux/arm64`; the Fargate variant uses x86.

## The container contract (verified)

From "MCP protocol contract" in the AgentCore developer guide:

- Host `0.0.0.0`, port **8000**, path **`/mcp`** (POST), Streamable HTTP. The stack sets `PORT=8000`; `apps/mcp-server` reads `PORT`, so no code change is needed.
- Platform **ARM64**.
- Stateless or stateful servers are both supported. The platform adds an `Mcp-Session-Id` header to requests that lack one and routes by it to the same microVM; clients must echo the id. Hearth's stateful sessions should be compatible with this (inferred; not run).
- Remote URL: `https://bedrock-agentcore.<region>.amazonaws.com/runtimes/<URL-encoded runtime ARN>/invocations?qualifier=DEFAULT` (`:` becomes `%3A`, `/` becomes `%2F`).
- Runtime name pattern `[a-zA-Z][a-zA-Z0-9_]{0,47}` (so `hearth_mcp`, not `hearth-mcp`).
- Inbound auth is IAM SigV4 **or** JWT bearer, not both on one runtime.

## Gaps between AgentCore and Hearth's auth model

These are why the Fargate deployment, not AgentCore, is the primary one.

1. **401 shape.** Alexa+ account linking (PRD 7.5) wants an unauthenticated `POST /mcp` to return 401 with **no** `WWW-Authenticate` header. AgentCore answers a missing bearer token itself, before the container, with 401 **and** `WWW-Authenticate: Bearer resource_metadata="https://bedrock-agentcore.<region>.amazonaws.com/runtimes/<arn>/invocations/.well-known/oauth-protected-resource?qualifier=..."` (verified). The container cannot change that. SigV4 runtimes answer 403 `ACCESS_DENIED` instead. Neither matches the checklist.
2. **OIDC discovery.** The JWT authorizer's `discoveryUrl` must match `^.+/\.well-known/openid-configuration$` (verified). Hearth's auth server deliberately serves only RFC 8414 `/.well-known/oauth-authorization-server` (docs/AUTH.md says "no OIDC"). To use the JWT path, the auth server needs an `openid-configuration` alias returning the same metadata with `issuer` equal to the token `iss`.
3. **Claim checks.** If `allowedClients` is set, the token's `client_id` claim must match; if `allowedAudience` is set, `aud` must match (verified). Hearth tokens carry both (`client_id: alexa-plus-host-sim`, `aud` = `<HEARTH_MCP_BASE>/mcp`), so `-c agentcoreAllowedClients=alexa-plus-host-sim -c agentcoreAllowedAudience=<resource URL>` works once discovery exists.
4. **Resource URL.** The MCP server validates `aud` against `${HEARTH_MCP_BASE}/mcp` and publishes that in its protected-resource metadata. The AgentCore URL ends in `/invocations?qualifier=DEFAULT`, so it cannot be expressed as `base + /mcp`. The stack therefore does not set `HEARTH_MCP_BASE` on the runtime (inferred: tokens minted for the Fargate resource URL will fail the server's own audience check there unless `HEARTH_MCP_BASE` is set to match what the client uses).
5. **Secrets.** AgentCore runtime `environmentVariables` are plain strings. Stripe and Resend keys are not injected; the runtime uses simulated payments and the local outbox unless the server is taught to read Secrets Manager itself.
6. **Local files.** Runtime sessions are ephemeral microVMs; anything the server writes under `.data/` or `.outbox/` is gone at session end. With `HEARTH_DDB_TABLE` set the home graph is in DynamoDB, so this only affects the email outbox.

## Manual steps (console or CLI), without CDK

Field names below are from the `CreateAgentRuntime` API reference (verified); the exact CLI shorthand has not been run.

1. Build and push an ARM64 image:
   ```bash
   aws ecr create-repository --repository-name hearth-mcp
   aws ecr get-login-password | docker login --username AWS --password-stdin <acct>.dkr.ecr.<region>.amazonaws.com
   docker buildx build --platform linux/arm64 -f apps/mcp-server/Dockerfile -t <acct>.dkr.ecr.<region>.amazonaws.com/hearth-mcp:latest --push .
   ```
2. Create an execution role trusted by `bedrock-agentcore.amazonaws.com` with ECR pull (`ecr:GetAuthorizationToken`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`), CloudWatch Logs, and DynamoDB access on the table (inferred minimum; the CDK `Runtime` construct builds this role for you).
3. Create the runtime:
   ```bash
   aws bedrock-agentcore-control create-agent-runtime \
     --agent-runtime-name hearth_mcp \
     --agent-runtime-artifact '{"containerConfiguration":{"containerUri":"<acct>.dkr.ecr.<region>.amazonaws.com/hearth-mcp:latest"}}' \
     --network-configuration '{"networkMode":"PUBLIC"}' \
     --protocol-configuration '{"serverProtocol":"MCP"}' \
     --environment-variables PORT=8000,HEARTH_DDB_TABLE=hearth-home-graph \
     --role-arn arn:aws:iam::<acct>:role/<runtime-role>
   ```
   Add `--authorizer-configuration '{"customJWTAuthorizer":{"discoveryUrl":"https://<issuer>/.well-known/openid-configuration","allowedClients":["<client-id>"]}}'` for JWT inbound auth.
4. Console: the same fields exist in the Amazon Bedrock AgentCore console under Runtime (menu labels not verified; use the CLI call above as the reference).
5. Test with the MCP Inspector (`npx @modelcontextprotocol/inspector`): transport Streamable HTTP, the invocation URL above, header `Authorization: Bearer <token>` (JWT runtimes only; the Inspector cannot SigV4-sign). This path is documented by AWS; for a SigV4 runtime use an SDK client or a signing proxy.

The AgentCore CLI (`npm install -g @aws/agentcore`; `agentcore create --no-agent`, `agentcore add agent --protocol MCP --authorizer-type CUSTOM_JWT --discovery-url ... --allowed-clients ... --request-header-allowlist Authorization`, `agentcore deploy`) is documented for Python projects and packages source into an S3 artifact. It does not fit this Node/pnpm monorepo, which is why the stack uses a container artifact.

## AgentCore Memory as the home-graph recall option

The Home Graph in DynamoDB is the system of record: structured, deterministic, and the thing tools read in under 500 ms. AgentCore Memory is the option for the soft layer Alexa+ describes as "based on previous conversations": preferences, offhand facts ("the basement smells damp in spring", "we prefer Rheem parts") that do not belong in a typed asset row.

What is provisioned: a memory store with the built-in **semantic** strategy (facts extracted from conversation events) and **user-preference** strategy, 90 day event expiry. The runtime role holds the CDK-generated read/write grants (`CreateEvent`, `RetrieveMemoryRecords`, `ListMemoryRecords`, `ListEvents`, and related actions, per the construct's permission set).

How it would be used (not implemented in apps/mcp-server): on `add_asset` and `log_completion`, write a conversation event with `actorId` = the token `sub` (the only continuity key); in `get_home_profile` and `triage_issue`, call `RetrieveMemoryRecords` in the user's namespace and add the top records to the structured result as context for the orchestrator. The memory id is exposed as `HEARTH_AGENTCORE_MEMORY_ID`. Retrieval adds a network call, so it must stay off the p95 path or be fetched in parallel with the DynamoDB read; that call budget has not been measured.

## Sources (read 2026-10-21)

- Deploy MCP servers in AgentCore Runtime: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html
- MCP protocol contract: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp-protocol-contract.html
- Inbound JWT and OAuth: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-oauth.html
- CreateAgentRuntime API: https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_CreateAgentRuntime.html
