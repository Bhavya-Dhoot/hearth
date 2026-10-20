# Friction log

A dated, structured log of friction met while building Hearth against the Alexa+ add-on model, MCP Apps, the MCP TypeScript SDK and AWS services. Each entry follows **Context -> Expected -> Actual -> Impact -> Suggestion**.

How to read it:

- Date is the day the friction was logged. Everything here was found during the build on 2026-10-21 unless a different date is given. Source: raw friction notes collected from every build lane during the build.
- "Verified" means we hit it in code or in a test. "Inferred" means we could not observe the other side (Alexa+ itself is not available to entrants), so the entry records what the documentation left open, not what Alexa+ does.
- Each entry links to the file where the workaround lives, so a reader can judge the cost of the friction in lines of code.
- Where we could not check a claim against a live service (no AWS credentials existed on the build machine) the entry says so.

Index by group: [A. Alexa+ add-on docs and tooling](#a-alexa-add-on-docs-and-tooling) (A1 to A11), [B. MCP Apps](#b-mcp-apps-visual-contract) (B1 to B7), [C. MCP TypeScript SDK](#c-mcp-typescript-sdk-1321) (C1 to C5), [D. AWS](#d-aws-agentcore-app-runner-guardrails) (D1 to D6), [E. Local model](#e-local-model-ollama-on-a-4-gb-gpu) (E1 to E3), [F. Process notes](#f-our-own-process-notes-not-amazon).

Highest-impact items for the Alexa+ team, in order: A1 (no public inspector), A6 (401 without `WWW-Authenticate`), A10 (first-party checkout cannot be demoed), B1 (no canonical MCP Apps MIME type and method set), C1 (SDK rejects error results), D1 (AgentCore auth cannot express the Alexa+ rule).

---

## A. Alexa+ add-on docs and tooling

### A1. All Alexa+ developer tooling is partner-gated - 2026-10-21 (verified)
- **Context:** Planning how to test an MCP add-on. The add-on tooling named in the docs is the MCP Toolkit, the `alexa-ai` CLI, the Web Simulator, the Local Inspector, the Category SDK and Amazon Wallet.
- **Expected:** At least a local inspector that an entrant could run to see what Alexa+ sends to an MCP server.
- **Actual:** All of it is partner-only and the hackathon states that no entrant has device or console access. There is no application path. The sanctioned route is a web page acting as an MCP client.
- **Impact:** We built our own host (`packages/host-sim-core`, `apps/host-sim`): client, bridge, `hostContext`, device frames, inspector, replays. A whole lane of work went into inferring what the real host does, and every inference is unverifiable. Anything we got wrong would only surface after a partner integration.
- **Suggestion:** Publish a Local Inspector, even a minimal one, or a `hostContext` fixture pack (one JSON per device class) plus a reference trace of a full turn. Entrants then build against the real shape instead of each inventing one. We open-source our simulator as `packages/host-sim-core` for that reason.

### A2. No reference trace of a tap-driven turn - 2026-10-21 (verified, convention is ours)
- **Context:** Widgets must turn a screen tap into something the assistant can act on, so that voice and touch converge.
- **Expected:** A documented message that carries a tap into the conversation, and a stated limit on tool calls per turn.
- **Actual:** Neither is documented where we could find it. Our host feeds a tap as a user turn of the form `[tap] name {json}` and caps a turn at 4 tool calls. Both are our conventions ([`packages/host-sim-core/src/utterance.ts`](../packages/host-sim-core/src/utterance.ts), `DEFAULT_MAX_TOOL_CALLS` in [`orchestrator.ts`](../packages/host-sim-core/src/orchestrator.ts)).
- **Impact:** A widget that works in our host may behave differently on a real device; we cannot tell.
- **Suggestion:** Publish one annotated trace of a tap-driven turn (widget action, what the model sees, the resulting tool call) and state the per-turn tool-call cap if there is one.

### A3. Account linking happens in the phone app, a simulator must invent the equivalent - 2026-10-21 (inferred)
- **Context:** On a real Echo the customer links an add-on in the Alexa phone app. A browser host has no such app.
- **Expected:** Guidance for simulators.
- **Actual:** None. We invented an on-glass "Link Hearth account" screen and run the real PKCE redirect in the browser ([`apps/host-sim/src/lib/auth.ts`](../apps/host-sim/src/lib/auth.ts)).
- **Impact:** The linking UX in our demo is not what a customer sees. The OAuth mechanics are real; the surrounding chrome is a guess.
- **Suggestion:** Document the intended simulator step, or the exact sequence the Alexa app performs (which URLs it opens, in what order).

### A4. No documented client id or redirect URIs for Alexa+ account linking - 2026-10-21 (verified)
- **Context:** Our authorization server keeps a client registry because DCR is not allowed.
- **Expected:** A published `client_id` and per-region redirect URIs to register.
- **Actual:** Not found. The registry holds a local stand-in, `alexa-plus-host-sim`, with a redirect on `localhost:3000` ([`apps/auth-server/src/clients.ts`](../apps/auth-server/src/clients.ts)).
- **Impact:** Before a real launch someone must replace the stand-in with values we do not know. Unknown and unregistered redirect URIs are rejected by design, so a wrong guess would fail closed.
- **Suggestion:** Publish the redirect URIs per marketplace region and the client id (or the rule for deriving it) next to the account-linking checklist.

### A5. The PKCE checklist is spread over a checklist plus RFCs, with no worked transcript - 2026-10-21 (verified)
- **Context:** Implementing the authorization endpoint to the Alexa+ checklist.
- **Expected:** One transcript showing the request Alexa sends.
- **Actual:** Open points we had to decide ourselves: which `scope` string Alexa sends, whether it sends a `resource` parameter, whether an invalid request should redirect with an error or show an error page.
- **Impact:** We chose: unknown client or unregistered redirect gets an error page and is never redirected to; other request errors go back to the registered redirect as RFC 6749 errors ([`apps/auth-server/README.md`](../apps/auth-server/README.md)). A real client could disagree.
- **Suggestion:** Add a worked authorization-code transcript (request, redirect, token exchange) with the real parameters, and say which failures redirect.

### A6. 401 without `WWW-Authenticate` breaks generic MCP clients - 2026-10-21 (verified)
- **Context:** The add-on checklist says an unauthenticated request must return 401 and must not include a `WWW-Authenticate` header. Our MCP server does exactly that ([`apps/mcp-server/src/auth/middleware.ts`](../apps/mcp-server/src/auth/middleware.ts)), and puts `resource_metadata` in the JSON body.
- **Expected:** Standard MCP clients keep working against a conformant add-on.
- **Actual:** The MCP authorization flow discovers the authorization server from the `WWW-Authenticate` header. `mcp-remote` and Claude Desktop therefore cannot start the OAuth dance against a conformant Alexa+ server. It is not documented how Alexa+ itself finds the protected-resource metadata URL without the header.
- **Impact:** To meet the "another assistant calls the same server" bonus we added a development-token path: `pnpm --silent --filter @hearth/auth-server mint-dev-token`, then `mcp-remote` with a static `Authorization` header ([`docs/claude_desktop_config.json`](claude_desktop_config.json)). A real Claude Desktop user cannot link an account.
- **Suggestion:** Explain in the docs how Alexa+ discovers the metadata URL, and whether it is acceptable to serve the header on non-Alexa user agents or paths. A client sample showing the discovery would close this.

### A7. RFC 9728 discovery paths differ between the checklist and clients - 2026-10-21 (verified)
- **Context:** Serving protected-resource metadata.
- **Expected:** One documented URL.
- **Actual:** The checklist names the root `/.well-known/oauth-protected-resource`. RFC 9728 clients probe the path-suffixed form `/.well-known/oauth-protected-resource/mcp` first.
- **Impact:** We serve both from one handler ([`apps/mcp-server/src/http/public.ts`](../apps/mcp-server/src/http/public.ts)). Cheap, but a server author who follows only the checklist breaks standard clients.
- **Suggestion:** Name both paths in the checklist.

### A8. RFC 8707 `resource`: sent by Alexa+, and must `aud` equal it? - 2026-10-21 (open question)
- **Context:** Token audience binding.
- **Expected:** A statement of whether Alexa+ sends `resource` and how `aud` is checked.
- **Actual:** Unstated. We bind `aud` to the MCP resource URL and check `iss`, `aud` and `exp` on every request, and we accept an optional `resource` on `/authorize`.
- **Impact:** If Alexa+ sends a different resource string than our metadata publishes, every call fails with 401.
- **Suggestion:** State the rule.

### A9. Session continuity is inferred from prior conversations, with no explicit id - 2026-10-21 (inferred)
- **Context:** The docs say continuity is inferred from the customer's earlier conversations. Hearth keys everything on the token `sub`.
- **Expected:** A way to disambiguate when one account has more than one home.
- **Actual:** There is none. A user with a primary home and a rental cannot say which one a request means, except in words.
- **Impact:** Hearth supports one home per user ([`HomeRepository.getHomeForUser`](../packages/contracts/src/db.ts)). Multi-home users are out of scope for this build.
- **Suggestion:** An optional `homeId` hint in `_meta` that the add-on can publish a list of choices for, or an elicitation pattern for ambiguity.

### A10. First-party checkout cannot be demoed: `network_token` needs Amazon Pay onboarding - 2026-10-21 (verified)
- **Context:** Alexa+ checkout offers Amazon Wallet through a `network_token` payment method.
- **Expected:** A sandbox path for hackathon entrants.
- **Actual:** It requires Amazon Pay merchant onboarding, which entrants do not have.
- **Impact:** We implemented `stored_payment_method` only, showing a display string ("Visa ending 4242"), with Stripe test mode behind it when a key exists and a labelled simulation otherwise ([`docs/CHECKOUT.md`](CHECKOUT.md)). The most Amazon-native part of checkout, the one judges would most want to see, is the part we cannot show.
- **Suggestion:** A sandbox merchant id and test Wallet tokens for entrants.

### A11. The 500 ms tool budget versus LLM-in-tool patterns - 2026-10-21 (verified by measurement)
- **Context:** Alexa+ asks for tool round trips under 500 ms. Many MCP examples call a model inside the tool.
- **Expected:** Guidance on where reasoning should live.
- **Actual:** Not stated. We documented our rule: reasoning in the orchestrator, tools deterministic (lookups, rule engines, template fills). Result: 33 of 33 conformance checks, worst tool p95 53.2 ms, read tools under 10 ms ([`apps/mcp-server/reports/latency.md`](../apps/mcp-server/reports/latency.md)). These are localhost numbers; nothing is deployed.
- **Impact:** The design is constrained by the budget, in a good way, but a developer who puts a model call in a tool will miss it without being told why.
- **Suggestion:** Say in the docs that the budget implies deterministic tools, and add an async pattern (a tool that returns a job id plus a follow-up) for the cases that genuinely need a model.

---

## B. MCP Apps (visual contract)

### B1. No canonical MIME type, method set or capability key for widget resources - 2026-10-21 (verified)
- **Context:** Serving widget HTML as `ui://` resources.
- **Expected:** One published schema.
- **Actual:** No canonical MIME type for the widget HTML, no canonical `ui/*` method set, and no `clientCapabilities` key to negotiate with. We emit `text/html+mcpapp` plus `_meta.mcpApp` ([`MCP_APP_MIME`](../packages/contracts/src/common.ts)) and define the bridge messages ourselves (`ui/ready`, `ui/hostContext`, `ui/render`, `ui/resize`, `ui/action`, `ui/voice-intent`, [`packages/contracts/src/bridge.ts`](../packages/contracts/src/bridge.ts)).
- **Impact:** A widget built for one host's choices is not portable. Our contract could be wrong in every field.
- **Suggestion:** Publish one schema: MIME type, message names and payloads, and the capability key a client advertises.

### B2. The tool-to-widget link and CSP shape are documented inconsistently - 2026-10-21 (verified)
- **Context:** Linking a tool result to its widget and declaring network domains.
- **Expected:** One key path.
- **Actual:** Different sources show `_meta.ui.resourceUri` and the older `ui/resourceUri`, and the CSP under `_meta.mcpApp` or `_meta.ui`. We emit all of them ([`apps/mcp-server/src/mcp/tools.ts`](../apps/mcp-server/src/mcp/tools.ts), [`widgets.ts`](../apps/mcp-server/src/mcp/widgets.ts)).
- **Impact:** Redundant metadata on every visual result, and uncertainty about which one a real host reads.
- **Suggestion:** Pick one, deprecate the other, and show the CSP object in a complete example.

### B3. The four-pattern limit has no stepper - 2026-10-21 (verified)
- **Context:** Repair is a sequence of steps. The allowed patterns are List, Carousel, Card and Map.
- **Expected:** A way to express "step 2 of 6, next".
- **Actual:** No Stepper pattern. We composed the Step Card as a Card whose primary action is `next_step` and which re-renders per step ([`packages/widgets/src/widgets/step-card.ts`](../packages/widgets/src/widgets/step-card.ts)).
- **Impact:** Every step is a new tool call and a new render instead of one stateful widget, which costs a round trip per step (about 6.5 ms p50 here, but it would be a real network hop on a device).
- **Suggestion:** A Stepper pattern, or guidance on stateful Cards.

### B4. Document-like cards exceed the Echo Show 8 height - 2026-10-21 (verified)
- **Context:** The pro brief (1048 px tall) and the home card (922 px) read like documents.
- **Expected:** A paged or preferred-height mode.
- **Actual:** None, so our host scales the card down to fit the screen.
- **Impact:** A trade-off between a complete brief and 10-foot legibility: scaling shrinks the text. We kept the complete brief.
- **Suggestion:** A preferred-height hint from the widget, or a paged mode for long cards.

### B5. `hostContext` has no fit hint - 2026-10-21 (verified)
- **Context:** A fullscreen widget wants a minimum height; a tile does not.
- **Expected:** The host says which it wants.
- **Actual:** We infer it from `displayMode`.
- **Impact:** Fragile inference.
- **Suggestion:** Add `fit: "fill" | "content"` to `hostContext`.

### B6. Voice intent indexing and `next_step` semantics are unspecified - 2026-10-21 (verified)
- **Context:** Mirroring "the second one" and "next" on screen.
- **Expected:** A stated base for indices and a clear meaning for `stepIndex`.
- **Actual:** We chose zero-based indices. A `next_step` action's `stepIndex` is ambiguous: current step or target step.
- **Impact:** An off-by-one waiting to happen when a widget and a host disagree.
- **Suggestion:** Document the base, and name the field `fromStepIndex` (or `toStepIndex`).

### B7. A sandboxed widget has an opaque origin and cannot open links - 2026-10-21 (verified)
- **Context:** `sandbox="allow-scripts"` iframes (as the add-on spec requires).
- **Expected:** A documented way to trust messages and to open a URL.
- **Actual:** The origin is opaque, so `postMessage` needs `targetOrigin: "*"` and `event.origin` is `"null"`; the only trust check is the source window's identity ([`packages/host-sim-core/src/bridge.ts`](../packages/host-sim-core/src/bridge.ts)). A widget cannot open a link, so the receipt URL is shown as text.
- **Impact:** Weaker message authenticity than a normal web app, and a dead end for receipts on glass.
- **Suggestion:** A documented handshake token, and a `ui/open-link` action that the host may honour or refuse.

---

## C. MCP TypeScript SDK 1.32.1

### C1. `Client.callTool` throws on error results that do not match `outputSchema` - 2026-10-21 (verified)
- **Context:** Tools declare an `outputSchema`; tools also return `isError: true` results with a different shape.
- **Expected:** An error result is exempt from the success schema.
- **Actual:** The client validated `structuredContent` against `outputSchema` even when `isError` was true, so every error envelope surfaced as a `-32602` throw in the host.
- **Impact:** Voice-safe error handling (a core requirement) broke until we advertised `outputSchema` as `anyOf [output, error]` ([`apps/mcp-server/src/mcp/tools.ts`](../apps/mcp-server/src/mcp/tools.ts)). Every tool's advertised schema is now looser than it needs to be.
- **Suggestion:** Skip output validation when `isError` is true.

### C2. `McpServer.registerTool` freezes `_meta` and gives validation failures as bare text - 2026-10-21 (verified)
- **Context:** Widget URIs include a content hash that changes when a widget is rebuilt; input validation errors should be machine-readable.
- **Expected:** `_meta` computed lazily, and a hook for validation failures.
- **Actual:** `_meta` is fixed at registration; input validation failures return free text with no error code.
- **Impact:** We dropped to the low-level `setRequestHandler` API and implemented tool listing and calling ourselves ([`apps/mcp-server/src/mcp/server.ts`](../apps/mcp-server/src/mcp/server.ts)), giving up the high-level helper.
- **Suggestion:** Accept a function for `_meta`, and a validation-error hook (or structured codes).

### C3. `requireBearerAuth` always sets `WWW-Authenticate`, and its types fail under pnpm - 2026-10-21 (verified)
- **Context:** Bearer validation on `/mcp`.
- **Expected:** An option to omit the header (Alexa+ forbids it), and `req.auth` types that resolve.
- **Actual:** The middleware always sets the header, and its `req.auth` type augmentation did not resolve under pnpm's strict dependency resolution.
- **Impact:** We wrote our own middleware ([`apps/mcp-server/src/auth/middleware.ts`](../apps/mcp-server/src/auth/middleware.ts)). Also a reason A6 exists.
- **Suggestion:** A `omitWwwAuthenticate` option, and export the augmentation in a way that survives strict resolution.

### C4. `StreamableHTTPClientTransport` has static headers and assumes an OAuth provider on 401 - 2026-10-21 (verified)
- **Context:** A browser client whose token can be refreshed.
- **Expected:** A per-request token callback.
- **Actual:** `requestInit` headers are static, and 401 handling assumes an OAuth client provider.
- **Impact:** We inject the bearer with a fetch wrapper, which also lets the inspector record raw traffic ([`packages/host-sim-core/src/client.ts`](../packages/host-sim-core/src/client.ts)).
- **Suggestion:** Accept `getToken(): Promise<string>`.

### C5. The default JSON Schema validator is not CSP-safe in the browser - 2026-10-21 (verified)
- **Context:** Running the SDK client inside a browser page with a Content Security Policy.
- **Expected:** A validator that works without `eval`.
- **Actual:** The default is Ajv, which generates code with `new Function`. The Cloudflare-worker alternative is an optional peer dependency.
- **Impact:** We pass a passthrough validator ([`packages/host-sim-core/src/client.ts`](../packages/host-sim-core/src/client.ts)); the host does not validate tool output on the client side, and the server and the conformance script do.
- **Suggestion:** Ship the CSP-safe validator in the box, or make it the browser default.

---

## D. AWS (AgentCore, App Runner, Guardrails)

None of the entries below was tested against a live AWS account: no credentials existed on the build machine. They record what the documentation and the CDK types said when we wrote the stacks (read 2026-10-21; see the sources in [`infra/cdk/AGENTCORE.md`](../infra/cdk/AGENTCORE.md)). "Verified" below means read in the documentation or hit at synth time.

### D1. AgentCore Runtime answers 401 itself, with `WWW-Authenticate` - 2026-10-21 (verified from documentation)
- **Context:** Hosting the MCP server on AgentCore Runtime (AWS Builder mini).
- **Expected:** Pass the auth decision through to the container, since Alexa+ requires 401 with no `WWW-Authenticate`.
- **Actual:** A missing bearer token is answered by the platform before the container, with a `WWW-Authenticate: Bearer resource_metadata=...` header. SigV4 runtimes answer 403 instead. The container cannot change either.
- **Impact:** AgentCore cannot be the primary host for an Alexa+-conformant add-on, so Fargate with an ALB and CloudFront is the primary design and AgentCore is a synthesize-only variant.
- **Suggestion:** A passthrough auth mode that forwards the `Authorization` header and leaves the response to the container.

### D2. JWT mode requires an OIDC discovery URL, and the resource URL cannot be `base + /mcp` - 2026-10-21 (verified from documentation)
- **Context:** Pointing the AgentCore JWT authorizer at our authorization server.
- **Expected:** RFC 8414 metadata (`/.well-known/oauth-authorization-server`), which is what Alexa+ wants and what we publish.
- **Actual:** `discoveryUrl` must match `.well-known/openid-configuration`. We deliberately have no OIDC. Separately, the invocation URL ends in `/invocations?qualifier=DEFAULT`, so the audience cannot be the `base + /mcp` form our server checks.
- **Impact:** Using JWT mode would need an OIDC alias on the auth server and a different `HEARTH_MCP_BASE`. We documented rather than built it.
- **Suggestion:** Accept RFC 8414 metadata, and allow a custom path for the MCP resource.

### D3. The AgentCore CLI scaffolds Python only, the container must be ARM64 and env vars cannot reference Secrets Manager - 2026-10-21 (verified from documentation)
- **Context:** Deploying a Node and pnpm monorepo.
- **Expected:** A route for TypeScript.
- **Actual:** The CLI is documented for Python projects and packages source into S3. A container artifact must be ARM64 (QEMU emulation on x86 CI). Runtime environment variables are plain strings and cannot reference Secrets Manager.
- **Impact:** The stack uses a container artifact built with `platform: linux/arm64` ([`infra/cdk/lib/agentcore-stack.ts`](../infra/cdk/lib/agentcore-stack.ts)), and Stripe and Resend keys are not injected: that variant would run on the simulated payment gateway and the local outbox.
- **Suggestion:** A TypeScript template, a documented secret-reference mechanism, and multi-arch support.

### D4. `CreateAgentRuntime` has only a REST-shaped reference, and CDK L1 types `serverProtocol` as a string - 2026-10-21 (verified)
- **Context:** Writing the runtime by hand and in CDK.
- **Expected:** A CLI example, and an enum.
- **Actual:** No CLI shorthand example for the artifact, protocol or authorizer fields; the CDK L1 property is a plain string, so `"MCP"` gets no compile-time check.
- **Impact:** The manual steps in `AGENTCORE.md` are marked as not run for exactly this reason.
- **Suggestion:** A CLI example per field group, and enum typing in the L1.

### D5. App Runner: a CloudFormation cycle and no session affinity - 2026-10-21 (verified at design time)
- **Context:** Hosting three services that need each other's public URL (the MCP server needs the auth issuer, the auth server needs the MCP base for token audience and the host base for redirects).
- **Expected:** One-deploy stack.
- **Actual:** App Runner creates its `*.awsapprunner.com` URL only after the service exists, so each URL is an attribute of the resource that needs the other: a cycle. There is also no sticky routing, and the MCP server keeps `Mcp-Session-Id` sessions in memory.
- **Impact:** We moved to Fargate behind an ALB and CloudFront, which costs a fixed ALB (about $16 a month, an estimate from list prices) and an extra hop ([`infra/cdk/README.md`](../infra/cdk/README.md)).
- **Suggestion:** Allow a service URL to be known before first deploy, or offer affinity.

### D6. Bedrock Guardrails: the CloudFormation shape differs from the console and API JSON - 2026-10-21 (verified at synth)
- **Context:** Exporting a guardrail policy from the console shape into CDK.
- **Expected:** One shape.
- **Actual:** CloudFormation wants per-topic `Type: DENY` and a separate immutable `GuardrailVersion` resource. The API limits topic definitions to 200 characters and examples to 100.
- **Impact:** A translation layer and hash-named versions in [`infra/cdk/lib/guardrail.ts`](../infra/cdk/lib/guardrail.ts). Separately, we have defined the guardrail but not attached it to the host's Converse call (see the README); the integration was left because it cannot be tested without credentials.
- **Suggestion:** Document the CloudFormation shape beside the API shape, with an example of a denied topic.

---

## E. Local model (Ollama on a 4 GB GPU)

Hardware: RTX A2000 Laptop GPU, 4 GB VRAM. These were measured on the build machine (see [`DECISIONS.md`](DECISIONS.md) #16 and #17).

### E1. The `qwen3:4b` tag now resolves to a thinking variant, and a 128k context does not load - 2026-10-21 (verified)
- **Context:** Choosing a local orchestrator model that fits in 4 GB and answers at voice speed.
- **Expected:** A small instruct model.
- **Actual:** The plain tag resolves to the Thinking-2507 variant, and `think: false` does not stop it from thinking. The default 128k KV cache would not load in 4 GB within 2 minutes.
- **Impact:** Fixed with `qwen3:4b-instruct-2507` at `num_ctx` 8192: about 1.9 s per step warm (8.4 s cold), 3.0 of 4.2 GB resident, picks `triage_issue` first with 12 tool schemas (2,386 prompt tokens) in the prompt. The MoE `qwen3:30b-a3b` was not adopted: it needs about 18 GB of RAM and the machine had about 2.5 GB free.
- **Suggestion:** For Ollama users: pin a dated tag in docs and examples, and let `think: false` actually disable thinking for thinking-only variants, or say that it cannot.

### E2. Voice-safe text starves a small model of the ids it must pass back - 2026-10-21 (verified)
- **Context:** Tool results contain voice text without SKUs by design (SKUs never reach speech).
- **Expected:** The model can still order an item.
- **Actual:** A small model had no SKU to pass to `create_checkout_session`.
- **Impact:** Model-facing tool messages now append a compact structured data block ([`packages/host-sim-core/src/ollama.ts`](../packages/host-sim-core/src/ollama.ts)). A larger model reading `structuredContent` would not need this.
- **Suggestion:** For MCP host authors: decide explicitly which fields of `structuredContent` the model sees, instead of only the `content` text.

### E3. A small model paraphrases away the payment-mode disclosure - 2026-10-21 (verified)
- **Context:** After an order the customer must hear whether a payment was simulated, test, or real.
- **Expected:** The model repeats the summary.
- **Actual:** The disclosure was dropped in paraphrase.
- **Impact:** A deterministic guard appends it whenever it is missing (`guardrails()` in [`apps/host-sim/src/server/orchestrate.ts`](../apps/host-sim/src/server/orchestrate.ts)). General lesson: anything the customer must be told is enforced in code, not in the prompt.
- **Suggestion:** None for Amazon; recorded as an engineering finding.

---

## F. Our own process notes (not Amazon)

- **Frozen contracts let lanes run in parallel.** Seed photo annotation coordinates fixed in a contract meant illustration and annotation were built at the same time.
- **Contracts still had gaps, found by building against them.** `HomeRepository` lacked `getOrder` (receipts use an index workaround), `StepContext` lacked `now`, and routes needed `question:<id>` chaining. Each was fixed centrally and logged in [`DECISIONS.md`](DECISIONS.md) rather than patched locally.
- **Docs drift from code.** Two examples we found while writing the submission: the CDK README says the auth server does not yet read `HEARTH_AUTH_PRIVATE_JWK` (it now does, [`apps/auth-server/src/keys.ts`](../apps/auth-server/src/keys.ts)), and SAFETY.md says the Bedrock guardrail is attached to the orchestrator's Converse calls while the code does not pass a `guardrailConfig`. The README states the code's behaviour.
