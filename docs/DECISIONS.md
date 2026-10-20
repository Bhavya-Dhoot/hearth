# Decisions (ADR-style, one line each)

| # | Date | Decision | Why |
|---|---|---|---|
| 1 | 2026-10-21 | MCP SDK `@modelcontextprotocol/sdk@1.32.1`, protocol `2025-11-25`, Streamable HTTP, stateful sessions. | Track requirement; SDK's LATEST_PROTOCOL_VERSION is 2025-11-25. |
| 2 | 2026-10-21 | Monorepo: pnpm workspaces + turborepo; TS source exports, `moduleResolution: Bundler`, servers run with `tsx`. | One build graph; no per-package emit step to drift. |
| 3 | 2026-10-21 | zod 4 for every contract; tool input/output schemas are the single source for MCP `inputSchema`/`outputSchema`. | No hand-copied JSON Schema. |
| 4 | 2026-10-21 | The MCP client runs in the browser host (host-sim-core); `/api/orchestrate` only decides the next step. | The inspector shows genuine JSON-RPC from the host, like an Alexa device. |
| 5 | 2026-10-21 | Orchestrator: Bedrock Converse when AWS credentials exist, deterministic rules orchestrator otherwise; the inspector labels which ran. | Build machine has no AWS credentials; demo must still be reproducible with real tool calls. |
| 6 | 2026-10-21 | Stripe test PaymentIntent when `STRIPE_SECRET_KEY` is set, otherwise `pi_sim_*` labelled `simulated`. | No keys on the build machine; never fake a "real" charge. |
| 7 | 2026-10-21 | Confirmation email via Resend when keyed, otherwise `.eml` in `.outbox/` served at `/outbox`. | Email is verifiable locally without a provider. |
| 8 | 2026-10-21 | Home graph: MemoryRepo (JSON file) by default, DynamoRepo when `HEARTH_DDB_TABLE` is set. Same `HomeRepository` interface. | PRD 8 dev fallback. |
| 9 | 2026-10-21 | Seed photos are clean SVG line illustrations with contract-fixed annotation coordinates. | PRD 10.2 allows line illustrations; no real photos available yet. Replace with team photos. |
| 10 | 2026-10-21 | Added an eighth widget, `recall-card`, for `check_recalls` (PRD lists "Card" without a widget). | Every visual tool gets a purpose-built widget. |
| 11 | 2026-10-21 | Added `kraft` (#E8D9B8) and `show15` sizes to tokens. | Pro Brief needs a token for "warmer parchment"; no hard-coded colours allowed. |
| 12 | 2026-10-21 | `complete_checkout` input adds `confirmationPhrase`; checkout outputs carry a `state` discriminator. | PRD 7.4 requires the echoed phrase; one widget renders both card states. |
| 13 | 2026-10-21 | Shipping is free (seed household is Prime, PRD 3.1); tax 8.25%. | Commitment text stays close to the item price the customer hears. |
| 14 | 2026-10-21 | Bridge message names follow PRD 9.1 (`ui/ready`, `ui/hostContext`, `ui/render`, `ui/resize`, `ui/action`, `ui/voice-intent`). | Frozen contract C4. |
| 15 | 2026-10-21 | Claude Desktop bonus via `mcp-remote` + a dev token minted by the auth server. | No DCR allowed, so a static bearer is the honest path. |
| 16 | 2026-10-21 | Third orchestrator provider: local Ollama on the build machine's RTX A2000 Laptop (4 GB VRAM), between Bedrock and rules. Default `qwen3:4b-instruct-2507` (dense, non-thinking, 8k context so it fits in VRAM; the plain `qwen3:4b` tag is the thinking variant and misses voice latency); `HEARTH_OLLAMA_MODEL` can select the MoE `qwen3:30b-a3b` (3B active, CPU/GPU split) when RAM allows. Checkout confirmation and hard stops stay deterministic guards around any model. | A real LLM picks tools live without cloud credentials; small models need deterministic guardrails for money and safety. |
| 17 | 2026-10-21 | Measured on the RTX A2000 Laptop: `qwen3:4b-instruct-2507-q4_K_M` with 12 tool schemas (2,386 prompt tokens) answers an orchestrator step in about 1.9 s warm (8.4 s cold), 3.0 of 4.2 GB resident in VRAM, and picks `triage_issue` first. `qwen3:30b-a3b` (MoE) was not adopted: it needs about 18 GB of RAM and the build machine had about 2.5 GB free. | Numbers, not guesses, decide the local model. |
