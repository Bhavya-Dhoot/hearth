/** Structured JSON logging. Callers never pass tokens; see `redactPath` for URL secrets. */
export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

type Level = "info" | "warn" | "error";

export function createJsonLogger(write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): Logger {
  const emit = (level: Level, msg: string, fields?: Record<string, unknown>): void => {
    write(JSON.stringify({ ts: new Date().toISOString(), level, service: "hearth-mcp", msg, ...fields }));
  };
  return {
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}

export const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** Public capability URLs carry a secret in the path; never log it. */
export function redactPath(path: string): string {
  return path
    .replace(/^\/briefs\/[^/]+/, "/briefs/:token")
    .replace(/^\/receipts\/[^/]+/, "/receipts/:orderId")
    .replace(/^\/outbox\/[^/]+/, "/outbox/:file");
}
