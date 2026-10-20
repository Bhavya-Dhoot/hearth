import {
  SCOPES,
  TokenResponse,
  urlsFromEnv,
  type AuthorizationServerMetadata,
} from "@hearth/contracts";
import express, {
  type ErrorRequestHandler,
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { validateAuthorizeParams, type AuthorizeContext, type AuthorizeRequest } from "./authorize";
import { findClient } from "./clients";
import { s256Challenge, safeEqual } from "./crypto";
import { resolveSigningKeys, type SigningKeys } from "./keys";
import { renderConsentPage, renderErrorPage } from "./pages";
import { DEFAULT_DATA_DIR, DEFAULT_KEYS_DIR, DEFAULT_USERS_FILE } from "./paths";
import { ACCESS_TTL_S, CodeStore, RefreshStore, type Clock, type RefreshGrant } from "./stores";
import { signAccessToken } from "./tokens";
import { loadUsers, verifyCredentials, type UserRecord } from "./users";

export interface AuthAppOptions {
  /** Public issuer URL. Defaults to HEARTH_AUTH_ISSUER, then http://localhost:4100. */
  readonly issuer?: string;
  /** Resource (MCP endpoint) tokens are issued for. Defaults to HEARTH_MCP_BASE + "/mcp". */
  readonly mcpResource?: string;
  /** Origin of the Alexa+ host simulator, allowed by CORS. Defaults to HEARTH_HOST_BASE. */
  readonly hostBase?: string;
  /** Directory holding refresh.json. Defaults to apps/auth-server/.data. */
  readonly dataDir?: string;
  /** RS256 signing keys. Defaults to loading (or creating) apps/auth-server/.keys. */
  readonly keys?: SigningKeys;
  /** Known users. Defaults to apps/auth-server/seed/users.json. */
  readonly users?: readonly UserRecord[];
  /** Epoch-millisecond clock, injectable for tests. */
  readonly now?: Clock;
}

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" } as const;
const LOCALHOST_ORIGIN = /^http:\/\/localhost(:\d+)?$/;

/** RFC 7636 section 4.1: 43 to 128 unreserved characters. */
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

type Fields =Readonly<Record<string, string | undefined>>;

/** Keeps only single string values; repeated or nested parameters are treated as absent. */
function readFields(source: unknown): Fields {
  const fields: Record<string, string> = {};
  if (typeof source === "object" && source !== null) {
    for (const [name, value] of Object.entries(source)) {
      if (typeof value === "string") fields[name] = value;
    }
  }
  return fields;
}

function withParams(target: string, params: Readonly<Record<string, string | undefined>>): string {
  const url = new URL(target);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(name, value);
  }
  return url.toString();
}

function hiddenFields(request: AuthorizeRequest): Record<string, string> {
  const fields: Record<string, string> = {
    response_type: "code",
    client_id: request.client.client_id,
    redirect_uri: request.redirectUri,
    scope: request.scopes.join(" "),
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
    resource: request.resource,
  };
  if (request.state !== undefined) fields.state = request.state;
  return fields;
}

function tokenError(res: Response, status: number, error: string, description: string): void {
  res.status(status).set(NO_STORE).json({ error, error_description: description });
}

export function createApp(options: AuthAppOptions = {}): Express {
  const urls = urlsFromEnv();
  const issuer = (options.issuer ?? urls.authIssuer).replace(/\/+$/, "");
  const mcpResource = options.mcpResource ?? urls.mcpResource;
  const hostOrigin = new URL(options.hostBase ?? urls.hostBase).origin;
  const now: Clock = options.now ?? Date.now;
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const keys = options.keys ?? resolveSigningKeys(DEFAULT_KEYS_DIR);
  const users = options.users ?? loadUsers(DEFAULT_USERS_FILE);

  const codes = new CodeStore(now);
  const refreshTokens = new RefreshStore(dataDir, now);
  const context: AuthorizeContext = { mcpResource };

  const metadata: AuthorizationServerMetadata = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    scopes_supported: [...SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  };

  const app = express();
  app.disable("x-powered-by");

  app.use((_req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    next();
  });

  // The browser host simulator exchanges the code itself as a public client, so /token and the
  // discovery documents answer cross-origin requests from the host origin and any localhost port.
  const cors: RequestHandler = (req, res, next) => {
    const origin = req.get("Origin");
    if (origin !== undefined && (origin === hostOrigin || LOCALHOST_ORIGIN.test(origin))) {
      res.set({
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      });
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  };
  app.use(["/token", "/.well-known"], cors);

  const form = express.urlencoded({ extended: false, limit: "16kb" });

  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json(metadata);
  });

  app.get("/.well-known/jwks.json", (_req, res) => {
    res.set("Cache-Control", "public, max-age=300").json({ keys: [keys.publicJwk] });
  });

  function sendPage(res: Response, status: number, html: string, redirectUri: string | undefined): void {
    const formActions = ["'self'"];
    if (redirectUri !== undefined) formActions.push(new URL(redirectUri).origin);
    res
      .status(status)
      .set({
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
          `font-src https://fonts.gstatic.com; form-action ${formActions.join(" ")}; ` +
          "frame-ancestors 'none'; base-uri 'none'",
        "X-Frame-Options": "DENY",
      })
      .type("html")
      .send(html);
  }

  function redirectToClient(
    res: Response,
    redirectUri: string,
    params: Readonly<Record<string, string | undefined>>,
  ): void {
    res.set("Cache-Control", "no-store").redirect(302, withParams(redirectUri, params));
  }

  const showConsent = (
    res: Response,
    status: number,
    request: AuthorizeRequest,
    email: string,
    errors: { email?: string; password?: string },
  ): void => {
    sendPage(
      res,
      status,
      renderConsentPage({
        client: request.client,
        scopes: request.scopes,
        hidden: hiddenFields(request),
        email,
        errors,
      }),
      request.redirectUri,
    );
  };

  app.get("/authorize", (req, res) => {
    const outcome = validateAuthorizeParams(readFields(req.query), context);
    switch (outcome.kind) {
      case "fatal":
        sendPage(res, 400, renderErrorPage(outcome.reason), undefined);
        return;
      case "redirect_error":
        redirectToClient(res, outcome.redirectUri, {
          error: outcome.error,
          error_description: outcome.description,
          state: outcome.state,
        });
        return;
      case "ok":
        showConsent(res, 200, outcome.request, "", {});
    }
  });

  app.post("/authorize", form, async (req, res) => {
    const fields = readFields(req.body);
    const outcome = validateAuthorizeParams(fields, context);
    if (outcome.kind === "fatal") {
      sendPage(res, 400, renderErrorPage(outcome.reason), undefined);
      return;
    }
    if (outcome.kind === "redirect_error") {
      redirectToClient(res, outcome.redirectUri, {
        error: outcome.error,
        error_description: outcome.description,
        state: outcome.state,
      });
      return;
    }
    const { request } = outcome;

    if (fields.decision === "deny") {
      redirectToClient(res, request.redirectUri, {
        error: "access_denied",
        error_description: "The user declined to link the account.",
        state: request.state,
      });
      return;
    }

    const email = (fields.email ?? "").trim();
    const password = fields.password ?? "";
    const errors: { email?: string; password?: string } = {};
    if (email === "") errors.email = "Enter the email address for your Hearth account.";
    if (password === "") errors.password = "Enter your password.";
    if (errors.email !== undefined || errors.password !== undefined) {
      showConsent(res, 400, request, email, errors);
      return;
    }

    const user = await verifyCredentials(users, email, password);
    if (user === undefined) {
      showConsent(res, 401, request, email, {
        password: "That email and password do not match. Check both and try again.",
      });
      return;
    }

    const code = codes.issue({
      userId: user.userId,
      clientId: request.client.client_id,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      scope: request.scopes.join(" "),
      resource: request.resource,
    });
    redirectToClient(res, request.redirectUri, { code, state: request.state });
  });

  async function respondWithTokens(res: Response, grant: RefreshGrant): Promise<void> {
    const accessToken = await signAccessToken(keys, {
      issuer,
      userId: grant.userId,
      audience: grant.resource,
      scope: grant.scope,
      clientId: grant.clientId,
      now: now(),
    });
    const body = TokenResponse.parse({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_S,
      refresh_token: refreshTokens.issue(grant),
      scope: grant.scope,
    });
    res.status(200).set(NO_STORE).json(body);
  }

  app.post("/token", form, async (req, res) => {
    const fields = readFields(req.body);
    const grantType = fields.grant_type;
    if (grantType === undefined) {
      tokenError(res, 400, "invalid_request", "grant_type is required.");
      return;
    }
    if (grantType !== "authorization_code" && grantType !== "refresh_token") {
      tokenError(res, 400, "unsupported_grant_type", "Supported grants: authorization_code, refresh_token.");
      return;
    }
    const client = findClient(fields.client_id);
    if (client === undefined) {
      tokenError(res, 400, "invalid_client", "Unknown client_id.");
      return;
    }

    if (grantType === "refresh_token") {
      if (fields.refresh_token === undefined || fields.refresh_token === "") {
        tokenError(res, 400, "invalid_request", "refresh_token is required.");
        return;
      }
      const grant = refreshTokens.rotate(fields.refresh_token, client.client_id);
      if (grant === undefined) {
        tokenError(res, 400, "invalid_grant", "The refresh token is invalid, expired, or already used.");
        return;
      }
      await respondWithTokens(res, grant);
      return;
    }

    const { code, redirect_uri: redirectUri, code_verifier: verifier } = fields;
    if (code === undefined || code === "" || redirectUri === undefined) {
      tokenError(res, 400, "invalid_request", "code and redirect_uri are required.");
      return;
    }
    const grant = codes.consume(code);
    if (grant === undefined) {
      tokenError(res, 400, "invalid_grant", "The authorization code is invalid, expired, or already used.");
      return;
    }
    if (grant.clientId !== client.client_id || grant.redirectUri !== redirectUri) {
      tokenError(res, 400, "invalid_grant", "The authorization code was not issued for this client and redirect_uri.");
      return;
    }
    if (
      verifier === undefined ||
      !PKCE_VERIFIER.test(verifier) ||
      !safeEqual(s256Challenge(verifier), grant.codeChallenge)
    ) {
      tokenError(res, 400, "invalid_grant", "code_verifier is missing or does not match the code_challenge.");
      return;
    }
    await respondWithTokens(res, {
      userId: grant.userId,
      clientId: grant.clientId,
      scope: grant.scope,
      resource: grant.resource,
    });
  });

  // Malformed bodies become RFC 6749 errors; nothing from the request or the stack is echoed.
  const onError: ErrorRequestHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      typeof err === "object" && err !== null && "status" in err && typeof err.status === "number"
        ? err.status
        : 500;
    if (status >= 400 && status < 500) {
      tokenError(res, 400, "invalid_request", "The request could not be parsed.");
      return;
    }
    console.error("auth-server error:", err instanceof Error ? err.name : "unknown");
    tokenError(res, 500, "server_error", "The authorization server hit an unexpected error.");
  };
  app.use(onError);

  return app;
}
