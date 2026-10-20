import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { MCP_APP_MIME } from "@hearth/contracts";
import { McpHostClient, UnauthorizedError, type TrafficEvent } from "../src";

/**
 * End to end against the real MCP SDK server on an ephemeral port: the host client must initialize, list tools,
 * call a tool, read a ui:// resource and surface a 401, with every JSON-RPC message recorded.
 */

const TOKEN = "test-token";
const PRM = "http://localhost:0/.well-known/oauth-protected-resource";
const WIDGET_URI = "ui://hearth/step-card-9f3c1a.html";

let http: Server;
let url = "";
let resourceReads = 0;
const sessions = new Map<string, StreamableHTTPServerTransport>();

function newSession(): StreamableHTTPServerTransport {
  const mcp = new McpServer({ name: "hearth-test", version: "9.9.9" });
  mcp.registerTool(
    "echo",
    { description: "Echo text back.", inputSchema: { text: z.string() }, outputSchema: { echo: z.string() } },
    async ({ text }) => ({
      content: [{ type: "text" as const, text: `echo: ${text}` }],
      structuredContent: { echo: text },
      _meta: { ui: { resourceUri: WIDGET_URI, pattern: "card", widget: "step-card", props: { echo: text } } },
    }),
  );
  mcp.registerResource("step-card", WIDGET_URI, { mimeType: MCP_APP_MIME }, async (uri) => {
    resourceReads += 1;
    return { contents: [{ uri: uri.href, mimeType: MCP_APP_MIME, text: "<main>step card</main>" }] };
  });
  const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id: string): void => {
      sessions.set(id, transport);
    },
  });
  void mcp.connect(transport);
  return transport;
}

beforeAll(async () => {
  http = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized", error_description: "Missing or invalid token", resource_metadata: PRM }));
      return;
    }
    const sid = req.headers["mcp-session-id"];
    const transport = typeof sid === "string" ? sessions.get(sid) : undefined;
    void (transport ?? newSession()).handleRequest(req, res);
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
});

afterAll(async () => {
  await Promise.all([...sessions.values()].map((t) => t.close()));
  http.closeAllConnections();
  await new Promise<void>((resolve) => http.close(() => resolve()));
});

describe("McpHostClient against the MCP SDK server", () => {
  it("connects, lists tools, calls a tool, reads a cached resource and records the traffic", async () => {
    const events: TrafficEvent[] = [];
    const client = new McpHostClient({ url, getToken: () => TOKEN, onTraffic: (e) => events.push(e) });

    const init = await client.connect();
    expect(init.serverInfo).toEqual({ name: "hearth-test", version: "9.9.9" });
    expect(init.protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(init.sessionId).toBeTruthy();
    expect(client.sessionId).toBe(init.sessionId);

    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["echo"]);
    expect(tools[0]?.outputSchema).toBeDefined();

    const result = await client.callTool("echo", { text: "hello" });
    expect(result.structuredContent).toEqual({ echo: "hello" });
    expect(result.content).toEqual([{ type: "text", text: "echo: hello" }]);
    expect(result.isError).toBeUndefined();
    expect(result.ms).toBeGreaterThanOrEqual(0);
    expect(result._meta?.ui).toMatchObject({ resourceUri: WIDGET_URI, widget: "step-card" });

    const first = await client.readResource(WIDGET_URI);
    expect(first).toMatchObject({ html: "<main>step card</main>", mimeType: MCP_APP_MIME });
    const second = await client.readResource(WIDGET_URI);
    expect(second.html).toBe(first.html);
    expect(second.ms).toBe(0);
    expect(resourceReads).toBe(1);

    await client.close();
    await new Promise((r) => setTimeout(r, 30));

    const wire = events.map((e) => `${e.dir}:${e.method}`);
    expect(wire).toContain("out:initialize");
    expect(wire).toContain("in:initialize");
    expect(wire).toContain("out:notifications/initialized");
    expect(wire).toContain("out:tools/list");
    expect(wire).toContain("in:tools/list");
    expect(wire).toContain("out:resources/read");

    const out = events.find((e) => e.dir === "out" && e.method === "tools/call");
    const back = events.find((e) => e.dir === "in" && e.method === "tools/call");
    expect(out?.toolName).toBe("echo");
    expect(back?.toolName).toBe("echo");
    expect(back?.rpcId).toBe(out?.rpcId);
    expect(back?.status).toBe(200);
    expect(back?.ms).toBeTypeOf("number");
    expect(back?.sessionId).toBe(init.sessionId);
    const initEvent = events.find((e) => e.dir === "out" && e.method === "initialize");
    expect(initEvent?.body).toMatchObject({ params: { clientInfo: { name: "alexa-plus-host-sim" } } });
  });

  it("returns a tool error as an isError result instead of throwing", async () => {
    const client = new McpHostClient({ url, getToken: () => TOKEN });
    await client.connect();
    const result = await client.callTool("echo", { text: 42 });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBeTruthy();
    await client.close();
  });

  it("throws UnauthorizedError with the metadata URL on a 401 and records it", async () => {
    const events: TrafficEvent[] = [];
    const client = new McpHostClient({ url, getToken: () => null, onTraffic: (e) => events.push(e) });
    const err = await client.connect().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect((err as UnauthorizedError).resourceMetadata).toBe(PRM);
    expect(events.some((e) => e.dir === "in" && e.status === 401)).toBe(true);
    await expect(client.listTools()).rejects.toThrow("not connected");
  });
});
