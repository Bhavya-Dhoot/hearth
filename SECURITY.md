# Security policy

## Reporting a vulnerability

Email **support@hearth.example** with the subject line "Hearth security". `hearth.example` is a reserved placeholder domain used throughout this project, so treat the address as a placeholder until the maintainers replace it with a monitored mailbox in the repository settings.

Please include:

- what you found and the component (`apps/mcp-server`, `apps/auth-server`, `apps/host-sim`, a package, or `infra/cdk`),
- steps to reproduce, with the commit you tested,
- the impact you believe it has.

Do not open a public issue or pull request for a vulnerability, and do not test against anyone else's deployment. We will acknowledge a report on a best-effort basis; this is a hackathon project and there is no service-level agreement.

Safety problems (for example a repair instruction given where Hearth should hard-stop) can be reported the same way. They are read first. See [docs/SAFETY.md](docs/SAFETY.md).

## Scope and status

Hearth is a hackathon build. It has not been deployed, has not been penetration tested, and runs only against a demo user and a seeded demo house. The statements below describe the code as it is, not a hardened production service.

| Area | State |
|---|---|
| Authentication | OAuth 2.1 Authorization Code with PKCE (S256), public clients, RS256 access tokens (1 hour), rotating refresh tokens (30 days), single-use authorization codes (60 seconds). Tokens are verified on every `/mcp` and `/checkout-sessions` request for issuer, audience and expiry. |
| Authorization | Scopes `home:read`, `home:write`, `orders:write` are checked per tool. An MCP session is bound to the token's subject; another account gets 403. |
| Payments | Simulated, or Stripe test mode only. Keys that are not `sk_test_` or `rk_test_` are ignored and the server falls back to simulated payments. Card numbers are never collected or stored; only a display string is kept. |
| Data | City and state only (no street address). No health data and no data about children by design. |
| Secrets | Read from environment variables; in the CDK app they are injected from Secrets Manager through ECS `secrets`, never as plain environment values. |

## Development-only features that must be disabled in production

These exist so the project can be run and judged without cloud accounts. Do not expose them on a production deployment.

1. **`GET /outbox` and `GET /outbox/:file`** (MCP server). They list and render every confirmation email the local outbox has written, with no authentication. They are mounted unconditionally in the current code. In production, remove the route or put it behind authentication, and use a real email provider (Resend or SES) so that no `.eml` files are written.
2. **`pnpm --filter @hearth/auth-server mint-dev-token`** and `scripts/lib/link-account.ts`. They mint or obtain a token for the demo user with every scope, outside the browser consent flow. Do not ship them in a production image, and do not run them against a production authorization server.
3. **The demo user and its credentials** in `apps/auth-server/seed/users.json` and the demo account section of `apps/auth-server/README.md`. Replace the user store before any non-local use.
4. **The `alexa-plus-host-sim` client and its `localhost` redirect URI** in `apps/auth-server/src/clients.ts`. In production, register only the real client and exact redirect URIs.
5. **Permissive local CORS.** The MCP server and the authorization server allow any `http://localhost:*` origin in addition to the configured host origin. Restrict to the exact origins you serve.
6. **Auto-generated signing key.** With no `HEARTH_AUTH_PRIVATE_JWK` the auth server generates a key into `apps/auth-server/.keys/` on first boot. In production provide the key through a secret manager so it is stable across restarts and not on disk.
7. **Simulated payments and sample data.** With no Stripe key the server uses `pi_sim_*` payment ids; recall data is a labelled sample; the parts catalogue is a seeded sample. None of these are suitable for real commerce.
8. **Unauthenticated public pages by design.** `GET /receipts/:orderId` and `GET /briefs/:token` render without a bearer token (the brief is meant to be shared through its public token). Receipt URLs are identified only by order id. Treat both as bearer-by-URL, review what they show, and add authentication or signed URLs if that is not acceptable.
9. **Single-process state.** MCP sessions and OAuth authorization codes live in process memory, so run one instance per service or add shared storage first.

## Supported versions

Only the current `main` branch is supported.

## Safe harbor

Good-faith research that follows this policy, accesses only data of your own accounts, and stops when it reaches personal data will not be treated as a violation by the maintainers.
