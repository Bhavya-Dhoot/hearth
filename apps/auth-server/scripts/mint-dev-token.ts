import { SCOPES, urlsFromEnv } from "@hearth/contracts";
import { loadOrCreateKeys } from "../src/keys";
import { DEFAULT_KEYS_DIR } from "../src/paths";
import { signAccessToken } from "../src/tokens";

/** Prints a 1 hour access token for the demo user. Nothing else is written to stdout. */
const urls = urlsFromEnv();
const token = await signAccessToken(loadOrCreateKeys(DEFAULT_KEYS_DIR), {
  issuer: urls.authIssuer,
  userId: "usr_okafor",
  audience: urls.mcpResource,
  scope: SCOPES.join(" "),
  clientId: "hearth-dev-token",
  now: Date.now(),
});
process.stdout.write(`${token}\n`);
