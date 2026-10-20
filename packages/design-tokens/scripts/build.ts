import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cssText } from "../src/css";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "dist/tokens.css");
mkdirSync(dirname(out), { recursive: true });
const css = cssText();
writeFileSync(out, css, "utf8");
console.log(`design-tokens: wrote ${out} (${Buffer.byteLength(css)} bytes)`);
