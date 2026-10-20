import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of apps/auth-server, independent of the process working directory. */
export const AUTH_SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_KEYS_DIR = resolve(AUTH_SERVER_ROOT, ".keys");
export const DEFAULT_DATA_DIR = resolve(AUTH_SERVER_ROOT, ".data");
export const DEFAULT_USERS_FILE = resolve(AUTH_SERVER_ROOT, "seed", "users.json");
