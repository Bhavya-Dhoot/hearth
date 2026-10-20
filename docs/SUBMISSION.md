# Hearth: Devpost text description

**Track:** Alexa+. **Mini-challenges:** Open Source, AWS Builder. **License:** Apache-2.0. **Demo video:** to be linked after upload (plan in [DEMO_SCRIPT.md](DEMO_SCRIPT.md)).

**Tagline:** Your house has a memory now.

**What it is:** Hearth is an Alexa+ add-on, built as a self-hosted MCP server, that remembers your house: every appliance, filter size, shut-off valve and past repair. When something breaks it walks you through the first 15 minutes hands-free on an Echo Show, orders the exact-fit part, or hands a pro a complete job brief.

**Positioning:** Hearth feeds Alexa's Home Services partners with qualified, fully-briefed jobs; it does not replace them.

## What is real, and what is simulated

Real Alexa+ device and console access is not available to entrants, so we followed the sanctioned path: a web page acting as a genuine MCP client. The "Simulated Alexa+ host" sends real `initialize`, `tools/list`, `resources/read` and `tools/call` requests over Streamable HTTP, and its inspector shows the actual JSON-RPC and latencies. It is labelled as a simulation wherever it appears. Not deployed to AWS (no credentials on the build machine), no real Echo, payments simulated or Stripe test mode, recall data a labelled sample, label-photo values fixtures. The full list is in the README.

## Technical implementation

- **MCP server:** TypeScript, `@modelcontextprotocol/sdk` 1.32.1, protocol 2025-11-25, Streamable HTTP with stateful sessions. Twelve tools, each with a title, an LLM-oriented description, zod input and output schemas generated into the MCP schemas, and annotations. Eight widgets are served as content-hashed `ui://` resources.
- **Verified:** 33 of 33 conformance checks pass against a live stack. Latency over 50 timed calls per tool: worst p95 53.2 ms, read tools under 10 ms, against the 500 ms Alexa+ budget (localhost, nothing deployed). Replays of all five journeys J1 to J5 pass headless against the live servers, and J1 and J3 pass in the browser host. 905 unit tests pass across ten packages.
- **Deterministic tools:** no LLM runs inside a tool. Triage is a rule engine over 12 authored playbooks; part matching uses asset attributes; reasoning lives in the orchestrator. That is how the latency budget is met.
- **Auth built to the Alexa+ checklist:** OAuth 2.1 Authorization Code with PKCE (S256), RFC 9728 protected-resource metadata, RFC 8414 server metadata, RS256 tokens, rotating refresh tokens, no dynamic client registration, and a 401 with no `WWW-Authenticate` header.
- **Checkout:** UCP-shaped REST plus two tools over one service. `create_checkout_session` never charges. `complete_checkout` needs an explicit confirmation and the customer's own words. Writes are idempotent. Payment mode is always disclosed.
- **Orchestrator modes:** Amazon Bedrock Converse (coded, untested without credentials), a local Ollama model (Qwen3 4B instruct on a 4 GB laptop GPU, about 1.9 s per step warm, completed a real reorder flow), and a deterministic rules orchestrator. Deterministic guards wrap every mode.
- **Another assistant calls it:** Claude Desktop reaches the same server through `mcp-remote` with a development token (verified at protocol level: initialize, 12 tools, a real tool call).
- **AWS Builder:** a CDK app (Fargate, ALB, CloudFront, DynamoDB, Secrets Manager, SES identity, Bedrock guardrail) that synthesizes and has 18 passing tests, plus an optional AgentCore Runtime and Memory stack. Neither is deployed. AgentCore cannot satisfy the Alexa+ 401 rule (documented).
- **Open Source:** `packages/host-sim-core` (MCP host client, widget bridge, orchestrators, replays) is a standalone Apache-2.0 package for anyone who needs a host simulator, since the official inspector is partner-gated. It is a workspace package and has not been published to npm.

## Design

The interaction model suits a kitchen screen and wet hands: voice and touch converge on one path (a tap becomes a `[tap] next_step` turn), lists are numbered so "the second one" maps to the screen, and primary text is sized for ten feet. Widgets use exactly the Alexa+ patterns (Card, Carousel, List) and adapt to the host context: Echo Show 8, Echo Show 15, a phone in the light theme, and voice only.

The visual language, "Workshop Editorial", is a well-kept toolbox meets a field notebook: Fraunces display type, Instrument Sans body, JetBrains Mono labels, warm dark surfaces with brass, copper and verdigris used for meaning only. The signature move is a hand-drawn annotation stroke that circles the actual valve or part in your own photo. The pro brief is a kraft-paper work order with a QR code. Every colour comes from one tokens file, and a test fails if a widget hard-codes one. Honesty is part of the design: a "Simulated Alexa+ host" label sits under every frame. The seed photos are line illustrations, not photographs.

Safety is designed in, not added on: gas, electrical, structural, flooding, sewage and any child-involved repair end in a deterministic hard stop with a verbatim message and no steps, and the offer of a pro brief. A language model never decides or words a hard stop. A 24-prompt red-team list is enforced by tests.

## Potential impact

Angi's 2025 State of Home Spending reports $2,041 on maintenance plus $1,143 on emergency repairs per household each year (millennials: $2,601 and $1,519). Year-one homeowners are the sharpest case: they do not know where the shut-off is or which filter to buy, and they pay a pro for what a $4 washer fixes. We have not independently verified the Angi figures.

Hearth sits on three revenue paths that fit Amazon's existing business: parts and consumables through Alexa+ checkout, qualified and fully briefed leads to Home Services partners, and, later, home-inventory data for insurance and resale. The weekend plan makes it recurring rather than a one-time rescue. The scope is deliberately narrow and policy-safe: no smart-home control, no children's data, no health data, no financial-institution features, no document chat (Alexa+ does that natively).

Between this and a real launch: a partner integration to replace the simulated host, Amazon Pay onboarding for first-party checkout, a live recall feed, a real parts catalogue, and a cloud deployment. We claim none of them.

## Quality of the idea

Home-management apps fail because nobody fills in forms. Hearth removes the form: voice captures the data ("add my water heater", a label photo, "the main shut-off is in the garage"), and a kitchen screen returns it when it is worth something. The first 15 minutes of a home problem is a moment nobody owns, and a hands-free assistant is the right tool for it.

It uses the Alexa+ primitives the guidelines reward: an agentic multi-step workflow, state across sessions, purchasing with a read-aloud commitment, and MCP Apps visuals.

Because every Alexa+ developer tool is gated, we wrote down what we could not observe. Our [friction log](FRICTION_LOG.md) has 32 dated entries across the add-on docs, MCP Apps, the MCP TypeScript SDK, AWS and local models, each with a concrete suggestion, and [PRODUCT_FEEDBACK.md](PRODUCT_FEEDBACK.md) covers every tool and SDK we used. The three we would fix first: a public Local Inspector, a 401 discovery path that works for generic MCP clients, and an SDK client that accepts error results.

## Links

Repository: see the Devpost form. Read first: [README](../README.md), [ARCHITECTURE](ARCHITECTURE.md), [friction log](FRICTION_LOG.md), [product feedback](PRODUCT_FEEDBACK.md), [add-on manifest](addon.json).
