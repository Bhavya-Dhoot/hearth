import { fileURLToPath } from "node:url";

/** Repo root (this file lives in infra/cdk/lib). Docker build context for every image. */
export const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
