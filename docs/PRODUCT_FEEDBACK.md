# Product feedback

One section per tool, API or SDK Hearth uses. Each says what we used it for, how far we got with it (so a reader can weigh the feedback), what worked, what did not, and one concrete suggestion. Detailed, dated entries with code links are in [FRICTION_LOG.md](FRICTION_LOG.md); IDs such as A6 or C1 refer to them.

Honesty note on evidence: Bedrock, Guardrails, AgentCore, DynamoDB, Polly, Stripe and Resend were integrated in code but not run against live services, because the build machine had no AWS credentials and no Stripe or Resend keys. Feedback on those comes from reading the documentation and types, from synthesizing the CDK app, and from unit tests with fakes. Each section says which kind of evidence it rests on.

| Tool | Evidence level |
|---|---|
| MCP TypeScript SDK 1.32.1 | Used in production-shaped code and in 33 conformance checks |
| MCP Apps spec | Implemented from the documentation; no real host to test against |
| Alexa+ add-on docs | Read and built to; no Alexa+ access to check against |
| Ollama (local model) | Run on real hardware, measured |
| Web Speech API | Coded; not exercised by the automated runs |
| Amazon Bedrock Converse | Coded; not run |
| Amazon Bedrock Guardrails | Policy and CDK resource written and synthesized; not attached in code; not run |
| Bedrock AgentCore | CDK stack synthesized and unit tested; documentation read; not deployed |
| Amazon DynamoDB | Repository coded and unit tested against a fake; CDK table synthesized; not run on AWS |
| Stripe (test mode) | Coded with a test-key guard; not run (no key) |
| Resend | Coded; not run (no key) |
| Amazon Polly | Coded; not run |

---

## MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.32.1)

**Used for:** server (`StreamableHTTPServerTransport`, low-level request handlers), the client in the browser host and in scripts (`Client`, `StreamableHTTPClientTransport`), protocol 2025-11-25.

**What worked**
- The Streamable HTTP server transport implemented sessions (`Mcp-Session-Id`), SSE streams and `DELETE` with little code; `initialize`, `tools/list` and `tools/call` passed conformance first time the schemas were right.
- zod schemas as the single source of truth for `inputSchema` and `outputSchema` removed hand-copied JSON Schema (DECISIONS #3).
- The client works in both Node and the browser, which let one `McpHostClient` serve the inspector, the replay script and the benchmark.

**What did not** (details in the friction log)
- The client rejects `isError` results that do not match `outputSchema` (C1).
- `registerTool` freezes `_meta` and returns validation failures as free text (C2).
- `requireBearerAuth` always sets `WWW-Authenticate` and its types fail under pnpm strict resolution (C3).
- `StreamableHTTPClientTransport` has static headers and assumes an OAuth provider on 401 (C4).
- The default Ajv validator is not CSP-safe in the browser (C5).

**Suggestion:** exempt `isError` from output-schema validation, and accept a `getToken` callback on the client transport. Those two changes would remove most of our workaround code.

---

## MCP Apps specification

**Used for:** eight widgets served as `ui://hearth/*` resources, a postMessage bridge, `hostContext`.

**What worked**
- Treating a widget as a presentational HTML file that only receives props kept the widgets testable. Because tool output equals widget props (C2), a widget can render from a fixture with no server, which is how the widget preview page (`packages/widgets/preview`) renders every widget from sample props.
- Content-hashed URIs make caching and invalidation trivial.
- The `hostContext` idea (device class, size, theme, safe area) is the right abstraction; our widgets re-lay out on context change.

**What did not**
- No canonical MIME type, `ui/*` method set or capability key (B1), and the tool-to-widget link and CSP shape are shown in more than one way (B2).
- The four patterns have no stepper (B3), long cards have no paged mode (B4), `hostContext` has no fit hint (B5), index and step semantics are unspecified (B6), sandboxed widgets cannot open links (B7).

**Suggestion:** publish one JSON Schema file for the bridge (messages, `hostContext`, the capability key, the MIME type) and one complete worked example, including the CSP object and a `ui/open-link` action.

---

## Alexa+ add-on documentation and tooling

**Used for:** the account-linking checklist, the 500 ms tool budget, MCP Apps patterns, checkout, the add-on manifest, the policy constraints.

**What worked**
- The constraints are specific and testable: 401 shape, PKCE S256 only, no DCR, four patterns, carousel size, latency budget. Each became a conformance check in [`scripts/conformance.ts`](../scripts/conformance.ts). This is the best property of the docs.
- The policy rules (no children, no health data, customer always knows the commitment) were clear enough to encode in the data model and the checkout contract.

**What did not**
- Every tool for testing is partner-gated (A1) and key behaviours are unobservable: tap handling (A2), account-linking client id and redirects (A4, A5), `resource` handling (A8), how the metadata URL is found without `WWW-Authenticate` (A6).
- First-party checkout cannot be demoed (A10).
- The manifest schema and the example `addon.json` in the docs were enough to write [`docs/addon.json`](addon.json), but nothing lets an entrant validate a manifest.

**Suggestion:** a public Local Inspector, or failing that a manifest validator and a reference trace of one full turn.

---

## Ollama (local model)

**Used for:** a third orchestrator provider, so the demo can pick tools with a real model without cloud credentials (DECISIONS #16, #17).

**What worked** (measured on an RTX A2000 Laptop, 4 GB VRAM)
- `qwen3:4b-instruct-2507-q4_K_M` with 12 tool schemas answers an orchestrator step in about 1.9 s warm (8.4 s cold), using 3.0 of 4.2 GB, and chose `triage_issue` first. It completed a real weekend-plan -> reorder -> explicit yes -> order flow.
- Ollama's tool-calling format mapped cleanly from MCP tool definitions ([`packages/host-sim-core/src/ollama.ts`](../packages/host-sim-core/src/ollama.ts)).
- Probing `/api/tags` to detect availability gave a simple, honest fallback to the rules orchestrator.

**What did not**
- The plain `qwen3:4b` tag resolved to a thinking variant and `think: false` did not stop it; a 128k default context did not load in 4 GB (E1).
- A small model loses ids when text is voice-safe (E2) and paraphrases away required disclosures (E3).

**Suggestion:** document that tags move, and make `think: false` either work or fail loudly for thinking-only models.

---

## Web Speech API

**Used for:** push-to-talk speech input in the host ([`apps/host-sim/src/lib/speech.ts`](../apps/host-sim/src/lib/speech.ts)) and the browser speech synthesis fallback for output.

**What worked:** zero-setup recognition in Chrome and Edge, with the same utterance path as typed text, so voice and keyboard converge.

**What did not:** it is not available in Firefox, recognition quality and behaviour vary by browser, and the automated replays use typed turns, so the recognition path is not covered by the automated runs.

**Suggestion:** none for the platform; our host degrades to typing when recognition is unavailable.

---

## Amazon Bedrock Converse API

**Used for:** the primary orchestrator (default model id `us.anthropic.claude-sonnet-4-5-20250929-v1:0`), with tool definitions derived live from `tools/list` ([`apps/host-sim/src/server/orchestrate.ts`](../apps/host-sim/src/server/orchestrate.ts)).

**What worked (from the types and documentation):** a single `ToolConfiguration` and `toolUse`/`toolResult` content blocks map directly onto MCP tools and results, so there is no per-model prompt format to maintain. The AWS SDK default credential chain is enough to switch providers.

**What did not:** we could not run it. Treat this path as written to the documentation and unverified. Our deterministic guardrails sit after the model, so a wrong model decision cannot skip a hard stop or complete an order.

**Suggestion:** a documented minimal local mock of the Converse tool-use loop would let teams test the shape without credentials.

---

## Amazon Bedrock Guardrails

**Used for:** a probabilistic second safety layer: denied topics (gas line work, panel work, structural repair, sewage, content about children), content filters, sensitive-information filters ([`packages/playbooks/safety/bedrock-guardrail.json`](../packages/playbooks/safety/bedrock-guardrail.json), created in [`infra/cdk/lib/guardrail.ts`](../infra/cdk/lib/guardrail.ts)).

**What worked:** the topic-policy model is a good fit for "never give steps for X", and `ApplyGuardrail` can be used independently of a model call.

**What did not:** the CloudFormation shape differs from the console and API JSON (D6); definitions are capped at 200 characters and examples at 100. We have not attached the guardrail to the host's Converse call and have not run it, so we make no claim about how well it blocks. A guardrail is a classifier and we rely on it for nothing: the deterministic rules decide hard stops.

**Suggestion:** a dry-run mode that tells you which topic would match a prompt, for unit-testing a policy without a model.

---

## Amazon Bedrock AgentCore (Runtime and Memory)

**Used for:** an optional CDK variant hosting the MCP server on AgentCore Runtime, plus an AgentCore Memory store for soft, conversation-derived recall ([`infra/cdk/lib/agentcore-stack.ts`](../infra/cdk/lib/agentcore-stack.ts), [`infra/cdk/AGENTCORE.md`](../infra/cdk/AGENTCORE.md)).

**What worked:** the MCP protocol contract is clear (port 8000, `/mcp`, ARM64, stateless or stateful), `aws-cdk-lib` ships both L1 and L2 constructs, and the stack synthesizes and unit tests.

**What did not:** the platform answers an unauthenticated request itself with a `WWW-Authenticate` header (D1), JWT mode needs OIDC discovery and a resource URL we cannot form (D2), the CLI is Python-only and env vars cannot reference secrets (D3), and `CreateAgentRuntime` has no CLI example (D4). For these reasons Hearth's primary deployment design is Fargate, and AgentCore is synthesize-only. AgentCore Memory is provisioned but the server does not call it.

**Suggestion:** a passthrough auth mode and RFC 8414 discovery support would make AgentCore a natural host for any Alexa+ add-on.

---

## Amazon DynamoDB

**Used for:** the Home Graph, as a single table with PK/SK and one GSI ([`packages/home-graph/src/dynamo-repo.ts`](../packages/home-graph/src/dynamo-repo.ts)); a CDK table with on-demand billing and point-in-time recovery.

**What worked:** single-table design suits the access patterns (everything for a home under one partition key; `begins_with` on SK for each entity; GSI1 for per-asset history). The same `HomeRepository` interface is satisfied by a JSON-file implementation, which made local development and the conformance run credential-free.

**What did not:** nothing failed, but nothing ran on AWS either. The repository is tested against an in-memory fake that models the exact expressions we use, so correctness of the real service interaction is unverified.

**Suggestion:** an official local fake for the Document Client that runs in-process (DynamoDB Local needs Java and a process).

---

## Stripe (test mode)

**Used for:** an unconfirmed PaymentIntent at session creation and confirmation at completion, with the test card `pm_card_visa` ([`apps/mcp-server/src/services/payments.ts`](../apps/mcp-server/src/services/payments.ts)). Only `sk_test_` and `rk_test_` keys are accepted; live keys are refused.

**What worked:** the create-then-confirm split maps exactly onto "never charge until the customer says yes".

**What did not:** not run, because no key existed. The default is a labelled `pi_sim_*` simulation, and every confirmation says so.

**Suggestion:** none specific. For hackathons, a documented way to run a keyless Stripe mock in CI would help.

---

## Resend

**Used for:** the order confirmation email, with a local `.eml` outbox fallback ([`apps/mcp-server/src/services/email.ts`](../apps/mcp-server/src/services/email.ts)).

**What worked (design level):** the outbox fallback makes email verifiable without a provider; any non-empty key is treated as real, which is why the CDK leaves it off by default.

**What did not:** not run. Also the account's access token carries no email address, so a recipient must be configured (`HEARTH_EMAIL_TO`). The production plan named SES; we have the IAM and identity in CDK but no SES adapter.

**Suggestion:** none for Resend. For Alexa+: say whether an add-on can read the customer's email address after account linking.

---

## Amazon Polly

**Used for:** neural voice output ("Ruth") from a server route, falling back to browser speech synthesis ([`apps/host-sim/src/app/api/tts/route.ts`](../apps/host-sim/src/app/api/tts/route.ts)).

**What worked (design level):** one call returns MP3 that the page can play and cancel, which supports barge-in.

**What did not:** not run, no credentials. Polly has no resource-level IAM permissions, so the policy statement is on `*` (noted in the CDK README).

**Suggestion:** none.
