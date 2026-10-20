import { z } from "zod";

/** C5 - Auth. Full prose in docs/AUTH.md. */

export const SCOPES = ["home:read", "home:write", "orders:write"] as const;
export type ScopeName = (typeof SCOPES)[number];

export const ProtectedResourceMetadata = z.object({
  resource: z.string().url(),
  authorization_servers: z.array(z.string().url()).min(1),
  scopes_supported: z.array(z.enum(SCOPES)),
  bearer_methods_supported: z.array(z.literal("header")),
  resource_name: z.string().optional(),
});
export type ProtectedResourceMetadata = z.infer<typeof ProtectedResourceMetadata>;

/** Body of a 401 from the MCP server. Sent WITHOUT a WWW-Authenticate header (Alexa+ checklist). */
export const UnauthorizedBody = z.object({
  error: z.literal("unauthorized"),
  error_description: z.string(),
  resource_metadata: z.string().url(),
});
export type UnauthorizedBody = z.infer<typeof UnauthorizedBody>;

export const InsufficientScopeBody = z.object({
  error: z.literal("insufficient_scope"),
  error_description: z.string(),
  required_scope: z.enum(SCOPES),
});

/** RFC 8414 metadata served by auth-server at /.well-known/oauth-authorization-server */
export const AuthorizationServerMetadata = z.object({
  issuer: z.string().url(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  jwks_uri: z.string().url(),
  scopes_supported: z.array(z.string()),
  response_types_supported: z.array(z.literal("code")),
  grant_types_supported: z.array(z.enum(["authorization_code", "refresh_token"])),
  code_challenge_methods_supported: z.array(z.literal("S256")),
  token_endpoint_auth_methods_supported: z.array(z.literal("none")),
});
export type AuthorizationServerMetadata = z.infer<typeof AuthorizationServerMetadata>;

/** Access-token claims (RS256 JWT, 1h). `sub` is the userId: the only continuity key. */
export const AccessTokenClaims = z.object({
  iss: z.string().url(),
  sub: z.string(),
  aud: z.string().url(),
  scope: z.string(),
  client_id: z.string(),
  iat: z.number(),
  exp: z.number(),
  jti: z.string(),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaims>;

export const TokenResponse = z.object({
  access_token: z.string(),
  token_type: z.literal("Bearer"),
  expires_in: z.number(),
  refresh_token: z.string(),
  scope: z.string(),
});
export type TokenResponse = z.infer<typeof TokenResponse>;

/** Statically registered public clients (no DCR, no client secret). */
export const REGISTERED_CLIENTS = [
  {
    client_id: "alexa-plus-host-sim",
    name: "Simulated Alexa+ host",
    redirect_uris: ["http://localhost:3000/link/callback"],
  },
] as const;

/** Env-overridable public URLs. Defaults match local dev ports. */
export const urlsFromEnv = (env: Record<string, string | undefined> = process.env) => ({
  authIssuer: env.HEARTH_AUTH_ISSUER ?? "http://localhost:4100",
  mcpBase: env.HEARTH_MCP_BASE ?? "http://localhost:4200",
  mcpResource: `${env.HEARTH_MCP_BASE ?? "http://localhost:4200"}/mcp`,
  hostBase: env.HEARTH_HOST_BASE ?? "http://localhost:3000",
});
