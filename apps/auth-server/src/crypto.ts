import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** URL-safe random token with `bytes` bytes of entropy. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

export const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");

/** PKCE S256: BASE64URL(SHA256(verifier)). */
export const s256Challenge = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
