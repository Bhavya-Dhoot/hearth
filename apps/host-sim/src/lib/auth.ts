"use client";

import { AUTH_ISSUER, CLIENT_ID, MCP_URL, REDIRECT_URI, SCOPE } from "./config";

/**
 * Account linking, mirroring Alexa's flow: OAuth 2.1 Authorization Code + PKCE (S256),
 * public client, no secret. Tokens live in sessionStorage (tab-scoped, gone on close).
 */

const TOKENS_KEY = "hearth.tokens";
const FLOW_KEY = "hearth.link-flow";

export type StoredTokens = {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  /** epoch ms */
  expires_at: number;
};

type AsMetadata = { authorization_endpoint: string; token_endpoint: string };

const safe = {
  get(k: string): string | null {
    try { return sessionStorage.getItem(k); } catch { return null; }
  },
  set(k: string, v: string) {
    try { sessionStorage.setItem(k, v); } catch { /* storage blocked: linking will not persist */ }
  },
  del(k: string) {
    try { sessionStorage.removeItem(k); } catch { /* noop */ }
  },
};

export function loadTokens(): StoredTokens | null {
  const raw = safe.get(TOKENS_KEY);
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as StoredTokens;
    return typeof t.access_token === "string" && typeof t.expires_at === "number" ? t : null;
  } catch {
    return null;
  }
}

export function saveTokens(t: StoredTokens) { safe.set(TOKENS_KEY, JSON.stringify(t)); }
export function clearTokens() { safe.del(TOKENS_KEY); }

const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const randomString = (bytes: number) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
const challengeFor = async (verifier: string) =>
  b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));

async function asMetadata(): Promise<AsMetadata> {
  try {
    const r = await fetch(`${AUTH_ISSUER}/.well-known/oauth-authorization-server`, { cache: "no-store" });
    if (r.ok) {
      const m = (await r.json()) as Partial<AsMetadata>;
      if (m.authorization_endpoint && m.token_endpoint) return m as AsMetadata;
    }
  } catch { /* fall through to the documented paths */ }
  return { authorization_endpoint: `${AUTH_ISSUER}/authorize`, token_endpoint: `${AUTH_ISSUER}/token` };
}

export class AuthServerUnreachable extends Error {
  constructor() {
    super(`Cannot reach the Hearth auth server at ${AUTH_ISSUER}.`);
  }
}

/** Start the Authorization Code + PKCE flow. Navigates away on success; throws if the AS is down. */
export async function startLink(returnTo: string): Promise<void> {
  // Probe first so a dead auth server shows a designed error instead of a browser error page.
  try {
    // no-cors: an opaque response still proves the server answered, whatever its CORS policy.
    await fetch(`${AUTH_ISSUER}/.well-known/oauth-authorization-server`, { cache: "no-store", mode: "no-cors" });
  } catch {
    throw new AuthServerUnreachable();
  }
  const meta = await asMetadata();
  const verifier = randomString(48);
  const state = randomString(16);
  safe.set(FLOW_KEY, JSON.stringify({ verifier, state, returnTo }));
  const url = new URL(meta.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: "S256",
    resource: MCP_URL,
  }).toString();
  window.location.assign(url.toString());
}

type TokenResponse = { access_token: string; refresh_token?: string; scope?: string; expires_in?: number };

const toStored = (r: TokenResponse): StoredTokens => ({
  access_token: r.access_token,
  refresh_token: r.refresh_token,
  scope: r.scope,
  expires_at: Date.now() + (r.expires_in ?? 3600) * 1000,
});

async function tokenRequest(body: Record<string, string>): Promise<StoredTokens> {
  const meta = await asMetadata();
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description ?? json.error ?? `Token endpoint answered ${res.status}.`);
  }
  return toStored(json);
}

/** Handle /link/callback: verify state, exchange the code, store tokens. Returns the path to go back to. */
export async function completeLink(params: URLSearchParams): Promise<string> {
  const err = params.get("error");
  if (err) throw new Error(params.get("error_description") ?? err);
  const code = params.get("code");
  const state = params.get("state");
  const raw = safe.get(FLOW_KEY);
  if (!code || !raw) throw new Error("This sign-in link has expired. Start again from the device screen.");
  const flow = JSON.parse(raw) as { verifier: string; state: string; returnTo?: string };
  if (flow.state !== state) throw new Error("The sign-in response did not match the request that started it.");
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: flow.verifier,
  });
  saveTokens(tokens);
  safe.del(FLOW_KEY);
  return flow.returnTo || "/";
}

let refreshing: Promise<StoredTokens | null> | null = null;

/** Synchronous bearer for McpHostClient.getToken. Freshness is handled by ensureFreshToken() before each turn. */
export function currentAccessToken(): string | null {
  return loadTokens()?.access_token ?? null;
}

/** Refresh (rotating the refresh token) when the access token is under 60 s from expiry. Clears tokens if refresh fails. */
export async function ensureFreshToken(): Promise<StoredTokens | null> {
  const t = loadTokens();
  if (!t) return null;
  if (t.expires_at - Date.now() > 60_000 || !t.refresh_token) return t;
  refreshing ??= tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: CLIENT_ID })
    .then((n) => {
      saveTokens({ ...n, refresh_token: n.refresh_token ?? t.refresh_token });
      return loadTokens();
    })
    .catch(() => {
      clearTokens();
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** Decode (not verify) the JWT payload for display in the inspector. */
export function describeToken(t: StoredTokens | null): { sub?: string; scope?: string; exp?: number } | null {
  if (!t) return null;
  try {
    const payload = JSON.parse(atob(t.access_token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as {
      sub?: string; scope?: string; exp?: number;
    };
    return { sub: payload.sub, scope: payload.scope ?? t.scope, exp: payload.exp };
  } catch {
    return { scope: t.scope, exp: Math.floor(t.expires_at / 1000) };
  }
}
