import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT, createLocalJWKSet, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { findClient } from "../src/clients";
import { resolveSigningKeys } from "../src/keys";

describe("HEARTH_AUTH_PRIVATE_JWK", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "fixed-kid", alg: "RS256", use: "sig" });

  it("is used as the signing key, is stable across restarts, and writes no key file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hearth-jwk-"));
    try {
      const first = resolveSigningKeys(dir, { HEARTH_AUTH_PRIVATE_JWK: jwk });
      const second = resolveSigningKeys(dir, { HEARTH_AUTH_PRIVATE_JWK: jwk });
      expect(first.kid).toBe("fixed-kid");
      expect(second.publicJwk).toEqual(first.publicJwk);
      expect(first.publicJwk).not.toHaveProperty("d");
      expect(readdirSync(dir)).toEqual([]);
      const token = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: first.kid }).sign(privateKey);
      await jwtVerify(token, createLocalJWKSet({ keys: [second.publicJwk] }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the thumbprint when the JWK has no kid", () => {
    const { kid: _kid, ...noKid } = JSON.parse(jwk) as Record<string, unknown>;
    const a = resolveSigningKeys("unused", { HEARTH_AUTH_PRIVATE_JWK: JSON.stringify(noKid) });
    const b = resolveSigningKeys("unused", { HEARTH_AUTH_PRIVATE_JWK: JSON.stringify(noKid) });
    expect(a.kid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b.kid).toBe(a.kid);
  });

  it("rejects malformed values instead of silently generating a new key", () => {
    expect(() => resolveSigningKeys("unused", { HEARTH_AUTH_PRIVATE_JWK: "not json" })).toThrow(/not valid JSON/);
    expect(() => resolveSigningKeys("unused", { HEARTH_AUTH_PRIVATE_JWK: JSON.stringify({ kty: "RSA" }) })).toThrow();
  });
});

describe("host-sim redirect registration", () => {
  const CLIENT = "alexa-plus-host-sim";
  const LOCAL = "http://localhost:3000/link/callback";

  it("keeps only the contract redirect when HEARTH_HOST_BASE is unset", () => {
    expect(findClient(CLIENT, {})?.redirect_uris).toEqual([LOCAL]);
  });

  it("also accepts ${HEARTH_HOST_BASE}/link/callback, exactly", () => {
    const uris = findClient(CLIENT, { HEARTH_HOST_BASE: "https://host.example.com/" })?.redirect_uris;
    expect(uris).toEqual([LOCAL, "https://host.example.com/link/callback"]);
  });

  it("does not register unlisted redirects, prefixes or lookalikes", () => {
    const uris = findClient(CLIENT, { HEARTH_HOST_BASE: "https://host.example.com" })?.redirect_uris ?? [];
    for (const bad of [
      "https://evil.example.com/link/callback",
      "https://host.example.com/link/callback/",
      "https://host.example.com/link/callback?x=1",
      "https://host.example.com.evil.test/link/callback",
      "https://host.example.com/other",
    ]) {
      expect(uris.includes(bad)).toBe(false);
    }
  });

  it("ignores a garbage HEARTH_HOST_BASE", () => {
    expect(findClient(CLIENT, { HEARTH_HOST_BASE: "not a url" })?.redirect_uris).toEqual([LOCAL]);
    expect(findClient(CLIENT, { HEARTH_HOST_BASE: "javascript:alert(1)" })?.redirect_uris).toEqual([LOCAL]);
  });
});
