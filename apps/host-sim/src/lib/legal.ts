import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * docs/PRIVACY.md and docs/TERMS.md live at the repo root and are written by another lane.
 * Read at request time (the pages are force-dynamic) so an edit shows up without a rebuild.
 * Returns null when the file is absent; the page then answers with a real 404.
 */
export async function readRepoDoc(file: "PRIVACY.md" | "TERMS.md"): Promise<string | null> {
  const candidates = [
    path.resolve(process.cwd(), "../../docs", file), // apps/host-sim -> repo root
    path.resolve(process.cwd(), "docs", file), // run from the repo root, or a container with docs copied in
  ];
  for (const p of candidates) {
    try {
      return await readFile(p, "utf8");
    } catch {
      /* try next */
    }
  }
  return null;
}
