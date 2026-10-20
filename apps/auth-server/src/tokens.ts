import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import type { SigningKeys } from "./keys";
import { ACCESS_TTL_S } from "./stores";

export interface AccessTokenInput {
  readonly issuer: string;
  readonly userId: string;
  readonly audience: string;
  readonly scope: string;
  readonly clientId: string;
  /** Epoch milliseconds. */
  readonly now: number;
}

/** Signs a 1 hour RS256 access token carrying iss, sub, aud, scope, client_id, iat, exp, jti. */
export function signAccessToken(keys: SigningKeys, input: AccessTokenInput): Promise<string> {
  const iat = Math.floor(input.now / 1000);
  return new SignJWT({ scope: input.scope, client_id: input.clientId })
    .setProtectedHeader({ alg: "RS256", kid: keys.kid })
    .setIssuer(input.issuer)
    .setSubject(input.userId)
    .setAudience(input.audience)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TTL_S)
    .setJti(randomUUID())
    .sign(keys.privateJwk);
}
