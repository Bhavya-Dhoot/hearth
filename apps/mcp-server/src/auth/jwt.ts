import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/** What the rest of the server needs from a verified access token. */
export interface TokenClaims {
  sub: string;
  scope: string;
  clientId: string;
  exp?: number;
  email?: string;
}

export type VerifyToken = (jwt: string) => Promise<TokenClaims>;

export interface VerifierOptions {
  issuer: string;
  /** The MCP resource URL, `${HEARTH_MCP_BASE}/mcp`. */
  audience: string;
  keys: JWTVerifyGetKey;
}

/** RS256 only. Verifies signature, issuer, audience and expiry; throws on anything else. */
export function createJwtVerifier(opts: VerifierOptions): VerifyToken {
  return async (token) => {
    const { payload } = await jwtVerify(token, opts.keys, {
      issuer: opts.issuer,
      audience: opts.audience,
      algorithms: ["RS256"],
      clockTolerance: 5,
      requiredClaims: ["sub", "exp"],
    });
    if (typeof payload.sub !== "string" || payload.sub === "") throw new Error("token has no subject");
    return {
      sub: payload.sub,
      scope: typeof payload.scope === "string" ? payload.scope : "",
      clientId: typeof payload.client_id === "string" ? payload.client_id : "unknown",
      ...(typeof payload.exp === "number" ? { exp: payload.exp } : {}),
      ...(typeof payload.email === "string" ? { email: payload.email } : {}),
    };
  };
}

/** Keys fetched from the auth server's JWKS endpoint, cached by jose and refreshed on an unknown `kid`. */
export const remoteKeys = (jwksUrl: string): JWTVerifyGetKey => createRemoteJWKSet(new URL(jwksUrl), { cooldownDuration: 10_000 });
