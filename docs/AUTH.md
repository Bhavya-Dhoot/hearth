# Auth contract (C5)

Hearth implements account linking to the Alexa+ add-on checklist: OAuth 2.1 Authorization Code + PKCE (S256), public clients, no DCR, no CIMD, no OIDC. Types live in `packages/contracts/src/auth.ts`.

## Parties

| Role | Service | Default URL |
|---|---|---|
| Authorization server | `apps/auth-server` | `http://localhost:4100` (`HEARTH_AUTH_ISSUER`) |
| Protected resource | `apps/mcp-server` | `http://localhost:4200/mcp` (`HEARTH_MCP_BASE` + `/mcp`) |
| Client | `apps/host-sim` (client_id `alexa-plus-host-sim`) | redirect `http://localhost:3000/link/callback` |

## Endpoints

### MCP server (resource)
- `GET /.well-known/oauth-protected-resource` (RFC 9728):
  ```json
  { "resource": "http://localhost:4200/mcp",
    "authorization_servers": ["http://localhost:4100"],
    "scopes_supported": ["home:read","home:write","orders:write"],
    "bearer_methods_supported": ["header"],
    "resource_name": "Hearth" }
  ```
- Any `/mcp` or `/checkout-sessions` request without a valid bearer returns **401**, `Content-Type: application/json`, and **no `WWW-Authenticate` header**:
  ```json
  { "error": "unauthorized",
    "error_description": "Link your Hearth account to continue.",
    "resource_metadata": "http://localhost:4200/.well-known/oauth-protected-resource" }
  ```
- Valid token, missing scope for the called tool: MCP tool result `isError: true`, `structuredContent.error.code = "forbidden_scope"` (JSON-RPC stays 200). REST: 403 with `InsufficientScopeBody`.

### Auth server
- `GET /.well-known/oauth-authorization-server` (RFC 8414): issuer, `authorization_endpoint` `/authorize`, `token_endpoint` `/token`, `jwks_uri` `/.well-known/jwks.json`, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]`, grants `authorization_code`, `refresh_token`.
- `GET /authorize?response_type=code&client_id=&redirect_uri=&scope=&state=&code_challenge=&code_challenge_method=S256&resource=` renders the sign-in + consent page (design language, Section 10). Rejects: unknown client, redirect not registered, missing/`plain` PKCE, `response_type` other than `code`.
- `POST /authorize` (form) verifies credentials, issues a single-use code (60 s TTL) bound to client, redirect_uri, code_challenge, scope, resource; redirects `redirect_uri?code=&state=`.
- `POST /token` (`application/x-www-form-urlencoded`):
  - `grant_type=authorization_code&code=&redirect_uri=&client_id=&code_verifier=` -> verifies `BASE64URL(SHA256(code_verifier)) == code_challenge`. Wrong/missing verifier -> 400 `invalid_grant`.
  - `grant_type=refresh_token&refresh_token=&client_id=` -> rotates the refresh token.
  - Response: `TokenResponse` (`expires_in` 3600).
- `GET /.well-known/jwks.json` - RS256 public key. Key pair generated on first boot into `apps/auth-server/.keys/` (gitignored).

## Tokens
- Access: RS256 JWT, 1 h, claims `iss, sub (userId), aud (= MCP resource URL), scope, client_id, iat, exp, jti`.
- Refresh: opaque, 30 d, rotated on use, stored server-side.
- `sub` is the only continuity key, matching Alexa+'s "based on previous conversations" model. The MCP server resolves `sub` -> home via `HomeRepository.getHomeForUser`.

## Scopes per tool
- `home:read`: get_home_profile, triage_issue, get_repair_steps, find_exact_part, get_weekend_plan, get_history, check_recalls
- `home:write`: add_asset, prepare_pro_brief, log_completion
- `orders:write`: create_checkout_session, complete_checkout

## Demo user
- userId `usr_okafor`, home `home_okafor`. Test credentials live in `apps/auth-server/seed/users.json` (scrypt hash) and in the README demo section; they exist only in this local test system.
- `pnpm --filter @hearth/auth-server mint-dev-token` mints a 1 h token for `usr_okafor` with all scopes (for Claude Desktop via `mcp-remote`, conformance and bench scripts).
