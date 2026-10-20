import { randomBytes, scrypt } from "node:crypto";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { z } from "zod";
import { safeEqual } from "./crypto";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const HEX = /^[0-9a-f]+$/;

export const UserRecord = z.object({
  userId: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  /** scrypt (N=16384, r=8, p=1, 64 bytes) of the password, hex. */
  passwordHash: z.string().regex(HEX),
  /** Per-user salt, hex. */
  salt: z.string().regex(HEX),
});
export type UserRecord = z.infer<typeof UserRecord>;

const UsersFile = z.object({ users: z.array(UserRecord).min(1) });

export function loadUsers(file: string): UserRecord[] {
  return UsersFile.parse(JSON.parse(readFileSync(file, "utf8"))).users;
}

export async function hashPassword(password: string, saltHex: string): Promise<string> {
  const derived = await scryptAsync(password.normalize("NFKC"), Buffer.from(saltHex, "hex"), KEY_LENGTH);
  return derived.toString("hex");
}

/** Creates a new salt and hash, used to produce seed records. */
export async function createPasswordRecord(
  password: string,
): Promise<{ passwordHash: string; salt: string }> {
  const salt = randomBytes(16).toString("hex");
  return { salt, passwordHash: await hashPassword(password, salt) };
}

const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Returns the user when email and password match. Always performs one scrypt derivation so
 * response time does not reveal whether an email is registered.
 */
export async function verifyCredentials(
  users: readonly UserRecord[],
  email: string,
  password: string,
): Promise<UserRecord | undefined> {
  const wanted = normaliseEmail(email);
  const user = users.find((candidate) => normaliseEmail(candidate.email) === wanted);
  const salt = user?.salt ?? "00000000000000000000000000000000";
  const derived = await hashPassword(password, salt);
  if (user === undefined) return undefined;
  return safeEqual(derived, user.passwordHash) ? user : undefined;
}
