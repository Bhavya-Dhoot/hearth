import { SCOPES, type ScopeName } from "@hearth/contracts";
import { findClient, type RegisteredClient } from "./clients";

/** A fully validated authorization request. */
export interface AuthorizeRequest {
  readonly client: RegisteredClient;
  readonly redirectUri: string;
  readonly state: string | undefined;
  readonly codeChallenge: string;
  readonly scopes: readonly ScopeName[];
  readonly resource: string;
}

/** Failures that must NOT redirect: the client or redirect_uri cannot be trusted. */
export type FatalReason = "unknown_client" | "redirect_mismatch";

export type AuthorizeOutcome =
  | { readonly kind: "ok"; readonly request: AuthorizeRequest }
  | { readonly kind: "fatal"; readonly reason: FatalReason }
  | {
      readonly kind: "redirect_error";
      readonly redirectUri: string;
      readonly state: string | undefined;
      readonly error: "invalid_request" | "unsupported_response_type" | "invalid_scope";
      readonly description: string;
    };

export interface AuthorizeContext {
  /** The MCP resource URL; the only audience tokens are ever issued for. */
  readonly mcpResource: string;
}

/** A base64url SHA-256 digest is always exactly 43 characters (RFC 7636 section 4.2). */
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

const isScope = (value: string): value is ScopeName => (SCOPES as readonly string[]).includes(value);

/**
 * Validates GET /authorize query or POST /authorize form parameters. Client and redirect_uri are
 * checked first and failures there are never redirected; every later failure is returned to the
 * client's registered redirect_uri as an RFC 6749 error response.
 */
export function validateAuthorizeParams(
  params: Readonly<Record<string, string | undefined>>,
  context: AuthorizeContext,
): AuthorizeOutcome {
  const client = findClient(params.client_id);
  if (client === undefined) return { kind: "fatal", reason: "unknown_client" };

  const redirectUri = params.redirect_uri;
  if (redirectUri === undefined || !client.redirect_uris.includes(redirectUri)) {
    return { kind: "fatal", reason: "redirect_mismatch" };
  }

  const state = params.state;
  const fail = (
    error: "invalid_request" | "unsupported_response_type" | "invalid_scope",
    description: string,
  ): AuthorizeOutcome => ({ kind: "redirect_error", redirectUri, state, error, description });

  if (params.response_type !== "code") {
    return fail("unsupported_response_type", "response_type must be code.");
  }

  const codeChallenge = params.code_challenge;
  if (codeChallenge === undefined || codeChallenge === "") {
    return fail("invalid_request", "code_challenge is required (PKCE with S256).");
  }
  if (params.code_challenge_method !== "S256") {
    return fail("invalid_request", "code_challenge_method must be S256.");
  }
  if (!S256_CHALLENGE.test(codeChallenge)) {
    return fail("invalid_request", "code_challenge is not a valid S256 challenge.");
  }

  const requested = (params.scope ?? "").split(/\s+/).filter((value) => value !== "");
  const scopes: ScopeName[] = [];
  for (const value of requested) {
    if (!isScope(value)) return fail("invalid_scope", `Unsupported scope: ${value.slice(0, 64)}.`);
    if (!scopes.includes(value)) scopes.push(value);
  }

  return {
    kind: "ok",
    request: {
      client,
      redirectUri,
      state,
      codeChallenge,
      scopes: scopes.length > 0 ? scopes : [...SCOPES],
      resource: params.resource === context.mcpResource ? params.resource : context.mcpResource,
    },
  };
}
