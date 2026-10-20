# Contributing to Hearth

Thanks for looking. Hearth is an Alexa+ add-on (an MCP server) plus a simulated Alexa+ host. Contributions are welcome under the Apache License 2.0 (see [LICENSE](LICENSE)); by submitting a change you agree it can be distributed under that license.

## Set up

Requirements: Node 22 or newer and pnpm 10 (`packageManager` in `package.json`). No cloud account is needed.

```bash
pnpm install
pnpm --filter @hearth/design-tokens build && pnpm --filter @hearth/widgets build
pnpm dev          # auth :4100, mcp :4200, host-sim :3000
```

Before opening a pull request, run these. The first two need no running servers; the last three need `pnpm dev` (or the three `start` commands) running.

```bash
pnpm typecheck
pnpm test
pnpm conformance      # 33 checks against the live MCP and auth servers
pnpm replay all       # journeys J1 to J5 must call exactly the expected tool sequence
pnpm bench            # every tool's p95 must stay under 500 ms
```

`pnpm conformance` and `pnpm bench` write reports to `apps/mcp-server/reports/`. Commit regenerated reports only if your change affects them, and say which ports the stack ran on. Both leave test data in the home they run against; delete `apps/mcp-server/.data/home-graph.json` and restart the MCP server to get a clean demo house.

## Ground rules

1. **Contracts first.** The tool, widget, database, bridge, auth and checkout shapes are frozen contracts (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#2-frozen-contracts-c1-to-c7)). If a change needs a contract to move, change the contract in `packages/contracts` in its own commit, add a one-line entry to [docs/DECISIONS.md](docs/DECISIONS.md) saying what and why, and update every consumer. Do not diverge silently in one package.
2. **Tools stay deterministic.** No LLM call inside an MCP tool. Reasoning belongs in the orchestrator; tools are lookups, rule engines and template fills. This is how the 500 ms budget is met.
3. **Safety is code, not prompt.** Anything the customer must be told, and anything that must never happen, is enforced by a deterministic rule with a test. See [docs/SAFETY.md](docs/SAFETY.md). A change to hard-stop rules or messages needs a test in `packages/playbooks/test` and the matching update to SAFETY.md.
4. **Honest labels.** Simulated things say they are simulated. Sample data says it is a sample. Do not add a "real" claim to the README without the report or test that backs it.
5. **Surgical changes.** Keep a pull request to one concern. Match the existing style. Do not reformat files you are not changing.

## Code style

- TypeScript strict mode, no `any`, no left-over `TODO` comments in merged code.
- zod for every boundary shape; derive types with `z.infer`.
- Match the surrounding file for naming, quotes and layout. There is no formatter configured; do not add one in a feature change.
- Server code logs through the JSON logger and never logs tokens or full secret paths.
- Writes are idempotent (`idempotencyKey`) and tools return voice-safe errors (`isError: true` with a code in `structuredContent.error.code`), never stack traces and never SKUs in voice text.

## Design rules (UI changes)

Widgets and the host take every colour, font size, radius and motion value from `packages/design-tokens/tokens.json`. A test ([`packages/widgets/test/tokens-only.test.ts`](packages/widgets/test/tokens-only.test.ts)) fails on hex or rgb colour literals, font-family names, gradients, shadows, em or en dashes, emoji, a "Buy" label and placeholder copy in widget source. Do not work around it. In short: no gradients or glass, no emoji as icons, at most two accent colours per screen, copper only for caution, overdue and escalation, verdigris only for done and ordered.

## Common changes

**Add or edit a repair playbook.** Edit or add a YAML file in `packages/playbooks/data`, add the symptom synonyms it needs in `packages/playbooks/src/synonyms.ts`, and add triage cases (including a wrong-guess case) under `packages/playbooks/test`. Each playbook keeps at most two clarifying questions. If a step needs a part, make sure `packages/parts-catalog` has an exact-fit entry for the part role and a test proves it.

**Add or change a tool.** Update the spec in `packages/contracts/src/tools.ts` (schema, scope, widget, annotations), implement it under `apps/mcp-server/src/services` and register it through `apps/mcp-server/src/mcp`, add a check to `scripts/conformance.ts` and a benchmark case to `scripts/latency-bench.ts`, and add the scope to [docs/AUTH.md](docs/AUTH.md).

**Add a widget.** Add the props type to `packages/contracts/src/widgets.ts`, the widget under `packages/widgets/src/widgets`, sample props in `packages/widgets/src/samples.ts`, and run the widget tests and the preview (`pnpm --filter @hearth/widgets preview`).

**Use the host simulator in your own add-on.** `packages/host-sim-core` is a standalone library (MCP client, widget bridge, orchestrator loop, replays). Issues and pull requests that make it easier to point at someone else's MCP server are especially welcome.

## Commits and pull requests

- Write the commit subject in the imperative and under about 72 characters, with a short body saying why.
- A pull request description lists what changed, how you verified it (which commands, what output), and anything you did not verify.
- Do not commit secrets, `.env` files, `.keys/`, `.data/` or `.outbox/` (all are gitignored).
- Use hyphens, commas or colons in prose; the project style avoids em dashes and en dashes.

## Reporting bugs and security issues

Bugs: open an issue with the command you ran, what you expected and what happened. Security problems: do not open a public issue; follow [SECURITY.md](SECURITY.md).
