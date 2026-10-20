import path from "node:path";
import { fileURLToPath } from "node:url";
import { urlsFromEnv } from "@hearth/contracts";
import { createRepo, loadSeed } from "@hearth/home-graph";
import { parts } from "@hearth/parts-catalog";
import { playbooks } from "@hearth/playbooks";
import { createApp, DEFAULT_OUTBOX_DIR } from "./app";
import { createJwtVerifier, remoteKeys } from "./auth/jwt";
import { createJsonLogger } from "./log";
import { createOutboxEmail, createResendEmail, type EmailService } from "./services/email";
import { gatewayFromEnv } from "./services/payments";

const SEED_USER = "usr_okafor";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

async function main(): Promise<void> {
  const env = process.env;
  const logger = createJsonLogger();
  const urls = urlsFromEnv(env);
  const port = Number(env.PORT ?? 4200);
  const mode = env.HEARTH_DDB_TABLE ? `dynamodb:${env.HEARTH_DDB_TABLE}` : "memory-file";

  const repo = createRepo(
    env.HEARTH_DDB_TABLE
      ? { tableName: env.HEARTH_DDB_TABLE }
      : { dataFile: env.HEARTH_DATA_FILE ?? path.join(packageRoot, ".data", "home-graph.json") },
  );

  // HEARTH_SEED=1 always loads the Okafor house, 0 never does. Unset: load it only when it is missing.
  const seedSetting = env.HEARTH_SEED?.toLowerCase();
  const forceSeed = seedSetting === "1" || seedSetting === "true";
  const skipSeed = seedSetting === "0" || seedSetting === "false";
  if (forceSeed || (!skipSeed && (await repo.getHomeForUser(SEED_USER)) === null)) {
    await loadSeed(repo, { mcpBase: urls.mcpBase, now: new Date() });
    logger.info("seed_loaded", { user: SEED_USER });
  }

  const outbox = createOutboxEmail(env.HEARTH_OUTBOX_DIR ?? DEFAULT_OUTBOX_DIR, env.HEARTH_EMAIL_FROM ?? "Hearth <orders@hearth.example>", () => new Date());
  const email: EmailService = env.RESEND_API_KEY
    ? createResendEmail(env.RESEND_API_KEY, env.HEARTH_EMAIL_FROM ?? "Hearth <onboarding@resend.dev>", outbox, logger)
    : outbox;
  const recipient = env.HEARTH_EMAIL_TO;

  const { app, close } = createApp({
    repo,
    playbooks,
    parts,
    widgetsDir: env.HEARTH_WIDGETS_DIR ?? path.join(repoRoot, "packages", "widgets", "dist", "ui"),
    mediaDir: env.HEARTH_MEDIA_DIR ?? path.join(repoRoot, "packages", "widgets", "media"),
    verifyToken: createJwtVerifier({
      issuer: urls.authIssuer,
      audience: urls.mcpResource,
      keys: remoteKeys(env.HEARTH_AUTH_JWKS_URL ?? `${urls.authIssuer}/.well-known/jwks.json`),
    }),
    mcpBase: urls.mcpBase,
    authIssuer: urls.authIssuer,
    hostBase: urls.hostBase,
    outboxDir: env.HEARTH_OUTBOX_DIR ?? DEFAULT_OUTBOX_DIR,
    email,
    payments: gatewayFromEnv(env.STRIPE_SECRET_KEY, logger),
    logger,
    ...(recipient ? { defaultRecipient: () => recipient } : {}),
  });

  const server = app.listen(port, () => {
    logger.info("listening", {
      port,
      mcp: urls.mcpResource,
      issuer: urls.authIssuer,
      store: mode,
      payments: env.STRIPE_SECRET_KEY ? "stripe_test" : "simulated",
      email: env.RESEND_API_KEY ? "resend" : "outbox",
    });
  });

  const shutdown = (signal: string): void => {
    logger.info("shutting_down", { signal });
    server.close(() => void close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  process.stderr.write(`${JSON.stringify({ level: "error", msg: "boot_failed", message: err instanceof Error ? err.message : String(err) })}\n`);
  process.exit(1);
});
