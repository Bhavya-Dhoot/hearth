import { describe, expect, it } from "vitest";
import { createRecordingFetch, parseRpcBody, parseSseBody, SseParser, UnauthorizedError, type TrafficEvent } from "../src";

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

const sse = (chunks: string[], init: ResponseInit = {}): Response => {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" }, ...init });
};

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const tick = () => new Promise<void>((r) => setTimeout(r, 20));

describe("SSE parsing", () => {
  it("parses events across arbitrary chunk boundaries, CRLF included", () => {
    const p = new SseParser();
    const got = [
      ...p.push("event: message\r"),
      ...p.push('\ndata: {"a":'),
      ...p.push("1}\r\n\r\n: keep-alive\n"),
      ...p.push("data: first\ndata: second\n\n"),
      ...p.flush(),
    ];
    expect(got).toEqual([
      { event: "message", data: '{"a":1}', id: undefined },
      { event: "message", data: "first\nsecond", id: undefined },
    ]);
  });

  it("flushes a final event that lacks the closing blank line", () => {
    const p = new SseParser();
    expect([...p.push('id: 7\ndata: {"x":true}'), ...p.flush()]).toEqual([{ event: "message", data: '{"x":true}', id: "7" }]);
  });

  it("extracts JSON-RPC messages from SSE, JSON, batches and junk", () => {
    expect(parseSseBody('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\ndata: not json\n\n')).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);
    expect(parseRpcBody("application/json; charset=utf-8", '{"id":1}')).toEqual([{ id: 1 }]);
    expect(parseRpcBody("application/json", '[{"id":1},{"id":2}]')).toEqual([{ id: 1 }, { id: 2 }]);
    expect(parseRpcBody("text/event-stream", 'data: {"id":3}\n\n')).toEqual([{ id: 3 }]);
    expect(parseRpcBody("application/json", "<html>")).toEqual([]);
    expect(parseRpcBody(null, "")).toEqual([]);
  });
});

describe("recording fetch", () => {
  it("records a JSON round trip with timing, status, session id and the negotiated protocol version", async () => {
    const events: TrafficEvent[] = [];
    let seenAuth: string | null = null;
    const rec = createRecordingFetch({
      getToken: () => "tok_123",
      onTraffic: (e) => events.push(e),
      fetch: async (_url, init) => {
        seenAuth = new Headers(init?.headers).get("authorization");
        await tick();
        return json(
          { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-11-25", serverInfo: { name: "hearth" } } },
          { headers: { "content-type": "application/json", "mcp-session-id": "sess-1" } },
        );
      },
    });
    await rec.fetch("http://x/mcp", post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
    expect(seenAuth).toBe("Bearer tok_123");
    expect(events.map((e) => [e.dir, e.method, e.rpcId, e.status])).toEqual([
      ["out", "initialize", 1, undefined],
      ["in", "initialize", 1, 200],
    ]);
    expect(events[1]?.ms).toBeGreaterThanOrEqual(15);
    expect(events[1]?.sessionId).toBe("sess-1");
    expect(rec.sessionId).toBe("sess-1");
    expect(rec.negotiatedProtocolVersion).toBe("2025-11-25");
    expect(new Set(events.map((e) => e.id)).size).toBe(2);
  });

  it("records tools/call with the tool name and parses an SSE response with a notification first", async () => {
    const events: TrafficEvent[] = [];
    const rec = createRecordingFetch({
      getToken: () => null,
      onTraffic: (e) => events.push(e),
      fetch: async (_url, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBeNull();
        return sse([
          'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}\n\n',
          'event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"content":[]}}\n',
          "\n",
        ]);
      },
    });
    await rec.fetch("http://x/mcp", post({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "triage_issue", arguments: { symptomText: "leak" } } }));
    await tick();
    expect(events.map((e) => [e.dir, e.method, e.toolName])).toEqual([
      ["out", "tools/call", "triage_issue"],
      ["in", "notifications/progress", undefined],
      ["in", "tools/call", "triage_issue"],
    ]);
    expect(events[1]?.ms).toBeUndefined();
    expect(events[2]?.ms).toBeTypeOf("number");
    expect(events[2]?.rpcId).toBe(7);
  });

  it("reads the SSE body without consuming the copy the SDK reads", async () => {
    const rec = createRecordingFetch({ getToken: () => null, fetch: async () => sse(['data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n']) });
    const res = await rec.fetch("http://x/mcp", post({ jsonrpc: "2.0", id: 1, method: "ping" }));
    expect(await res.text()).toContain('"ok":true');
  });

  it("records one out event per message of a batch", async () => {
    const events: TrafficEvent[] = [];
    const rec = createRecordingFetch({ getToken: () => null, onTraffic: (e) => events.push(e), fetch: async () => new Response(null, { status: 202 }) });
    await rec.fetch("http://x/mcp", post([{ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "ping" }]));
    expect(events.map((e) => [e.dir, e.method, e.rpcId])).toEqual([
      ["out", "notifications/initialized", undefined],
      ["out", "ping", 2],
    ]);
  });

  it("shows a 401 as an event and throws UnauthorizedError with the resource metadata URL", async () => {
    const events: TrafficEvent[] = [];
    const rec = createRecordingFetch({
      getToken: () => null,
      onTraffic: (e) => events.push(e),
      fetch: async () =>
        json({ error: "unauthorized", error_description: "Missing token", resource_metadata: "http://localhost:4200/.well-known/oauth-protected-resource" }, { status: 401 }),
    });
    const err = await rec.fetch("http://x/mcp", post({ jsonrpc: "2.0", id: 1, method: "initialize" })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect((err as UnauthorizedError).resourceMetadata).toBe("http://localhost:4200/.well-known/oauth-protected-resource");
    const last = events.at(-1);
    expect(last).toMatchObject({ dir: "in", status: 401, method: "initialize", rpcId: 1 });
    expect(last?.body).toMatchObject({ error: "unauthorized" });
  });

  it("falls back to the WWW-Authenticate header for the metadata URL", async () => {
    const rec = createRecordingFetch({
      getToken: () => null,
      fetch: async () => new Response("no", { status: 401, headers: { "www-authenticate": 'Bearer resource_metadata="http://h/prm"' } }),
    });
    const err = await rec.fetch("http://x/mcp", post({ jsonrpc: "2.0", id: 1, method: "ping" })).catch((e: unknown) => e);
    expect((err as UnauthorizedError).resourceMetadata).toBe("http://h/prm");
  });

  it("records other HTTP errors and network failures with their status", async () => {
    const events: TrafficEvent[] = [];
    const bad = createRecordingFetch({ getToken: () => null, onTraffic: (e) => events.push(e), fetch: async () => new Response("upstream down", { status: 502 }) });
    await bad.fetch("http://x/mcp", post({ jsonrpc: "2.0", id: 3, method: "tools/list" }));
    expect(events.at(-1)).toMatchObject({ dir: "in", status: 502, method: "tools/list", body: "upstream down" });

    const down = createRecordingFetch({ getToken: () => null, onTraffic: (e) => events.push(e), fetch: async () => Promise.reject(new TypeError("fetch failed")) });
    await expect(down.fetch("http://x/mcp", post({ jsonrpc: "2.0", id: 4, method: "ping" }))).rejects.toThrow("fetch failed");
    expect(events.at(-1)).toMatchObject({ dir: "in", status: 0, rpcId: 4 });
  });

  it("does not record a standalone SSE stream the server declines with 405", async () => {
    const events: TrafficEvent[] = [];
    const rec = createRecordingFetch({ getToken: () => null, onTraffic: (e) => events.push(e), fetch: async () => new Response(null, { status: 405 }) });
    const res = await rec.fetch("http://x/mcp", { method: "GET" });
    expect(res.status).toBe(405);
    expect(events).toHaveLength(0);
  });
});
