/**
 * Traffic recording for the simulated Alexa+ host.
 *
 * The MCP SDK transport is handed a fetch wrapper (createRecordingFetch). Every JSON-RPC message that
 * leaves or enters the host is reported as a TrafficEvent, with timing and the HTTP status, so the
 * inspector shows genuine wire traffic. Responses may be plain JSON or Server-Sent Events; both are parsed.
 *
 * Browser-safe: only fetch, Headers, Response, TextDecoder and performance are used.
 */

export type TrafficEvent = {
  id: string;
  dir: "out" | "in";
  ts: number;
  method?: string;
  rpcId?: string | number;
  toolName?: string;
  body: unknown;
  ms?: number;
  status?: number;
  sessionId?: string;
};

/** Thrown when the MCP server answers HTTP 401. `resourceMetadata` is the RFC 9728 PRM URL when the body names one. */
export class UnauthorizedError extends Error {
  resourceMetadata?: string;
  constructor(message = "Unauthorized", resourceMetadata?: string) {
    super(message);
    this.name = "UnauthorizedError";
    this.resourceMetadata = resourceMetadata;
  }
}

export type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

/* ------------------------------------------------------------------ parsing */

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export interface SseMessage {
  event: string;
  data: string;
  id?: string;
}

/** Incremental Server-Sent Events parser (WHATWG rules: CRLF, LF and CR terminators, multi-line data, comments). */
export class SseParser {
  private buffer = "";
  private dataLines: string[] = [];
  private eventName: string | undefined;
  private lastId: string | undefined;

  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    // A trailing CR may be the first half of a CRLF; hold it until the next chunk.
    let held = "";
    if (this.buffer.endsWith("\r")) {
      held = "\r";
      this.buffer = this.buffer.slice(0, -1);
    }
    const parts = this.buffer.split(/\r\n|\n|\r/);
    this.buffer = (parts.pop() ?? "") + held;
    const out: SseMessage[] = [];
    for (const line of parts) this.consumeLine(line, out);
    return out;
  }

  /** Call when the stream ends: a final unterminated line is processed and a pending event is dispatched. */
  flush(): SseMessage[] {
    const out: SseMessage[] = [];
    if (this.buffer.length > 0) {
      this.consumeLine(this.buffer.replace(/\r$/, ""), out);
      this.buffer = "";
    }
    this.consumeLine("", out);
    return out;
  }

  private consumeLine(line: string, out: SseMessage[]): void {
    if (line === "") {
      if (this.dataLines.length > 0) {
        out.push({ event: this.eventName ?? "message", data: this.dataLines.join("\n"), id: this.lastId });
      }
      this.dataLines = [];
      this.eventName = undefined;
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") this.dataLines.push(value);
    else if (field === "event") this.eventName = value;
    else if (field === "id") this.lastId = value;
  }
}

/** Parse every SSE `data:` payload of a complete body as JSON; non-JSON payloads are skipped. */
export function parseSseBody(text: string): unknown[] {
  const parser = new SseParser();
  const messages = [...parser.push(text), ...parser.flush()];
  const out: unknown[] = [];
  for (const m of messages) {
    try {
      out.push(JSON.parse(m.data));
    } catch {
      // A data line that is not JSON (for example a keep-alive) carries no JSON-RPC message.
    }
  }
  return out;
}

/** Parse a complete response body into JSON-RPC messages, from either application/json or text/event-stream. */
export function parseRpcBody(contentType: string | null | undefined, text: string): unknown[] {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "text/event-stream") return parseSseBody(text);
  if (text.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

const isSse = (contentType: string | null): boolean => (contentType ?? "").toLowerCase().includes("text/event-stream");

const tryJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/* ------------------------------------------------------------------ recorder */

interface Pending {
  method: string;
  toolName?: string;
  t0: number;
}

export interface RecordingFetchOptions {
  getToken: () => string | null;
  onTraffic?: (e: TrafficEvent) => void;
  fetch?: FetchFn;
}

export interface RecordingFetch {
  fetch: FetchFn;
  readonly sessionId: string | undefined;
  /** protocolVersion from the initialize response, as seen on the wire. */
  readonly negotiatedProtocolVersion: string | undefined;
}

const mono = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

function resourceMetadataFrom(response: Response, body: unknown): string | undefined {
  if (isRecord(body) && typeof body.resource_metadata === "string") return body.resource_metadata;
  const header = response.headers.get("www-authenticate");
  const match = header ? /resource_metadata="?([^",\s]+)"?/i.exec(header) : null;
  return match?.[1];
}

export function createRecordingFetch(opts: RecordingFetchOptions): RecordingFetch {
  const baseFetch: FetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
  const prefix = Math.random().toString(36).slice(2, 6);
  let seq = 0;
  let sessionId: string | undefined;
  let protocolVersion: string | undefined;
  const pending = new Map<string | number, Pending>();

  const emit = (e: Omit<TrafficEvent, "id">): void => {
    seq += 1;
    opts.onTraffic?.({ id: `${prefix}-${seq}`, ...e });
  };

  const emitIn = (message: unknown, response: Response, fallback: Pending | undefined, fallbackRpcId: string | number | undefined): void => {
    const rec = isRecord(message) ? message : undefined;
    const serverMessage = typeof rec?.method === "string";
    const ownId = rec && (typeof rec.id === "string" || typeof rec.id === "number") ? rec.id : undefined;
    const rpcId = serverMessage ? ownId : (ownId ?? fallbackRpcId);
    const matched = serverMessage ? undefined : ((rpcId !== undefined ? pending.get(rpcId) : undefined) ?? fallback);
    const method = serverMessage ? (rec?.method as string) : matched?.method;
    if (!serverMessage && rpcId !== undefined) pending.delete(rpcId);
    if (rec && isRecord(rec.result) && matched?.method === "initialize" && typeof rec.result.protocolVersion === "string") {
      protocolVersion = rec.result.protocolVersion;
    }
    emit({
      dir: "in",
      ts: Date.now(),
      method,
      rpcId,
      toolName: matched?.toolName,
      body: message,
      ms: matched ? Math.round(mono() - matched.t0) : undefined,
      status: response.status,
      sessionId,
    });
  };

  const pump = async (response: Response, fallback: Pending | undefined, fallbackRpcId: string | number | undefined): Promise<void> => {
    const body = response.body;
    if (!body) return;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    const dispatch = (messages: SseMessage[]): void => {
      for (const m of messages) emitIn(tryJson(m.data), response, fallback, fallbackRpcId);
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        dispatch(parser.push(decoder.decode(value, { stream: true })));
      }
      dispatch(parser.push(decoder.decode()));
      dispatch(parser.flush());
    } catch {
      // The stream was aborted (client closed or navigation); nothing further to record.
    }
  };

  const recordingFetch: FetchFn = async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const token = opts.getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    else headers.delete("Authorization");

    const t0 = mono();
    const outgoing: unknown[] = [];
    let firstRequest: { rpcId: string | number; pending: Pending } | undefined;
    if (method === "POST" && typeof init?.body === "string") {
      const parsed = tryJson(init.body);
      for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
        outgoing.push(message);
        if (!isRecord(message)) continue;
        const rpcId = typeof message.id === "string" || typeof message.id === "number" ? message.id : undefined;
        const rpcMethod = typeof message.method === "string" ? message.method : undefined;
        const params = isRecord(message.params) ? message.params : undefined;
        const toolName = rpcMethod === "tools/call" && typeof params?.name === "string" ? params.name : undefined;
        if (rpcId !== undefined && rpcMethod !== undefined) {
          const p: Pending = { method: rpcMethod, toolName, t0 };
          pending.set(rpcId, p);
          firstRequest ??= { rpcId, pending: p };
        }
        emit({
          dir: "out",
          ts: Date.now(),
          method: rpcMethod,
          rpcId,
          toolName,
          body: message,
          sessionId: headers.get("mcp-session-id") ?? sessionId,
        });
      }
    }

    let response: Response;
    try {
      response = await baseFetch(input, { ...init, headers });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (outgoing.length > 0) {
        emit({
          dir: "in",
          ts: Date.now(),
          method: firstRequest?.pending.method,
          rpcId: firstRequest?.rpcId,
          toolName: firstRequest?.pending.toolName,
          body: { error: { code: "network", message } },
          ms: Math.round(mono() - t0),
          status: 0,
          sessionId,
        });
      }
      throw error;
    }

    const sid = response.headers.get("mcp-session-id");
    if (sid) sessionId = sid;

    const fallback = firstRequest?.pending;
    const fallbackId = firstRequest?.rpcId;
    const contentType = response.headers.get("content-type");

    if (response.status === 401) {
      const text = await response.clone().text();
      const body = tryJson(text);
      emitIn(body, response, fallback, fallbackId);
      throw new UnauthorizedError("MCP server returned 401 Unauthorized", resourceMetadataFrom(response, body));
    }

    if (!response.ok) {
      if (method === "GET" && response.status === 405) return response; // server offers no standalone SSE stream
      if (method === "DELETE") return response;
      const text = await response.clone().text();
      emitIn(tryJson(text), response, fallback, fallbackId);
      return response;
    }

    if (method === "DELETE" || response.status === 202 || response.status === 204) return response;

    if (isSse(contentType)) {
      void pump(response.clone(), fallback, fallbackId);
      return response;
    }

    const text = await response.clone().text();
    const messages = parseRpcBody(contentType, text);
    if (messages.length === 0 && text.trim() !== "") emitIn(text, response, fallback, fallbackId);
    for (const m of messages) emitIn(m, response, fallback, fallbackId);
    return response;
  };

  return {
    fetch: recordingFetch,
    get sessionId() {
      return sessionId;
    },
    get negotiatedProtocolVersion() {
      return protocolVersion;
    },
  };
}
