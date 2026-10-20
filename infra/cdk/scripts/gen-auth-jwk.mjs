// Prints a fresh RS256 private JWK (JSON) for HEARTH_AUTH_PRIVATE_JWK. Uses node:crypto only.
//   node scripts/gen-auth-jwk.mjs > jwk.json
//   aws secretsmanager put-secret-value --secret-id hearth/HEARTH_AUTH_PRIVATE_JWK --secret-string file://jwk.json
import { createHash, generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = privateKey.export({ format: "jwk" });
const kid = createHash("sha256").update(JSON.stringify({ e: jwk.e, kty: "RSA", n: jwk.n })).digest("base64url");
process.stdout.write(JSON.stringify({ ...jwk, kid, alg: "RS256", use: "sig" }));
