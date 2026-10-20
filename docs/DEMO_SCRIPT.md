# Demo video script

Target length 2:50, hard limit 3:00 (judges may stop watching at 3:00). Public, English, captions on. This plan follows the PRD section 13 shot list, adapted to what exists.

What changed from the PRD plan, and why:

- There is no real kitchen footage. The opening is a hand-drawn, doodle-style title sequence instead. It is an illustration, not a re-enactment, and the voice-over says nothing that implies otherwise.
- Every device frame is the simulated Echo Show. A label reading "Simulated Alexa+ host" stays on screen whenever a frame is visible.
- The email confirmation is shown as the `.eml` page at `/outbox`, not as a phone buzz. Payment is shown as simulated.
- The Claude Desktop scene is shown as it was verified: through `mcp-remote` at the protocol level. If the Claude Desktop GUI is recorded and works at capture time, use it and relabel; if not, show the terminal. Do not imply the GUI was driven if it was not.
- The video is produced after the lane that wrote this document. Nothing here is a recording yet.

## Recording rules

1. 1080p60, no music under the voice-over, captions on.
2. Every tool call on screen must be real: record the replay with the inspector open. Latency badges are read from the live inspector at recording time; do not edit numbers in. Numbers quoted in the voice-over come from the committed reports ([conformance](../apps/mcp-server/reports/conformance.md), [latency](../apps/mcp-server/reports/latency.md)).
3. On-screen label style: monospace, bottom-left, small caps, as in the product's own mono labels.
4. Honest-label scenes: "Simulated payment: no card charged" at checkout, "Sample recall data" if the recall card appears, "Seed illustrations, not photographs" once.
5. Order for recording does not need to match the edit. Record each scene as its own take.

## Pre-flight (before any take)

```bash
pnpm install
pnpm --filter @hearth/design-tokens build && pnpm --filter @hearth/widgets build
# Clean house: stop the MCP server, delete apps/mcp-server/.data/home-graph.json, then start it (it re-seeds on boot).
# Bench and conformance runs leave test orders in the data file.
pnpm dev                     # auth 4100, mcp 4200, host-sim 3000
pnpm replay all              # headless smoke test: must exit 0 before recording
pnpm --silent --filter @hearth/auth-server mint-dev-token   # token for the Claude Desktop scene (1 hour; mint it just before that take)
```

Use Chrome at 1920x1080. Account-link once in the host (demo credentials are in [`apps/auth-server/README.md`](../apps/auth-server/README.md); do not show the password field being typed in the final cut, show the consent screen only).

## Shot list

| # | Time | Scene | On-screen label (bottom-left) | Voice-over |
|---|---|---|---|---|
| 1 | 0:00 to 0:12 | **Doodle title sequence.** Hand-drawn line animation on parchment: a pipe, a drip, a wet floor, a phone sitting far away on a counter. A brass annotation stroke circles the drip, then redraws itself into the word "Hearth". Subtitle: "Your house has a memory now." | none | "Water under the sink, wet hands, phone in the other room. This is Hearth, an Alexa-plus add-on that remembers your house." |
| 2 | 0:12 to 0:35 | **J1, first half, Echo Show 8 frame.** Open `/?replay=J1`. Customer line appears; one clarifying question; "The pipes."; Step Card shows the photo of the house's own shut-off with the annotation stroke drawing on; "Next" twice. Inspector on the right: `initialize`, `tools/list`, `tools/call triage_issue`, `get_repair_steps`, with latency badges. | `SIMULATED ALEXA+ HOST` then `MCP Apps · Card · get_repair_steps` plus the live ms badge | "Hearth is an MCP server. A simulated Alexa-plus host, which is a real MCP client, asks it to triage the leak. One question, then the steps, with the photo of this house's own shut-off valve. Every call in the inspector is real." |
| 3 | 0:35 to 0:55 | **J1, second half.** Step 4 needs a washer; Parts Carousel with three exact-fit items and the fit reason visible. "Order the first one." Checkout Card shows the commitment text and "Confirm?". "Yes." Confirmation stamp. Cut to the `/outbox` page showing the confirmation email. | `Checkout · stored_payment_method · simulated · no card charged` and the `complete_checkout` ms badge | "At step four it needs a washer. Hearth matches the part to the trap size it remembers and says why it fits. The commitment is read aloud first, and only an explicit yes completes the order. In this build the payment is simulated, and it says so." |
| 4 | 0:55 to 1:10 | **J2, escalation.** Open `/?replay=J2`. "Actually, it's coming from the disposal unit itself." `triage_issue` returns escalate; Pro Brief Card on kraft paper with the QR code; Alexa line "Want me to find a plumber?" | `Hand-off to Home Services · prepare_pro_brief` | "When the problem is the disposal itself, Hearth stops guiding and builds a job brief for a pro. It feeds Alexa's Home Services partners with a fully briefed job. It does not replace them." |
| 5 | 1:10 to 1:30 | **J3, Echo Show 15 frame.** Open `/?replay=J3`. "What should I do around the house this weekend?" Weekend List with numbered rows; "Reorder the filter."; checkout in two turns; "Yes." | `Cross-session state · home graph · get_weekend_plan` | "A different session. Asked about the weekend, Hearth ranks what is due from the age of the things in the house, and reorders the filter in two turns." |
| 6 | 1:30 to 1:42 | **Same widgets, other contexts.** Quick cuts: Show 15 tile, phone frame in the light theme, voice-only transcript. | `hostContext-aware rendering` | "The same widgets adapt to a Show 15, a phone in the light theme, and voice only." |
| 7 | 1:42 to 2:05 | **Under the glass.** Split: (a) inspector scrolling `initialize`, `tools/list`, `resources/read ui://hearth/...`, `tools/call`; (b) the PKCE link screen (consent only); (c) terminal running the 401 curl from the README, response headers visible, highlight the absence of `WWW-Authenticate`; (d) `conformance.md` summary line and the latency table's worst row. | `Spec 2025-11-25 · Streamable HTTP · OAuth 2.1 PKCE` then `33 / 33 conformance · worst p95 53.2 ms` | "Under the glass: protocol 2025-11-25 over Streamable HTTP, OAuth 2.1 with PKCE, and a 401 with no WWW-Authenticate header, as the add-on checklist requires. Thirty-three of thirty-three conformance checks pass, and the slowest tool's p95 is about fifty milliseconds against a five hundred millisecond budget." |
| 8 | 2:05 to 2:20 | **Another assistant calls it.** Claude Desktop (or, if the GUI is not recorded, a terminal running `npx -y mcp-remote@0.15.2 http://localhost:4200/mcp --header "Authorization:Bearer <token>"`) showing `initialize` and the 12 tools, then one real tool call. Then `docs/addon.json` in an editor. | `Claude Desktop via mcp-remote · same server` then `Add-on manifest · docs/addon.json` | "It is a plain MCP server, so Claude Desktop can call it too, through mcp-remote. And the add-on manifest is written to the documented schema." |
| 9 | 2:20 to 2:40 | **Impact card.** Typographic card, no stock imagery: Angi 2025 State of Home Spending, $2,041 maintenance plus $1,143 emergency repairs per household per year (figures as recorded in the PRD, confirm the source before publishing). "Feeds Home Services partners with qualified, fully briefed jobs." "Host simulator open sourced: `packages/host-sim-core`." | `Potential impact` | "A household spends over three thousand dollars a year on maintenance and emergency repairs. Hearth turns those moments into briefed jobs and exact-fit orders. The host simulator is open source for anyone building an Alexa-plus add-on." |
| 10 | 2:40 to 2:50 | **Honesty and end card.** Left: a short "Not built" list taken from the README (no AWS deployment, no real Echo, recall data is a sample, label photo values are fixtures). Right: a friction log excerpt (entry A6, 401 without `WWW-Authenticate`). End card: "Hearth. Your house has a memory now." and the repository path. | `Friction log · docs/FRICTION_LOG.md` | "What is not built is listed in the README, and the friction we hit is in the friction log. Hearth: your house has a memory now." |

Total voice-over is about 340 words, which fits 2:50 with room for the title sequence and silent beats.

## Mapping to the judging criteria

| Criterion | Where the video shows it |
|---|---|
| Technical implementation | Scenes 2, 3, 7, 8: real JSON-RPC, latencies, PKCE, 401 shape, conformance, a second MCP client |
| Design | Scenes 1, 2, 4, 6: annotation strokes, kraft pro brief, numbered rows, device-aware widgets |
| Potential impact | Scenes 4, 5, 9: Home Services hand-off, recurring weekend plan, quantified spend |
| Quality of the idea | Scenes 2, 3, 5: a home graph that remembers, exact-fit commerce, cross-session state |
| Friction log bonus | Scene 10 |

## Fallbacks and cuts

- If a take runs long, cut scene 6 first (12 s), then shorten scene 5 to the weekend list without the reorder.
- If a replay fails on camera, the failure is real information: reset the data file as in the pre-flight, then re-run `pnpm replay all`; do not splice in a different take for the failing step.
- Browser J1 and J3 are the replays verified in the browser host. J2 passes headless; if it misbehaves in the browser, record scene 4 from a headless-driven session with the inspector, or cut it to a still of the Pro Brief Card and say so in the caption.
- The title sequence is a browser-rendered motion page. Render it with the project's fast-render tool (`~/.claude/tools/fastrender/fastrender.py`) and confirm its renderer line reports an NVIDIA GPU rather than SwiftShader. Screen captures of the product are recorded with a normal screen recorder, not rendered.

## Checklist before upload

- [ ] Under 3:00 on the exported file, public, English, captions on.
- [ ] "Simulated Alexa+ host" visible in every frame scene; "simulated" visible at checkout.
- [ ] No password, token or API key readable on screen (the dev token is blurred or trimmed).
- [ ] Numbers spoken match the committed reports (33 of 33; worst p95 53.2 ms; budget 500 ms).
- [ ] Link added to the Devpost form and to [`SUBMISSION.md`](SUBMISSION.md).
