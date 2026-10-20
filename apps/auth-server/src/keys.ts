import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JWK } from "jose";
import { z } from "zod";

export interface SigningKeys {
  readonly kid: string;
  /** Full RSA private JWK, used only to sign access tokens. */
  readonly privateJwk: JWK;
  /** Public half published at /.well-known/jwks.json. */
  readonly publicJwk: JWK;
}

const KEY_FILE = "signing-key.json";

const StoredKey = z.object({
  kid: z.string().min(1),
  privateJwk: z.object({
    kty: z.literal("RSA"),
    n: z.string(),
    e: z.string(),
    d: z.string(),
    p: z.string(),
    q: z.string(),
    dp: z.string(),
    dq: z.string(),
    qi: z.string(),
  }),
});

/** RFC 7638 thumbprint for an RSA key: SHA-256 over the canonical {e,kty,n} JSON. */
function thumbprint(n: string, e: string): string {
  const canonical = JSON.stringify({ e, kty: "RSA", n });
  return createHash("sha256").update(canonical).digest("base64url");
}

function build(kid: string, privateJwk: z.infer<typeof StoredKey>["privateJwk"]): SigningKeys {
  return {
    kid,
    privateJwk: { ...privateJwk, kid, alg: "RS256", use: "sig" },
    publicJwk: { kty: "RSA", n: privateJwk.n, e: privateJwk.e, kid, alg: "RS256", use: "sig" },
  };
}

/**
 * Loads the RS256 key pair from `dir`, generating and persisting it on first use.
 * The directory is gitignored; the private key never leaves this process except via the file.
 */
export function loadOrCreateKeys(dir: string): SigningKeys {
  const file = join(dir, KEY_FILE);
  if (existsSync(file)) {
    const stored = StoredKey.parse(JSON.parse(readFileSync(file, "utf8")));
    return build(stored.kid, stored.privateJwk);
  }
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const exported = privateKey.export({ format: "jwk" });
  const parsed = StoredKey.shape.privateJwk.parse(exported);
  const kid = thumbprint(parsed.n, parsed.e);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ kid, privateJwk: parsed }, null, 2), { mode: 0o600 });
  return build(kid, parsed);
}

/**
 * Signing keys for the running service. When `HEARTH_AUTH_PRIVATE_JWK` is set (a private RSA JWK as JSON,
 * see infra/cdk/scripts/gen-auth-jwk.mjs) it is used as is, so keys survive container restarts and are
 * shared across tasks. Otherwise falls back to the file-backed key in `dir`.
 */
export function resolveSigningKeys(dir: string, env: Record<string, string | undefined> = process.env): SigningKeys {
  const raw = env.HEARTH_AUTH_PRIVATE_JWK?.trim();
  if (raw === undefined || raw === "") return loadOrCreateKeys(dir);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("HEARTH_AUTH_PRIVATE_JWK is not valid JSON (expected a private RSA JWK).");
  }
  const privateJwk = StoredKey.shape.privateJwk.parse(json);
  const kid = (json as { kid?: unknown }).kid;
  return build(typeof kid === "string" && kid !== "" ? kid : thumbprint(privateJwk.n, privateJwk.e), privateJwk);
}
