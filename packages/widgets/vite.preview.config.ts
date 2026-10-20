import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const uiDir = join(root, "dist", "ui");
const mediaDir = join(root, "media");

/** Serves the built widget HTML at /ui/* and the seed illustrations at /media/* (the real host reads both from the MCP server). */
function serveBuilt(): Plugin {
  const serve = (dir: string, type: (file: string) => string) => (req: { url?: string }, res: { statusCode: number; setHeader(k: string, v: string): void; end(body?: string): void } & NodeJS.WritableStream, next: () => void) => {
    const name = decodeURIComponent((req.url ?? "").split("?")[0] ?? "").replace(/^\/+/, "");
    const file = resolve(dir, name);
    if (!name || !file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) return next();
    res.setHeader("Content-Type", type(file));
    res.setHeader("Cache-Control", "no-store");
    createReadStream(file).pipe(res);
  };
  return {
    name: "hearth-serve-built",
    configureServer(server) {
      server.middlewares.use("/ui", serve(uiDir, (f) => (f.endsWith(".json") ? "application/json" : "text/html; charset=utf-8")));
      server.middlewares.use("/media", serve(mediaDir, () => "image/svg+xml"));
    },
  };
}

/** `pnpm --filter @hearth/widgets preview`: the widget matrix on http://localhost:4300 (3000, 4100 and 4200 belong to the app). */
export default defineConfig({
  root: join(root, "preview"),
  plugins: [serveBuilt()],
  server: { port: 4300, strictPort: true, host: "127.0.0.1", fs: { allow: [resolve(root, "../..")] } },
});
