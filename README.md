# Hearth

**Hearth is an Alexa+ add-on (a self-hosted MCP server) that remembers your house: every appliance, filter size, shut-off valve and past repair. When something breaks it walks you through the first 15 minutes hands-free on an Echo Show, orders the exact-fit part, or hands a pro a complete job brief.**

Submission to "Build, Ship, Shape: Amazon Developer Hackathon". Track: Alexa+. Mini-challenges: Open Source, AWS Builder. License: Apache-2.0. Repository: https://github.com/Bhavya-Dhoot/hearth

## Status at a glance (read this first)

This section is written for human and machine reviewers. Every claim is either backed by a committed report or a test, or is labelled as not built.

| Question | Answer |
|---|---|
| Is there a working MCP server? | Yes. `apps/mcp-server`, MCP protocol `2025-11-25`, Streamable HTTP, SDK `@modelcontextprotocol/sdk@1.32.1`, 12 tools, 8 `ui://` widget resources. |
| Is it called by a real MCP client? | Yes, three ways: the simulated Alexa+ host in the browser, a headless replay runner, and Claude Desktop through `mcp-remote` (verified at protocol level). Code links are in [How the MCP server is called](#how-the-mcp-server-is-called-in-code). |
| Is there a real Alexa+ device or console in this project? | No. Alexa+ device and console access, the MCP Toolkit, the `alexa-ai` CLI, the Web Simulator and the Local Inspector are partner-gated. The host is a simulation, labelled "Simulated Alexa+ host" in the UI. |
| Conformance | 33 of 33 checks pass ([report](apps/mcp-server/reports/conformance.md)). |
| Latency | 50 timed calls per tool, worst p95 53.2 ms (`prepare_pro_brief`); `complete_checkout` p95 52.7 ms; read tools p95 under 10 ms. Budget is p95 under 500 ms ([report](apps/mcp-server/reports/latency.md)). |
| Is it deployed to AWS? | No. No AWS credentials existed on the build machine. The CDK app synthesizes and its tests pass. There is no public MCP URL. |
| Demo video | Not yet produced. Plan: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md). |

## Why this exists

Home-management apps die because nobody fills in forms. Voice fixes capture, and a screen in the kitchen fixes recall. Alexa+ add-on primitives (state across sessions, MCP Apps visuals, checkout) make "a house with a memory" buildable. The wedge is the first 15 minutes of a home problem: phones are wet, dirty or in another room, and nobody owns that moment.

Market context (Angi 2025 State of Home Spending): $2,041 maintenance plus $1,143 emergency repairs per household per year. Hearth feeds Alexa's Home Services partners with qualified, fully-briefed jobs; it does not replace them.

## Features, mapped to the 12 MCP tools

All tools are deterministic: no LLM call happens inside a tool. Reasoning lives in the orchestrator. Tool schemas are zod in [`packages/contracts/src/tools.ts`](packages/contracts/src/tools.ts) and are the single source for the MCP `inputSchema`/`outputSchema`.

| # | Tool | What it does | Scope | Widget (MCP Apps pattern) |
|---|---|---|---|---|
| 1 | `get_home_profile` | Summary of the house: asset count, key locations (shut-offs, panel), last events | `home:read` | `home-card` (Card) |
| 2 | `add_asset` | Add or update an appliance, fixture or shut-off from label fields; idempotent | `home:write` | `home-card` (Card) |
| 3 | `triage_issue` | Rule engine over 12 repair playbooks; at most two clarifying questions; deterministic safety hard stops | `home:read` | none (voice) |
| 4 | `get_repair_steps` | Step-by-step playbook personalised with the user's own shut-off photo and location; `stepIndex` drives "next" | `home:read` | `step-card` (Card) |
| 5 | `find_exact_part` | 3 to 5 exact-fit parts matched on asset attributes (for example trap size) with a `fitReason` | `home:read` | `parts-carousel` (Carousel) |
| 6 | `create_checkout_session` | Prices an item and returns the commitment text; never charges | `orders:write` | `checkout-card` (Card, confirm state) |
| 7 | `complete_checkout` | Completes only with `userConfirmed: true` and the customer's words; returns a rich confirmation and writes an email | `orders:write` | `checkout-card` (Card, ordered state) |
| 8 | `prepare_pro_brief` | Builds a shareable job brief (asset, age, symptom timeline, attempts, access notes) with a public URL | `home:write` | `pro-brief-card` (Card) |
| 9 | `get_weekend_plan` | Up to 6 ranked maintenance tasks from asset ages, consumable intervals, season, recalls, recent repairs | `home:read` | `weekend-list` (List) |
| 10 | `log_completion` | Records a finished repair, sets a follow-up reminder; idempotent | `home:write` | none |
| 11 | `get_history` | Timeline of events, filterable by asset, type or keyword | `home:read` | `timeline-list` (List) |
| 12 | `check_recalls` | Matches assets to a recall dataset; always discloses that the dataset is a sample | `home:read` | `recall-card` (Card) |

Other product features:

- 12 authored repair playbooks ([`packages/playbooks/data`](packages/playbooks/data)), 59 parts SKUs ([`packages/parts-catalog/data/catalog.json`](packages/parts-catalog/data/catalog.json)), and a seeded demo house, "The Okafor House", with 12 assets and 6 events ([`packages/home-graph/seed/okafor-house.json`](packages/home-graph/seed/okafor-house.json)).
- Safety hard stops for gas, electrical, structural, flooding, sewage and a child-involved repair, with verbatim messages. See [docs/SAFETY.md](docs/SAFETY.md).
- Checkout where the customer always hears the commitment before anything completes. See [docs/CHECKOUT.md](docs/CHECKOUT.md).
- OAuth 2.1 Authorization Code with PKCE (S256), built to the Alexa+ account-linking checklist. See [docs/AUTH.md](docs/AUTH.md).
- Four device frames in the host (Echo Show 8, Echo Show 15, phone, voice-only) and widgets that react to `hostContext`.

## Architecture

```
 apps/host-sim  (Next.js 15)                         SIMULATED Alexa+ host
 +-------------------------------------------------------------------------+
 | device frames (Show 8 | Show 15 | phone | voice-only)                    |
 | McpHostClient  <- packages/host-sim-core (real MCP client, bridge, replays)
 | MCP Apps renderer: sandboxed iframe + postMessage bridge + hostContext   |
 | inspector: live JSON-RPC, latency badges, auth state, orchestrator chip  |
 | /api/orchestrate  (Bedrock Converse | local Ollama | rules) + guardrails |
 | /api/tts (Polly | browser speech)      Web Speech API for STT            |
 +------+---------------------------------------------------------+--------+
        | JSON-RPC over Streamable HTTP                           | OAuth 2.1 + PKCE
        | Authorization: Bearer <RS256 JWT>                       | (browser redirect)
        v                                                         v
 apps/mcp-server  (Node 22, Express 5, MCP SDK)         apps/auth-server  (Express 5, jose)
 +------------------------------------------+           +---------------------------+
 | POST/GET/DELETE /mcp   (sessions)        |  JWKS     | /authorize  /token        |
 | 12 tools, 8 ui:// widget resources       |<----------| /.well-known/* (RFC 8414) |
 | PRM (RFC 9728), 401 without WWW-Auth.    |           | RS256, 1 h access,        |
 | /checkout-sessions  (UCP-shaped REST)    |           | 30 d rotating refresh     |
 | /receipts /briefs /outbox  /media        |           +---------------------------+
 +----+---------+----------+---------+------+
      |         |          |         |
      v         v          v         v
  home graph  playbooks   parts    checkout service ---> Stripe test | simulated
  (JSON file  (12 YAML +  catalog  (sessions, idempotency)
   or         safety      (59      email: Resend | .eml outbox
   DynamoDB)  rules)      SKUs)
```

Details, contracts C1 to C7, sequence diagrams and the data model are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run it locally

Requirements: Node 22 or newer, pnpm 10 (`packageManager` is `pnpm@10.33.0`). No cloud account, API key or GPU is needed.

```bash
pnpm install
pnpm --filter @hearth/design-tokens build && pnpm --filter @hearth/widgets build
pnpm dev
```

`pnpm dev` runs `turbo run dev --parallel`, which starts three processes: the auth server on `http://localhost:4100`, the MCP server on `http://localhost:4200/mcp`, and the simulated host on `http://localhost:3000`. The MCP server seeds the Okafor house on first boot. Open `http://localhost:3000`, click through the account-link screen, and talk to the device (type, or use push-to-talk in Chrome or Edge).

The second command builds the widget HTML that the MCP server serves as `ui://` resources, and the CSS tokens the host imports. If you prefer three terminals, the same processes are `pnpm --filter @hearth/auth-server start`, `pnpm --filter @hearth/mcp-server start` and `pnpm --filter @hearth/host-sim dev`.

Verify against the running stack:

```bash
pnpm conformance     # 33 checks, writes apps/mcp-server/reports/conformance.{md,json}
pnpm bench           # 50 timed calls per tool, writes apps/mcp-server/reports/latency.{md,json}
pnpm replay all      # plays journeys J1 to J5 headless against the live servers
pnpm test            # every package's unit tests
```

`pnpm conformance` and `pnpm bench` write test orders and timeline entries into the home they run against. To get a clean demo house, stop the MCP server, delete `apps/mcp-server/.data/home-graph.json` (gitignored) and start it again: the server seeds the Okafor house on boot when the file is missing. `pnpm seed` writes the same file (`apps/mcp-server/.data/home-graph.json`, or `HEARTH_DATA_FILE`) and is safe to run twice.

Note on the committed reports: they were generated against a stack on ports 4410 (auth) and 4420 (MCP) so they would not collide with a developer's default stack. The defaults are 4100, 4200 and 3000.

### Demo account

The demo user and its credentials are documented, for this local test system only, in [apps/auth-server/README.md](apps/auth-server/README.md#demo-account). They are not repeated here. The user id is `usr_okafor`.

### Configuration

Every value has a working local default. Variables are documented in [apps/auth-server/.env.example](apps/auth-server/.env.example), [apps/mcp-server/.env.example](apps/mcp-server/.env.example) and [apps/host-sim/.env.example](apps/host-sim/.env.example). The ones that change behaviour:

| Variable | Effect |
|---|---|
| `STRIPE_SECRET_KEY` (`sk_test_` or `rk_test_` only) | Switch from simulated payments (`pi_sim_*`) to Stripe test-mode PaymentIntents. Live keys are refused. |
| `RESEND_API_KEY`, `HEARTH_EMAIL_TO` | Switch confirmation email from the local `.eml` outbox to Resend. |
| `HEARTH_DDB_TABLE` | Switch the home graph from a JSON file to DynamoDB. |
| `AWS_*` credentials | Enable the Bedrock orchestrator and Polly voice in the host. |
| `HEARTH_ORCHESTRATOR=bedrock\|ollama\|rules` | Force an orchestrator. |

## How the MCP server is called in code

The server is not just named in this README; it is exercised by code in the repository.

| What | Where |
|---|---|
| MCP client used by the simulated host (initialize, tools/list, tools/call, resources/read, bearer injection, traffic capture) | [`packages/host-sim-core/src/client.ts`](packages/host-sim-core/src/client.ts) |
| Turn loop and rules orchestrator that decide which tools to call | [`packages/host-sim-core/src/orchestrator.ts`](packages/host-sim-core/src/orchestrator.ts), [`rules.ts`](packages/host-sim-core/src/rules.ts) |
| Scripted journeys J1 to J5 with the exact expected tool sequence | [`packages/host-sim-core/src/replays.ts`](packages/host-sim-core/src/replays.ts) |
| Headless replay runner (`pnpm replay`) | [`scripts/demo-replay.ts`](scripts/demo-replay.ts) |
| Server: Streamable HTTP transport, sessions, bearer auth, CORS | [`apps/mcp-server/src/app.ts`](apps/mcp-server/src/app.ts) |
| Server: tool registration, schemas, annotations, widget `_meta` | [`apps/mcp-server/src/mcp/server.ts`](apps/mcp-server/src/mcp/server.ts), [`tools.ts`](apps/mcp-server/src/mcp/tools.ts), [`widgets.ts`](apps/mcp-server/src/mcp/widgets.ts) |
| Conformance run (SDK client plus raw HTTP checks) | [`scripts/conformance.ts`](scripts/conformance.ts) |
| Latency benchmark | [`scripts/latency-bench.ts`](scripts/latency-bench.ts) |
| Browser host wiring (link flow, session, orchestrate route) | [`apps/host-sim/src/lib/session.ts`](apps/host-sim/src/lib/session.ts), [`lib/auth.ts`](apps/host-sim/src/lib/auth.ts), [`app/api/orchestrate/route.ts`](apps/host-sim/src/app/api/orchestrate/route.ts) |

A minimal manual call, to see the 401 contract (no `WWW-Authenticate` header, JSON body points at the protected-resource metadata):

```bash
curl -i -X POST http://localhost:4200/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

## Conformance results

Source: [apps/mcp-server/reports/conformance.md](apps/mcp-server/reports/conformance.md). Run at 2026-10-20T21:08:51Z against a live stack (MCP on port 4420, auth on 4410), protocol 2025-11-25. Result: 33 passed, 0 failed. The report's Detail column is omitted here for width.

| Group | Check | Result | ms |
| --- | --- | --- | ---: |
| discovery | protected resource metadata (RFC 9728) has the documented shape | PASS | 189 |
| discovery | authorization server metadata (RFC 8414) validates | PASS | 15 |
| auth | unauthenticated POST /mcp returns 401 JSON with no WWW-Authenticate | PASS | 13 |
| auth | a garbage bearer token gets the same 401 | PASS | 12 |
| auth | account linking (PKCE) issues a token for the MCP resource | PASS | 204 |
| protocol | initialize returns protocolVersion 2025-11-25, serverInfo, capabilities and Mcp-Session-Id | PASS | 222 |
| protocol | DELETE /mcp ends the session | PASS | 16 |
| protocol | the SDK client connects over Streamable HTTP | PASS | 49 |
| protocol | tools/list returns the 12 tools with title, description, schemas and annotations | PASS | 197 |
| resources | resources/list exposes at least 8 ui://hearth/ widgets with the MCP Apps mime type | PASS | 13 |
| resources | resources/read returns HTML for every widget | PASS | 152 |
| tools | get_home_profile | PASS | 49 |
| tools | add_asset creates then updates a probe asset idempotently | PASS | 52 |
| tools | triage_issue asks at most two questions, then resolves a playbook | PASS | 39 |
| tools | triage_issue hard-stops on a gas smell and gives a verbatim message | PASS | 7 |
| tools | get_repair_steps walks every step of the resolved playbook | PASS | 69 |
| tools | get_repair_steps past the end is a voice-safe isError | PASS | 8 |
| tools | find_exact_part returns 3 to 5 ranked, fit-reasoned items | PASS | 20 |
| tools | find_exact_part with an unknown role is a voice-safe isError (not_found) | PASS | 8 |
| checkout | create_checkout_session never charges and returns the commitment text | PASS | 24 |
| checkout | complete_checkout without a confirmation is isError not_confirmed | PASS | 9 |
| checkout | complete_checkout returns a rich confirmation, and a replay returns the same order | PASS | 40 |
| checkout | the receipt page renders | PASS | 8 |
| checkout | the confirmation email is delivered or written to the outbox | PASS | 8 |
| tools | prepare_pro_brief builds a brief with a public share page | PASS | 35 |
| tools | get_weekend_plan returns at most 6 ranked tasks | PASS | 20 |
| tools | log_completion records the job and is idempotent | PASS | 34 |
| tools | get_history filters by keyword | PASS | 14 |
| tools | check_recalls discloses that the dataset is a sample | PASS | 14 |
| auth | a token without orders:write cannot start a checkout (forbidden_scope) | PASS | 214 |
| rest | POST /checkout-sessions creates a UCP-shaped session | PASS | 24 |
| rest | GET /checkout-sessions/:id returns the session | PASS | 5 |
| rest | POST /checkout-sessions/:id/complete requires confirmation, then completes | PASS | 34 |

## Latency results

Source: [apps/mcp-server/reports/latency.md](apps/mcp-server/reports/latency.md). Run at 2026-10-20T21:09:09Z against a local stack on port 4420. 50 timed calls per tool after 3 warm-up calls; each time is the full client round trip (HTTP, JSON-RPC, schema validation, tool), in milliseconds. Budget: p95 under 500 ms (hard), p50 under 120 ms (target). Worst p95 in this run: 53.2 ms.

| Tool | Runs | p50 | p95 | max | Server p50 | Errors | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `get_home_profile` | 50 | 7.3 | 8.8 | 9.4 | 0.9 | 0 | PASS |
| `add_asset` | 50 | 15.5 | 19.6 | 20.5 | 9.6 | 0 | PASS |
| `triage_issue` | 50 | 7.6 | 9.1 | 10.1 | 1.5 | 0 | PASS |
| `get_repair_steps` | 50 | 6.5 | 7.8 | 11.6 | 0.8 | 0 | PASS |
| `find_exact_part` | 50 | 6.9 | 8.3 | 8.8 | 1 | 0 | PASS |
| `create_checkout_session` | 50 | 16.9 | 20.8 | 22.9 | 11.9 | 0 | PASS |
| `complete_checkout` | 50 | 41.1 | 52.7 | 62.4 | 35.2 | 0 | PASS |
| `prepare_pro_brief` | 50 | 42.7 | 53.2 | 73.6 | 38.1 | 0 | PASS |
| `get_weekend_plan` | 50 | 5.4 | 6.8 | 7.3 | 1 | 0 | PASS |
| `log_completion` | 50 | 25.2 | 30.3 | 73.3 | 20.2 | 0 | PASS |
| `get_history` | 50 | 7.6 | 9.9 | 12.6 | 2.1 | 0 | PASS |
| `check_recalls` | 50 | 5.2 | 7.8 | 8.8 | 0.5 | 0 | PASS |

Caveat: these are localhost numbers on a developer laptop, with a JSON-file home graph. They show the tools are not the bottleneck. They are not a measurement of a deployed service, because nothing is deployed. The bench has not run against AWS.

**DynamoDB backend, verified locally.** The same suite was run with `HEARTH_DDB_TABLE=hearth-home-graph` against DynamoDB Local (`amazon/dynamodb-local:2.6.1`) holding the CDK table shape (PK/SK plus GSI1): replays J1 to J5 pass, conformance 33 of 33, and every tool's p95 stays under the budget (worst 198.6 ms, `complete_checkout`). Reports: [latency-dynamodb-local.md](apps/mcp-server/reports/latency-dynamodb-local.md), [conformance-dynamodb-local.md](apps/mcp-server/reports/conformance-dynamodb-local.md). To reproduce: `docker run -d -p 8000:8000 amazon/dynamodb-local:2.6.1 -jar DynamoDBLocal.jar -inMemory`, create the table, then start the MCP server with `AWS_ENDPOINT_URL_DYNAMODB=http://localhost:8000` and dummy AWS credentials.

## Replay the demo journeys

Five journeys are scripted. Each turn drives real tool calls; nothing is canned output.

| Id | Journey | Device | Tools called, in order |
|---|---|---|---|
| J1 | Water under the kitchen sink: triage, repair steps, exact part, checkout, log completion | Echo Show 8 | `triage_issue` x2, `get_repair_steps` x4, `find_exact_part`, `create_checkout_session`, `complete_checkout`, `get_repair_steps` x2, `log_completion` |
| J2 | Escalation to a pro: it is the disposal | Echo Show 8 | `triage_issue`, `triage_issue`, `get_repair_steps`, `triage_issue`, `prepare_pro_brief` |
| J3 | Weekend plan, then reorder the furnace filter | Echo Show 15 | `get_weekend_plan`, `create_checkout_session`, `complete_checkout` |
| J4 | Onboarding from a label photo (fixture values) and a shut-off | Phone | `add_asset` x2 |
| J5 | History and recalls | Echo Show 8 | `get_history`, `check_recalls` |

Headless, against the running servers:

```bash
pnpm replay all        # or: pnpm replay J1
```

It exits 0 only if every journey called exactly the expected tool sequence. In the browser, open `http://localhost:3000/?replay=J1` (any of J1 to J5); after the account is linked, the journey plays at human pace with the inspector showing the JSON-RPC.

Verified results: J1 to J5 pass headless against live servers, from a fresh clone, and in the browser host (`apps/host-sim/scripts/e2e.ts`: Playwright through the real account-link flow, every journey's tool sequence checked, plus the 401 probe, device switching and the legal pages).

## Orchestrator modes

The orchestrator is the part of the simulated host that decides which tool to call next (it stands in for Alexa+'s own reasoning). It is selected per request in [`apps/host-sim/src/server/orchestrate.ts`](apps/host-sim/src/server/orchestrate.ts); the inspector chip always shows the provider that actually answered.

| Mode | When it is used | Status |
|---|---|---|
| Bedrock Converse (`us.anthropic.claude-sonnet-4-5-20250929-v1:0` by default) | AWS credentials present | Coded. Not run: no AWS credentials on the build machine. |
| Local GPU through Ollama (`qwen3:4b-instruct-2507-q4_K_M`) | No AWS credentials, Ollama reachable and the model pulled | Verified on an RTX A2000 Laptop (4 GB). About 1.9 s per orchestrator step warm (8.4 s cold), 12 tool schemas in the prompt. Completed a real weekend plan, reorder, explicit yes, order flow. |
| Deterministic rules | Neither of the above; also the default for `?replay=` so replays reproduce | Verified: this is what the headless replays and the browser E2E use, and it is unit tested in `packages/host-sim-core`. |

Opt a replay into a model with `?replay=J1&orchestrator=ollama`. Force a mode with `HEARTH_ORCHESTRATOR`.

Guardrails that run on every decision from any mode (`guardrails()` in the same file; rationale in [docs/SAFETY.md](docs/SAFETY.md)):

- A `triage_issue` hard stop replaces whatever the model said with `safety.message`, verbatim, and no steps follow.
- `complete_checkout` is dropped unless the previous assistant turn contained that session's commitment text and the latest user turn is an explicit yes (or a tap on confirm for the same session). Otherwise the host says "Say yes to confirm, or no to cancel."
- A placed order is always spoken with its payment mode ("Simulated payment: no card was charged." or "Stripe test mode: no real charge."), because a small model paraphrased that disclosure away.
- At most 4 tool calls per turn.

Bedrock Guardrails is a separate, probabilistic layer; see the "not built" table for its exact status.

## What is real and what is simulated

| Component | Status | Detail |
|---|---|---|
| MCP server (`apps/mcp-server`) | Real | Runs, serves the 2025-11-25 Streamable HTTP protocol, 33 of 33 conformance checks. |
| MCP client in the host | Real | The official SDK client wrapped in `McpHostClient`; the inspector shows genuine JSON-RPC. |
| Alexa+ host (device, wake word, native orchestrator, Home Services flow) | Simulated | A web page acting as an MCP client, per the hackathon FAQ. Labelled "Simulated Alexa+ host". The hand-off to a plumber is a spoken line; no booking happens. |
| Alexa+ account linking | Simulated | Real OAuth 2.1 + PKCE against our own authorization server. Alexa's real client id and redirect URIs are not public; the host uses client id `alexa-plus-host-sim`. |
| Auth server | Real, local | RS256 JWTs, PKCE verification, refresh rotation, negative tests. Demo user only. |
| Home graph | Real, local | JSON-file `MemoryRepo` by default. `DynamoRepo` is behind the same interface: unit-tested against a fake client and verified end to end against DynamoDB Local with the CDK table shape (J1 to J5, conformance 33/33, bench). It has not run against AWS-hosted DynamoDB. |
| Playbooks, triage, safety rules | Real | 12 authored YAML playbooks, deterministic rule engine, 24-prompt red-team list enforced by tests. |
| Parts catalog | Seeded sample | 59 SKUs written for the demo. Prices and SKUs are not from a retailer. Exact-fit matching logic is real. |
| Recall data | Labelled sample | 4 entries. Not a live CPSC feed. The tool says so every time (`isSample`). |
| Payments | Simulated by default | `pi_sim_*` ids, labelled `simulated`. With a Stripe test key the code creates test-mode PaymentIntents; that path was not exercised against Stripe (no key on the build machine). No real money moves in any mode. |
| Confirmation email | Local outbox by default | `.eml` files written to `apps/mcp-server/.outbox` and listed at `/outbox`. The Resend path is coded and not exercised. |
| Seed photos | Illustrations | Clean SVG line drawings with fixed annotation coordinates, not photographs of a real house. |
| Vision onboarding (J4) | Fixture values | The host does not run a vision model. The label fields (brand, model, serial, year) are supplied by the replay as if a vision step had read them. |
| Speech in | Real browser API | Web Speech API (Chrome, Edge). Not available in Firefox. |
| Speech out | Real when keyed | Amazon Polly (neural "Ruth") with AWS credentials, otherwise browser speech synthesis. The Polly path is coded and untested. |
| Claude Desktop | Real, protocol level | Verified through `mcp-remote` (initialize, 12 tools, a real tool call). The Claude Desktop GUI itself was not driven. |
| Deployment | Not done | CDK synthesizes and passes 18 tests. Nothing deployed. |

## Stretch status and what is not built

| Item | Status | Honest reason |
|---|---|---|
| Deploy to AWS (Fargate + ALB + CloudFront + DynamoDB) | Not run | No AWS credentials on the build machine. [infra/cdk](infra/cdk/README.md) synthesizes; the three container images were built and started locally. No deployed latency is claimed. |
| Bedrock AgentCore Runtime | Synth only | The stack exists (`-c agentcore=true`) and is unit tested, but never deployed. It also cannot satisfy our auth contract: AgentCore answers 401 itself with a `WWW-Authenticate` header (Alexa+ forbids it), its JWT mode requires an OIDC discovery URL (we are pure OAuth 2.1), and its resource URL cannot be `base + /mcp`. Details in [infra/cdk/AGENTCORE.md](infra/cdk/AGENTCORE.md). Fargate is the primary design for that reason. |
| AgentCore Memory | Provisioned in the stack, not used | `apps/mcp-server` does not call it. DynamoDB is the system of record. |
| Bedrock Guardrails | Defined, not attached in code | The policy ([`packages/playbooks/safety/bedrock-guardrail.json`](packages/playbooks/safety/bedrock-guardrail.json)) becomes a guardrail in the CDK stack, but the host's Bedrock Converse call does not pass a `guardrailConfig` yet, and the host does not read `HEARTH_GUARDRAIL_ID`. The deterministic hard-stop rules do not depend on it. Never tested against AWS. |
| SES email adapter | Not built | The CDK grants `ses:SendEmail` and creates an identity, but the server only has a Resend adapter and the local outbox. |
| Real Echo bridge (classic-skill approach) | Not built | Not required by the hackathon, and no device access. |
| Vision onboarding via Bedrock | Not built | The label-photo step uses fixture values (see above). |
| Live CPSC recall lookup | Not built | Recalls are a labelled 4-entry sample dataset. |
| Household members ("who changed the filter last") | Not built | Out of scope for v1. |
| `host-sim-core` as a published package | Not published | It is a standalone, Apache-2.0 workspace package ([`packages/host-sim-core`](packages/host-sim-core)) usable as a library, but it has not been published to npm. This is the Open Source mini contribution. |
| Amazon Wallet `network_token` | Not possible | Requires Amazon Pay merchant onboarding. Hearth uses `stored_payment_method` (display string only). |
| Real photos of a house | Not provided | Seed media are SVG illustrations. |
| Demo video | Not produced yet | See [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md). |

## Claude Desktop

Hearth is a plain MCP server, so another assistant can call it. Claude Desktop connects through `mcp-remote` with a development token minted by the auth server (Claude Desktop cannot run the Alexa account-linking flow, and Hearth allows no dynamic client registration).

```bash
pnpm --silent --filter @hearth/auth-server mint-dev-token   # prints a 1 hour token for usr_okafor
```

Put it in the config file ([docs/claude_desktop_config.json](docs/claude_desktop_config.json)):

```json
{
  "mcpServers": {
    "hearth": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@0.15.2",
        "http://localhost:4200/mcp",
        "--header",
        "Authorization:Bearer <paste token from mint-dev-token>"
      ]
    }
  }
}
```

Verified at protocol level with this exact `mcp-remote` command: `initialize` negotiated 2025-11-25, `tools/list` returned 12 tools, and a real tool call returned data. The MCP server and auth server must be running first. Tokens last one hour.

## Documentation index

| Document | Purpose |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, contracts C1 to C7, J1 sequence, auth, checkout, safety, data model, deployment |
| [docs/AUTH.md](docs/AUTH.md), [docs/CHECKOUT.md](docs/CHECKOUT.md), [docs/SAFETY.md](docs/SAFETY.md) | Frozen contracts and the safety model |
| [docs/DECISIONS.md](docs/DECISIONS.md) | One-line ADR log |
| [docs/FRICTION_LOG.md](docs/FRICTION_LOG.md) | Dated friction entries with Alexa+, MCP, MCP Apps and AWS tooling |
| [docs/PRODUCT_FEEDBACK.md](docs/PRODUCT_FEEDBACK.md) | Feedback per tool, API and SDK used |
| [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) | Shot list and voice-over for the video |
| [docs/SUBMISSION.md](docs/SUBMISSION.md) | Devpost text description |
| [docs/addon.json](docs/addon.json) | Add-on manifest written to [addon.schema.json](docs/addon.schema.json) (no test in this repo validates it); endpoints use the placeholder host `hearth.example` |
| [docs/PRIVACY.md](docs/PRIVACY.md), [docs/TERMS.md](docs/TERMS.md) | Privacy policy and terms (also served by the host at `/privacy` and `/terms`) |
| [infra/cdk/README.md](infra/cdk/README.md), [infra/cdk/AGENTCORE.md](infra/cdk/AGENTCORE.md) | Cloud deployment and the AgentCore variant |
| [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) | Contributing and security reporting |

## Repository layout

```
apps/
  mcp-server/      the add-on: Streamable HTTP MCP server, 12 tools, widgets, checkout REST
  auth-server/     OAuth 2.1 + PKCE authorization server, RFC 8414 metadata, JWKS
  host-sim/        Next.js simulated Alexa+ host: device frames, inspector, orchestrate + tts routes
packages/
  contracts/       zod schemas for tools (C1), widgets (C2), DB rows (C3), bridge (C4), auth, checkout
  playbooks/       12 repair playbooks (YAML), triage engine, safety rules and messages, Bedrock guardrail policy
  parts-catalog/   59-SKU catalog, exact-fit matcher, sample recall data
  home-graph/      HomeRepository: MemoryRepo, DynamoRepo, seed loader (The Okafor House)
  widgets/         8 MCP Apps widgets, each built to one self-contained, content-hashed HTML file
  design-tokens/   tokens.json -> CSS variables (C7), shared by widgets and host
  host-sim-core/   MCP host runtime: client, bridge, orchestrators, replays (the Open Source mini package)
infra/cdk/         AWS CDK app: data, service and optional AgentCore stacks
scripts/           seed, conformance, latency-bench, demo-replay
docs/              contracts, safety, architecture, submission documents, addon.json, icons
```

Test counts at the time of writing (each package's `pnpm test`): playbooks 522, parts-catalog 49, home-graph 78, mcp-server 85, auth-server 55, host-sim-core 58, widgets 29, design-tokens 3, host-sim 19, infra 18 (916 in total).

## License

Apache License 2.0. See [LICENSE](LICENSE). Security reports: [SECURITY.md](SECURITY.md).
