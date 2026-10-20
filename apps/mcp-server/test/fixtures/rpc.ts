/** Raw JSON-RPC over fetch, for tests that must see headers and status codes the SDK client hides. */

export interface RpcResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === "") return null;
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const data = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter((l) => l !== "");
    const last = data[data.length - 1];
    return last ? (JSON.parse(last) as unknown) : null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function rpc(base: string, opts: { token?: string; sessionId?: string; body: unknown; method?: string }): Promise<RpcResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.sessionId) {
    headers["Mcp-Session-Id"] = opts.sessionId;
    headers["Mcp-Protocol-Version"] = "2025-11-25";
  }
  const res = await fetch(`${base}/mcp`, { method: opts.method ?? "POST", headers, body: opts.method === "DELETE" ? undefined : JSON.stringify(opts.body) });
  return { status: res.status, headers: res.headers, body: await readBody(res) };
}

export const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "raw-test", version: "1" } },
} as const;

export async function rest(base: string, path: string, opts: { token?: string; method?: string; body?: unknown } = {}): Promise<{ status: number; headers: Headers; body: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? "GET",
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  return { status: res.status, headers: res.headers, body: await readBody(res) };
}
