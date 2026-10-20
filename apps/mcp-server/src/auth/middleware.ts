import type { UnauthorizedBody } from "@hearth/contracts";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { Request, RequestHandler } from "express";
import type { Logger } from "../log";
import type { VerifyToken } from "./jwt";

/** The MCP transport reads `req.auth` and hands it to tool handlers as `extra.authInfo`. */
type WithAuth = { auth?: AuthInfo };
export const authOf = (req: Request): AuthInfo | undefined => (req as Request & WithAuth).auth;

export function unauthorizedBody(mcpBase: string): UnauthorizedBody {
  return {
    error: "unauthorized",
    error_description: "Link your Hearth account to continue.",
    resource_metadata: `${mcpBase}/.well-known/oauth-protected-resource`,
  };
}

const BEARER = /^Bearer\s+(\S+)\s*$/i;

/**
 * Bearer validation for /mcp and /checkout-sessions.
 * A missing or bad token is a 401 JSON body and deliberately no WWW-Authenticate header (Alexa+ add-on checklist),
 * so the SDK's requireBearerAuth, which always sets that header, is not used.
 */
export function bearerAuth(verifyToken: VerifyToken, mcpBase: string, logger: Logger): RequestHandler {
  const body = unauthorizedBody(mcpBase);
  return async (req, res, next) => {
    const deny = (reason: string): void => {
      logger.info("auth_rejected", { reason, method: req.method });
      res.status(401).type("application/json").json(body);
    };
    const token = BEARER.exec(req.get("authorization") ?? "")?.[1];
    if (!token) return deny("missing_bearer");
    try {
      const claims = await verifyToken(token);
      const info: AuthInfo = {
        token,
        clientId: claims.clientId,
        scopes: claims.scope.split(/\s+/).filter(Boolean),
        ...(claims.exp !== undefined ? { expiresAt: claims.exp } : {}),
        extra: { sub: claims.sub, ...(claims.email ? { email: claims.email } : {}) },
      };
      Object.assign(req, { auth: info } satisfies WithAuth);
      next();
    } catch (err) {
      deny(err instanceof Error ? err.name : "invalid_token");
    }
  };
}

export const subjectOf = (req: Request): string | undefined => {
  const sub = authOf(req)?.extra?.sub;
  return typeof sub === "string" ? sub : undefined;
};
