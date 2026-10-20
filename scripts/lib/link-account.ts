import { createHash, randomBytes } from "node:crypto";
import { REGISTERED_CLIENTS, TokenResponse } from "@hearth/contracts";

export interface LinkAccountOptions {
  /** Authorization server base URL. Defaults to HEARTH_AUTH_ISSUER, then http://localhost:4100. */
  issuer?: string;
  /** Defaults to the demo account documented in apps/auth-server/README.md. */
  email?: string;
  password?: string;
  /** Space-separated scopes. Defaults to every scope Hearth supports. */
  scope?: string;
  /** Protected resource (audience). Defaults to `${HEARTH_MCP_BASE}/mcp`. */
  resource?: string;
}

const HOST_SIM = REGISTERED_CLIENTS[0];
const DEMO_EMAIL = "priya@okafor.example";
const DEMO_PASSWORD = "okafor-demo-2026";
const HIDDEN_INPUT = /<input type="hidden" name="([^"]*)" value="([^"]*)">/g;

const unescapeHtml = (value: string): string =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/**
 * Performs the browser-equivalent account-linking flow against a running auth server:
 * PKCE S256, GET /authorize, POST the sign-in form, capture the 302 to the host's redirect_uri,
 * check `state`, then exchange the code at /token as the registered public client.
 */
export async function linkAccount(opts: LinkAccountOptions = {}): Promise<TokenResponse> {
  const issuer = (opts.issuer ?? process.env.HEARTH_AUTH_ISSUER ?? "http://localhost:4100").replace(/\/+$/, "");
  const scope = opts.scope ?? "home:read home:write orders:write";
  const resource = opts.resource ?? `${process.env.HEARTH_MCP_BASE ?? "http://localhost:4200"}/mcp`;
  const redirectUri = HOST_SIM.redirect_uris[0];

  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");

  const authorizeUrl = new URL(`${issuer}/authorize`);
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: HOST_SIM.client_id,
    redirect_uri: redirectUri,
    scope,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
  }).toString();

  const page = await fetch(authorizeUrl, { redirect: "manual" });
  if (page.status !== 200) {
    throw new Error(`GET /authorize returned ${page.status}: ${(await page.text()).slice(0, 200)}`);
  }
  const html = await page.text();

  const form = new URLSearchParams();
  for (const match of html.matchAll(HIDDEN_INPUT)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) form.set(unescapeHtml(name), unescapeHtml(value));
  }
  if (!form.has("code_challenge")) throw new Error("Sign-in page did not contain the expected hidden fields.");
  form.set("email", opts.email ?? DEMO_EMAIL);
  form.set("password", opts.password ?? DEMO_PASSWORD);
  form.set("decision", "approve");

  const approval = await fetch(`${issuer}/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    redirect: "manual",
  });
  const location = approval.headers.get("location");
  if (approval.status !== 302 || location === null) {
    throw new Error(`Sign-in was not accepted (POST /authorize returned ${approval.status}).`);
  }

  const callback = new URL(location);
  const error = callback.searchParams.get("error");
  if (error !== null) {
    throw new Error(`Authorization failed: ${error} ${callback.searchParams.get("error_description") ?? ""}`.trim());
  }
  if (callback.searchParams.get("state") !== state) throw new Error("State mismatch on authorization response.");
  const code = callback.searchParams.get("code");
  if (code === null) throw new Error("Authorization response did not include a code.");

  const exchange = await fetch(`${issuer}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: HOST_SIM.client_id,
      code_verifier: verifier,
    }),
  });
  const body: unknown = await exchange.json();
  if (!exchange.ok) throw new Error(`POST /token returned ${exchange.status}: ${JSON.stringify(body)}`);
  return TokenResponse.parse(body);
}
