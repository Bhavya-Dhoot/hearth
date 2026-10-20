import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AccessTokenClaims, AuthorizationServerMetadata, SCOPES, TokenResponse } from "@hearth/contracts";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify, type JSONWebKeySet } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CLIENT_ID,
  MCP_RESOURCE,
  REDIRECT_URI,
  authorizeQuery,
  exchangeCode,
  form,
  makePkce,
  obtainCode,
  refresh,
  signIn,
  startServer,
  type TestServer,
} from "./helpers";

let server: TestServer;
beforeAll(async () => {
  server = await startServer();
});
afterAll(async () => {
  await server.close();
});

const jsonBody = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>;

const redirectParams = (response: Response): URLSearchParams =>
  new URL(response.headers.get("location") ?? "http://invalid.example/").searchParams;

async function tokensFor(query = authorizeQuery(makePkce()), verifier = makePkce().verifier): Promise<TokenResponse> {
  const code = redirectParams(await signIn(server, query)).get("code");
  return TokenResponse.parse(await (await exchangeCode(server, code ?? "", verifier)).json());
}

describe("discovery", () => {
  it("serves RFC 8414 metadata matching the contract", async () => {
    const response = await fetch(`${server.issuer}/.well-known/oauth-authorization-server`);
    expect(response.status).toBe(200);
    const metadata = AuthorizationServerMetadata.parse(await response.json());
    expect(metadata).toEqual({
      issuer: server.issuer,
      authorization_endpoint: `${server.issuer}/authorize`,
      token_endpoint: `${server.issuer}/token`,
      jwks_uri: `${server.issuer}/.well-known/jwks.json`,
      scopes_supported: [...SCOPES],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  it("publishes one RS256 signing key without private parameters", async () => {
    const jwks = (await (await fetch(`${server.issuer}/.well-known/jwks.json`)).json()) as {
      keys: Record<string, unknown>[];
    };
    expect(jwks.keys).toHaveLength(1);
    const [key] = jwks.keys;
    expect(key).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig", kid: server.keys.kid });
    expect(key).not.toHaveProperty("d");
    expect(key).not.toHaveProperty("p");
  });
});

describe("authorization code flow", () => {
  it("issues a verifiable RS256 token with every claim, then rotates the refresh token", async () => {
    const pkce = makePkce();
    const page = await fetch(`${server.issuer}/authorize?${authorizeQuery(pkce)}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("Link Hearth to Alexa");

    const approval = await signIn(server, authorizeQuery(pkce));
    expect(approval.status).toBe(302);
    const callback = redirectParams(approval);
    expect(callback.get("state")).toBe("state-123");
    expect(new URL(approval.headers.get("location") ?? "").origin).toBe("http://localhost:3000");
    const code = callback.get("code");
    expect(code).toBeTruthy();

    const exchange = await exchangeCode(server, code ?? "", pkce.verifier);
    expect(exchange.status).toBe(200);
    expect(exchange.headers.get("cache-control")).toBe("no-store");
    const tokens = TokenResponse.parse(await exchange.json());
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.scope).toBe("home:read home:write orders:write");

    const jwks = createLocalJWKSet((await (await fetch(`${server.issuer}/.well-known/jwks.json`)).json()) as JSONWebKeySet);
    const { payload, protectedHeader } = await jwtVerify(tokens.access_token, jwks, {
      issuer: server.issuer,
      audience: MCP_RESOURCE,
      algorithms: ["RS256"],
      currentDate: new Date(server.clock.now()),
    });
    expect(protectedHeader).toMatchObject({ alg: "RS256", kid: server.keys.kid });
    const claims = AccessTokenClaims.parse(payload);
    const iat = Math.floor(server.clock.now() / 1000);
    expect(claims).toMatchObject({
      iss: server.issuer,
      sub: "usr_okafor",
      aud: MCP_RESOURCE,
      scope: "home:read home:write orders:write",
      client_id: CLIENT_ID,
      iat,
      exp: iat + 3600,
    });
    expect(claims.jti.length).toBeGreaterThan(8);

    // Refresh tokens are persisted only as digests.
    expect(readFileSync(join(server.dataDir, "refresh.json"), "utf8")).not.toContain(tokens.refresh_token);

    const rotated = await refresh(server, tokens.refresh_token);
    expect(rotated.status).toBe(200);
    const next = TokenResponse.parse(await rotated.json());
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(decodeProtectedHeader(next.access_token).kid).toBe(server.keys.kid);

    const replay = await refresh(server, tokens.refresh_token);
    expect(replay.status).toBe(400);
    expect(await jsonBody(replay)).toMatchObject({ error: "invalid_grant" });

    // The rotated token keeps working after the old one was rejected.
    expect((await refresh(server, next.refresh_token)).status).toBe(200);
  });

  it("defaults aud to the MCP resource when the resource parameter is something else", async () => {
    const tokens = await tokensFor(authorizeQuery(makePkce(), { resource: "https://elsewhere.example/mcp" }));
    const claims = AccessTokenClaims.parse(
      JSON.parse(Buffer.from(tokens.access_token.split(".")[1] ?? "", "base64url").toString()),
    );
    expect(claims.aud).toBe(MCP_RESOURCE);
  });

  it("limits the granted scope to what was requested", async () => {
    const tokens = await tokensFor(authorizeQuery(makePkce(), { scope: "home:read" }));
    expect(tokens.scope).toBe("home:read");
  });
});

describe("/authorize rejections", () => {
  it("redirects invalid_request when code_challenge is missing", async () => {
    const response = await fetch(
      `${server.issuer}/authorize?${authorizeQuery(makePkce(), { code_challenge: undefined })}`,
      { redirect: "manual" },
    );
    expect(response.status).toBe(302);
    const params = redirectParams(response);
    expect(params.get("error")).toBe("invalid_request");
    expect(params.get("state")).toBe("state-123");
    expect(params.has("code")).toBe(false);
  });

  it.each([
    ["plain", { code_challenge_method: "plain" }],
    ["missing method", { code_challenge_method: undefined }],
  ])("rejects PKCE method: %s", async (_name, overrides) => {
    const response = await fetch(`${server.issuer}/authorize?${authorizeQuery(makePkce(), overrides)}`, {
      redirect: "manual",
    });
    expect(response.status).toBe(302);
    expect(redirectParams(response).get("error")).toBe("invalid_request");
  });

  it("rejects response_type other than code", async () => {
    const response = await fetch(
      `${server.issuer}/authorize?${authorizeQuery(makePkce(), { response_type: "token" })}`,
      { redirect: "manual" },
    );
    expect(redirectParams(response).get("error")).toBe("unsupported_response_type");
  });

  it("rejects an unsupported scope", async () => {
    const response = await fetch(
      `${server.issuer}/authorize?${authorizeQuery(makePkce(), { scope: "home:read admin" })}`,
      { redirect: "manual" },
    );
    expect(redirectParams(response).get("error")).toBe("invalid_scope");
  });

  it("renders an error page, and never redirects, for an unregistered redirect_uri", async () => {
    const attempts = [
      "https://attacker.example/callback",
      `${REDIRECT_URI}/extra`,
      `${REDIRECT_URI}?next=1`,
    ];
    for (const redirect of attempts) {
      const query = authorizeQuery(makePkce(), { redirect_uri: redirect });
      const get = await fetch(`${server.issuer}/authorize?${query}`, { redirect: "manual" });
      expect(get.status).toBe(400);
      expect(get.headers.get("location")).toBeNull();
      expect(await get.text()).toContain("This link request cannot continue");

      const post = await signIn(server, query);
      expect(post.status).toBe(400);
      expect(post.headers.get("location")).toBeNull();
    }
  });

  it("renders an error page for an unknown client", async () => {
    const query = authorizeQuery(makePkce(), { client_id: "not-registered" });
    const response = await fetch(`${server.issuer}/authorize?${query}`, { redirect: "manual" });
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect((await signIn(server, query)).status).toBe(400);
  });

  it("returns access_denied to the client on Cancel", async () => {
    const response = await signIn(server, authorizeQuery(makePkce()), { decision: "deny", password: "" });
    expect(response.status).toBe(302);
    const params = redirectParams(response);
    expect(params.get("error")).toBe("access_denied");
    expect(params.get("state")).toBe("state-123");
    expect(params.has("code")).toBe(false);
  });

  it("re-renders with an inline error for a wrong password and issues no code", async () => {
    const response = await signIn(server, authorizeQuery(makePkce()), { password: "not-the-password" });
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    const html = await response.text();
    expect(html).toContain("That email and password do not match");
    expect(html).toContain('aria-invalid="true"');
    expect(html).not.toContain("not-the-password");
  });

  it("rejects an unknown email exactly like a wrong password", async () => {
    const response = await signIn(server, authorizeQuery(makePkce()), { email: "nobody@example.com" });
    expect(response.status).toBe(401);
    expect(await response.text()).toContain("That email and password do not match");
  });
});

describe("/token rejections", () => {
  it("rejects a wrong code_verifier with 400 invalid_grant", async () => {
    const code = await obtainCode(server, makePkce());
    const response = await exchangeCode(server, code, "w".repeat(64));
    expect(response.status).toBe(400);
    expect(await jsonBody(response)).toMatchObject({ error: "invalid_grant" });
  });

  it("rejects a missing code_verifier with 400 invalid_grant", async () => {
    const code = await obtainCode(server, makePkce());
    const response = await exchangeCode(server, code, undefined);
    expect(response.status).toBe(400);
    expect(await jsonBody(response)).toMatchObject({ error: "invalid_grant" });
  });

  it("rejects reuse of a code, even with the correct verifier", async () => {
    const pkce = makePkce();
    const code = await obtainCode(server, pkce);
    expect((await exchangeCode(server, code, pkce.verifier)).status).toBe(200);
    const second = await exchangeCode(server, code, pkce.verifier);
    expect(second.status).toBe(400);
    expect(await jsonBody(second)).toMatchObject({ error: "invalid_grant" });
  });

  it("burns a code after a failed attempt", async () => {
    const pkce = makePkce();
    const code = await obtainCode(server, pkce);
    expect((await exchangeCode(server, code, "w".repeat(64))).status).toBe(400);
    expect((await exchangeCode(server, code, pkce.verifier)).status).toBe(400);
  });

  it("rejects a redirect_uri that differs from the authorization request", async () => {
    const pkce = makePkce();
    const code = await obtainCode(server, pkce);
    const response = await exchangeCode(server, code, pkce.verifier, { redirect_uri: "http://localhost:3000/other" });
    expect(await jsonBody(response)).toMatchObject({ error: "invalid_grant" });
  });

  it("rejects an unknown client_id", async () => {
    const pkce = makePkce();
    const code = await obtainCode(server, pkce);
    const response = await exchangeCode(server, code, pkce.verifier, { client_id: "someone-else" });
    expect(response.status).toBe(400);
    expect(await jsonBody(response)).toMatchObject({ error: "invalid_client" });
  });

  it("rejects an expired code (60 s TTL, injected clock)", async () => {
    const pkce = makePkce();
    const code = await obtainCode(server, pkce);
    server.clock.advance(61_000);
    const response = await exchangeCode(server, code, pkce.verifier);
    expect(response.status).toBe(400);
    expect(await jsonBody(response)).toMatchObject({ error: "invalid_grant" });
  });

  it("accepts a code just inside the TTL", async () => {
    const pkce = makePkce();
    const code = await obtainCode(server, pkce);
    server.clock.advance(59_000);
    expect((await exchangeCode(server, code, pkce.verifier)).status).toBe(200);
  });

  it("rejects an expired refresh token (30 d TTL)", async () => {
    const tokens = await tokensFor();
    server.clock.advance(30 * 24 * 3600 * 1000 + 1000);
    expect((await refresh(server, tokens.refresh_token)).status).toBe(400);
  });

  it("rejects a refresh token presented by a different client without consuming it", async () => {
    const tokens = await tokensFor();
    expect((await refresh(server, tokens.refresh_token, "someone-else")).status).toBe(400);
    expect((await refresh(server, tokens.refresh_token)).status).toBe(200);
  });

  it("returns RFC 6749 errors for malformed requests", async () => {
    const noGrant = await fetch(`${server.issuer}/token`, form({ client_id: CLIENT_ID }));
    expect(await jsonBody(noGrant)).toMatchObject({ error: "invalid_request" });
    const badGrant = await fetch(`${server.issuer}/token`, form({ grant_type: "password", client_id: CLIENT_ID }));
    expect(await jsonBody(badGrant)).toMatchObject({ error: "unsupported_grant_type" });
    const jsonPost = await fetch(`${server.issuer}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code" }),
    });
    expect(jsonPost.status).toBe(400);
    expect(await jsonBody(jsonPost)).toMatchObject({ error: "invalid_request" });
  });
});

describe("CORS", () => {
  it.each(["http://localhost:3000", "http://localhost:5173"])("allows %s on /token and discovery", async (origin) => {
    const preflight = await fetch(`${server.issuer}/token`, {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
    const metadata = await fetch(`${server.issuer}/.well-known/oauth-authorization-server`, {
      headers: { Origin: origin },
    });
    expect(metadata.headers.get("access-control-allow-origin")).toBe(origin);
  });

  it("does not grant other origins", async () => {
    const response = await fetch(`${server.issuer}/token`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
