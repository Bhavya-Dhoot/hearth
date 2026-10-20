import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { randomToken, sha256Hex } from "./crypto";

export const CODE_TTL_MS = 60_000;
export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;

export type Clock = () => number;

/** Everything an authorization code is bound to (RFC 6749 4.1.3, RFC 7636, RFC 8707). */
export interface AuthorizationGrant {
  readonly userId: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly scope: string;
  readonly resource: string;
}

interface StoredCode extends AuthorizationGrant {
  readonly expiresAt: number;
}

/** Single-use authorization codes, held in memory for 60 seconds. */
export class CodeStore {
  private readonly codes = new Map<string, StoredCode>();

  constructor(private readonly now: Clock) {}

  issue(grant: AuthorizationGrant): string {
    this.sweep();
    const code = randomToken(32);
    this.codes.set(code, { ...grant, expiresAt: this.now() + CODE_TTL_MS });
    return code;
  }

  /** Removes the code on first presentation, whether or not the caller then succeeds. */
  consume(code: string): AuthorizationGrant | undefined {
    const stored = this.codes.get(code);
    if (stored === undefined) return undefined;
    this.codes.delete(code);
    return stored.expiresAt > this.now() ? stored : undefined;
  }

  private sweep(): void {
    const now = this.now();
    for (const [code, stored] of this.codes) {
      if (stored.expiresAt <= now) this.codes.delete(code);
    }
  }
}

export interface RefreshGrant {
  readonly userId: string;
  readonly clientId: string;
  readonly scope: string;
  readonly resource: string;
}

const StoredRefresh = z.object({
  userId: z.string(),
  clientId: z.string(),
  scope: z.string(),
  resource: z.string(),
  expiresAt: z.number(),
});
type StoredRefresh = z.infer<typeof StoredRefresh>;

const RefreshFile = z.object({ tokens: z.record(z.string(), StoredRefresh) });

/**
 * Opaque refresh tokens, 30 days, rotated on every use. Only SHA-256 digests are persisted
 * (dataDir/refresh.json), so the file alone cannot be replayed.
 */
export class RefreshStore {
  private readonly file: string;
  private readonly tokens = new Map<string, StoredRefresh>();

  constructor(
    dataDir: string,
    private readonly now: Clock,
  ) {
    this.file = join(dataDir, "refresh.json");
    if (existsSync(this.file)) {
      const parsed = RefreshFile.parse(JSON.parse(readFileSync(this.file, "utf8")));
      for (const [digest, record] of Object.entries(parsed.tokens)) this.tokens.set(digest, record);
    }
  }

  issue(grant: RefreshGrant): string {
    const token = randomToken(32);
    this.tokens.set(sha256Hex(token), { ...grant, expiresAt: this.now() + REFRESH_TTL_MS });
    this.persist();
    return token;
  }

  /**
   * Validates `token` for `clientId` and invalidates it. A token presented by the wrong client
   * is left untouched; an expired token is removed.
   */
  rotate(token: string, clientId: string): RefreshGrant | undefined {
    const digest = sha256Hex(token);
    const stored = this.tokens.get(digest);
    if (stored === undefined || stored.clientId !== clientId) return undefined;
    this.tokens.delete(digest);
    this.persist();
    if (stored.expiresAt <= this.now()) return undefined;
    return { userId: stored.userId, clientId: stored.clientId, scope: stored.scope, resource: stored.resource };
  }

  private persist(): void {
    const now = this.now();
    for (const [digest, record] of this.tokens) {
      if (record.expiresAt <= now) this.tokens.delete(digest);
    }
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ tokens: Object.fromEntries(this.tokens) }, null, 2), {
      mode: 0o600,
    });
    renameSync(tmp, this.file);
  }
}
