import { randomBytes } from "node:crypto";
import type { Asset, Home, HomeRepository, PartsApi, PlaybooksApi } from "@hearth/contracts";
import type { z } from "zod";
import type { Logger } from "../log";
import { isoDateIn } from "./dates";
import { lcFirst } from "./format";
import type { EmailService } from "./email";
import { KeyedLock } from "./lock";
import type { PaymentGateway } from "./payments";

/** Everything a service needs. Built once per app. */
export interface Core {
  repo: HomeRepository;
  playbooks: PlaybooksApi;
  parts: PartsApi;
  /** Public base URL of this server, e.g. http://localhost:4200 */
  mcpBase: string;
  now: () => Date;
  logger: Logger;
  locks: KeyedLock;
  email: EmailService;
  payments: PaymentGateway;
  /** Fallback recipient when the access token carries no email claim. */
  defaultRecipient: (userId: string) => string;
}

/** The authenticated customer and their home, resolved once per request. */
export interface Ctx {
  userId: string;
  home: Home;
  email?: string;
}

export const newId = (prefix: string): string => `${prefix}_${randomBytes(6).toString("hex")}`;
export const newToken = (bytes = 18): string => randomBytes(bytes).toString("base64url");

/** Today's calendar date in the home's time zone. */
export const todayFor = (core: Core, home: Home): string => isoDateIn(core.now(), home.timezone);

/**
 * Run `fn` at most once per (user, scope, key). A repeat returns the stored result.
 * Concurrent duplicates are serialised, so a retry that overlaps the original cannot run twice.
 */
export async function once<T>(core: Core, userId: string, scope: string, key: string, schema: z.ZodType<T>, fn: () => Promise<T>): Promise<T> {
  const storeKey = `${scope}:${key}`;
  return core.locks.run(`${userId}|${storeKey}`, async () => {
    const stored = await core.repo.getIdempotent(userId, storeKey);
    if (stored !== null && stored !== undefined) {
      const parsed = schema.safeParse(stored);
      if (parsed.success) return parsed.data;
    }
    const result = await fn();
    await core.repo.putIdempotent(userId, storeKey, result);
    return result;
  });
}

/** Asset that is the subject of a playbook, matched by category. */
export const assetByCategory = (assets: Asset[], category: string | undefined): Asset | undefined =>
  category === undefined ? undefined : assets.find((a) => a.category === category);

/** "Garage, left of the panel" */
export const locationText = (a: Asset): string => (a.location.note ? `${a.location.room}, ${lcFirst(a.location.note)}` : a.location.room);
