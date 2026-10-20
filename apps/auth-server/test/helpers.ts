import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";
import { s256Challenge } from "../src/crypto";
import { loadOrCreateKeys, type SigningKeys } from "../src/keys";
import { loadUsers } from "../src/users";
import { DEFAULT_USERS_FILE } from "../src/paths";

export const CLIENT_ID = "alexa-plus-host-sim";
export const REDIRECT_URI = "http://localhost:3000/link/callback";
export const MCP_RESOURCE = "http://localhost:4200/mcp";
export const DEMO_EMAIL = "priya@okafor.example";
export const DEMO_PASSWORD = "okafor-demo-2026";

/** A controllable epoch-millisecond clock. */
export class TestClock {
  constructor(public current = Date.now()) {}
  readonly now = (): number => this.current;
  advance(ms: number): void {
    this.current += ms;
  }
}

export interface TestServer {
  readonly issuer: string;
  readonly dataDir: string;
  readonly keys: SigningKeys;
  readonly clock: TestClock;
  close(): Promise<void>;
}

let sharedKeys: { dir: string; keys: SigningKeys } | undefined;

/** RSA generation is slow enough to share across servers in one test file. */
function testKeys(): SigningKeys {
  if (sharedKeys === undefined) {
    const dir = mkdtempSync(join(tmpdir(), "hearth-keys-"));
    sharedKeys = { dir, keys: loadOrCreateKeys(dir) };
    process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  }
  return sharedKeys.keys;
}

export async function startServer(): Promise<TestServer> {
  const dataDir = mkdtempSync(join(tmpdir(), "hearth-data-"));
  const clock = new TestClock();
  const keys = testKeys();
  // Listen first so the issuer carries the real ephemeral port.
  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.on(
    "request",
    createApp({
      issuer,
      mcpResource: MCP_RESOURCE,
      hostBase: "http://localhost:3000",
      dataDir,
      keys,
      users: loadUsers(DEFAULT_USERS_FILE),
      now: clock.now,
    }),
  );
  return {
    issuer,
    dataDir,
    keys,
    clock,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          rmSync(dataDir, { recursive: true, force: true });
          if (error === undefined) resolve();
          else reject(error);
        });
        server.closeAllConnections();
      }),
  };
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

export function makePkce(verifier = "v".repeat(64)): Pkce {
  return { verifier, challenge: s256Challenge(verifier) };
}

export function authorizeQuery(pkce: Pkce, overrides: Record<string, string | undefined> = {}): URLSearchParams {
  const base: Record<string, string | undefined> = {
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "home:read home:write orders:write",
    state: "state-123",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    resource: MCP_RESOURCE,
    ...overrides,
  };
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(base)) if (value !== undefined) params.set(name, value);
  return params;
}

export function form(fields: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
    redirect: "manual",
  };
}

/** Signs in through POST /authorize and returns the raw response (a 302 on success). */
export function signIn(
  server: TestServer,
  query: URLSearchParams,
  credentials: { email?: string; password?: string; decision?: string } = {},
): Promise<Response> {
  const fields: Record<string, string> = Object.fromEntries(query.entries());
  fields.email = credentials.email ?? DEMO_EMAIL;
  fields.password = credentials.password ?? DEMO_PASSWORD;
  fields.decision = credentials.decision ?? "approve";
  return fetch(`${server.issuer}/authorize`, form(fields));
}

export async function obtainCode(server: TestServer, pkce: Pkce): Promise<string> {
  const response = await signIn(server, authorizeQuery(pkce));
  const code = new URL(response.headers.get("location") ?? "").searchParams.get("code");
  if (code === null) throw new Error("no code issued");
  return code;
}

export function exchangeCode(
  server: TestServer,
  code: string,
  verifier: string | undefined,
  overrides: Record<string, string> = {},
): Promise<Response> {
  const fields: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    ...overrides,
  };
  if (verifier !== undefined) fields.code_verifier = verifier;
  return fetch(`${server.issuer}/token`, form(fields));
}

export function refresh(server: TestServer, refreshToken: string, clientId = CLIENT_ID): Promise<Response> {
  return fetch(
    `${server.issuer}/token`,
    form({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }),
  );
}
