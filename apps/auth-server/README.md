# @hearth/auth-server

OAuth 2.1 authorization server for Hearth, built to the Alexa+ account-linking checklist: Authorization Code with PKCE (S256), public clients, no dynamic client registration, no OIDC. Contract: `docs/AUTH.md` and `packages/contracts/src/auth.ts`.

## Run

```
pnpm --filter @hearth/auth-server start      # http://localhost:4100
pnpm --filter @hearth/auth-server test
pnpm --filter @hearth/auth-server typecheck
```

Configuration (see `.env.example`; a local `.env` is picked up automatically):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4100` | Listen port |
| `HEARTH_AUTH_ISSUER` | `http://localhost:4100` | `iss` claim and metadata base URL |
| `HEARTH_MCP_BASE` | `http://localhost:4200` | Token audience is `${HEARTH_MCP_BASE}/mcp` |
| `HEARTH_HOST_BASE` | `http://localhost:3000` | Origin allowed by CORS (any `http://localhost:*` is also allowed) |

## Endpoints

- `GET /.well-known/oauth-authorization-server` (RFC 8414) and `GET /.well-known/jwks.json`
- `GET /authorize` renders the sign-in and consent page; `POST /authorize` verifies credentials and redirects with a single-use code (60 s)
- `POST /token` (`application/x-www-form-urlencoded`): `authorization_code` with PKCE verification, and `refresh_token` with rotation

An unknown client or an unregistered `redirect_uri` produces an error page and is never redirected to. Other request errors (missing or `plain` PKCE, `response_type` other than `code`, unsupported scope) are returned to the registered redirect URI as RFC 6749 errors.

## State on disk

- `.keys/signing-key.json`: RS256 key pair, generated on first boot and reused. Gitignored.
- `.data/refresh.json`: SHA-256 digests of live refresh tokens. Gitignored. Delete it to revoke every session.
- `seed/users.json`: the demo user, with a scrypt hash and per-user salt.

## Demo account

For this local demo system only (it exists nowhere else):

| Field | Value |
|---|---|
| Email | `priya@okafor.example` |
| Password | `okafor-demo-2026` |
| `sub` (userId) | `usr_okafor` |

## Tokens for scripts and Claude Desktop

```
pnpm --silent --filter @hearth/auth-server mint-dev-token
```

Prints only a 1 hour access token for `usr_okafor` with every scope and the MCP resource as audience. `--silent` stops pnpm adding its own header lines to stdout. Use it with `mcp-remote` as an `Authorization: Bearer` header, or capture it in a script.

To run the whole browser-equivalent link flow from a script, use `linkAccount()` from `scripts/lib/link-account.ts`.
