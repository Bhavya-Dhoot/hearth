import http from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { WidgetName } from "@hearth/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from "jose";
import { createApp, type HearthApp } from "../../src/app";
import { createJwtVerifier } from "../../src/auth/jwt";
import { silentLogger } from "../../src/log";
import type { PartsApi } from "@hearth/contracts";
import type { PaymentGateway } from "../../src/services/payments";
import { fakeParts } from "./fakeParts";
import { fakePlaybooks } from "./fakePlaybooks";
import { MemoryRepo } from "./memoryRepo";
import { NOW, OKAFOR, seedOkafor } from "./seed";

export const ISSUER = "http://localhost:4100";
export const ALL_SCOPES = "home:read home:write orders:write";

const keys = await generateKeyPair("RS256", { extractable: true });
const publicJwk: JWK = { ...(await exportJWK(keys.publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
const otherKeys = await generateKeyPair("RS256");

export interface MintOptions {
  sub?: string;
  scope?: string;
  audience?: string;
  issuer?: string;
  expiresIn?: string;
  /** Sign with a key the server does not trust. */
  untrustedKey?: boolean;
}

export interface Harness {
  base: string;
  repo: MemoryRepo;
  outboxDir: string;
  widgetsDir: string;
  hearth: HearthApp;
  mint(opts?: MintOptions): Promise<string>;
  connect(token?: string): Promise<Client>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  now?: () => Date;
  noWidgets?: boolean;
  payments?: PaymentGateway;
  parts?: PartsApi;
  /** Replaces the default Okafor fixture. */
  seed?: (repo: MemoryRepo, mcpBase: string) => Promise<void>;
}

function writeWidgets(dir: string): void {
  const widgets: Record<string, { file: string; uri: string; hash: string; bytes: number }> = {};
  for (const [i, name] of WidgetName.options.entries()) {
    const hash = (0x9f3c1a + i).toString(16);
    const file = `${name}-${hash}.html`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title></head><body data-widget="${name}"></body></html>`;
    writeFileSync(path.join(dir, file), html);
    widgets[name] = { file, uri: `ui://hearth/${file}`, hash, bytes: html.length };
  }
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ widgets }));
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const root = mkdtempSync(path.join(tmpdir(), "hearth-mcp-"));
  const widgetsDir = path.join(root, "ui");
  const mediaDir = path.join(root, "media");
  const outboxDir = path.join(root, "outbox");
  mkdirSync(widgetsDir);
  mkdirSync(mediaDir);
  if (!options.noWidgets) writeWidgets(widgetsDir);
  writeFileSync(path.join(mediaDir, "kitchen-sink-shutoffs.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"/>');

  // The public base URL has to be known before the app is built, so bind the socket first.
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const repo = new MemoryRepo();
  await (options.seed ?? seedOkafor)(repo, base);

  const hearth = createApp({
    repo,
    playbooks: fakePlaybooks,
    parts: options.parts ?? fakeParts,
    widgetsDir,
    mediaDir,
    outboxDir,
    mcpBase: base,
    authIssuer: ISSUER,
    hostBase: "http://localhost:3000",
    now: options.now ?? (() => NOW),
    logger: silentLogger,
    verifyToken: createJwtVerifier({ issuer: ISSUER, audience: `${base}/mcp`, keys: createLocalJWKSet({ keys: [publicJwk] }) }),
    ...(options.payments ? { payments: options.payments } : {}),
  });
  server.on("request", hearth.app);

  const mint = async (opts: MintOptions = {}): Promise<string> => {
    const key = opts.untrustedKey ? otherKeys.privateKey : keys.privateKey;
    return new SignJWT({ scope: opts.scope ?? ALL_SCOPES, client_id: "alexa-plus-host-sim" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject(opts.sub ?? OKAFOR)
      .setIssuer(opts.issuer ?? ISSUER)
      .setAudience(opts.audience ?? `${base}/mcp`)
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? "1h")
      .setJti(`jti-${Math.random().toString(16).slice(2)}`)
      .sign(key);
  };

  const clients: Client[] = [];
  const connect = async (token?: string): Promise<Client> => {
    const bearer = token ?? (await mint());
    const client = new Client({ name: "hearth-test-client", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } }));
    clients.push(client);
    return client;
  };

  return {
    base,
    repo,
    outboxDir,
    widgetsDir,
    hearth,
    mint,
    connect,
    async close() {
      await Promise.allSettled(clients.map((c) => c.close()));
      await hearth.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    },
  };
}

