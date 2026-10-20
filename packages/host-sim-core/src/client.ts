import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import type { jsonSchemaValidator, JsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/types.js";
import { MCP_APP_MIME, MCP_PROTOCOL_VERSION } from "@hearth/contracts";
import { createRecordingFetch, isRecord, UnauthorizedError, type FetchFn, type RecordingFetch, type TrafficEvent } from "./traffic";

export { UnauthorizedError };
export type { TrafficEvent };

export type ToolDef = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

export type ToolCallResult = {
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
  ms: number;
};

export interface McpHostClientOptions {
  url: string;
  getToken: () => string | null;
  onTraffic?: (e: TrafficEvent) => void;
  clientName?: string;
  fetch?: typeof fetch;
}

const CLIENT_VERSION = "0.1.0";

/**
 * The host validates tool output with the contract zod schemas (widgets and tests), not with JSON Schema.
 * Skipping the SDK's Ajv validator keeps `new Function` code generation out of the browser bundle.
 * The SDK still enforces that a tool with an outputSchema returns structuredContent unless it is an error.
 */
const passthroughValidator: jsonSchemaValidator = {
  getValidator<T>(): JsonSchemaValidator<T> {
    return (input) => ({ valid: true, data: input as T, errorMessage: undefined });
  },
};

const decodeBase64 = (b64: string): string => {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const mono = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** A genuine MCP client (Streamable HTTP) that records every JSON-RPC message for the inspector. */
export class McpHostClient {
  private readonly opts: McpHostClientOptions;
  private readonly recorder: RecordingFetch;
  private client: Client | undefined;
  private transport: StreamableHTTPClientTransport | undefined;
  private readonly resourceCache = new Map<string, Promise<{ html: string; mimeType: string }>>();

  constructor(opts: McpHostClientOptions) {
    this.opts = opts;
    const base = opts.fetch;
    this.recorder = createRecordingFetch({
      getToken: opts.getToken,
      onTraffic: opts.onTraffic,
      fetch: base ? (input, init) => base(input, init) : undefined,
    });
  }

  get sessionId(): string | undefined {
    return this.transport?.sessionId ?? this.recorder.sessionId;
  }

  async connect(): Promise<{ protocolVersion: string; serverInfo: { name: string; version: string }; sessionId?: string }> {
    if (this.client) await this.close();
    const client = new Client(
      { name: this.opts.clientName ?? "alexa-plus-host-sim", version: CLIENT_VERSION },
      {
        capabilities: { experimental: { "io.modelcontextprotocol/ui": { mimeTypes: [MCP_APP_MIME] } } },
        jsonSchemaValidator: passthroughValidator,
      },
    );
    const transport = new StreamableHTTPClientTransport(new URL(this.opts.url), { fetch: this.recorder.fetch as FetchFn });
    this.client = client;
    this.transport = transport;
    try {
      await client.connect(transport);
    } catch (error) {
      this.client = undefined;
      this.transport = undefined;
      throw error;
    }
    const info = client.getServerVersion();
    return {
      protocolVersion: transport.protocolVersion ?? this.recorder.negotiatedProtocolVersion ?? MCP_PROTOCOL_VERSION,
      serverInfo: { name: info?.name ?? "unknown", version: info?.version ?? "unknown" },
      sessionId: this.sessionId,
    };
  }

  private requireClient(): Client {
    if (!this.client) throw new Error("McpHostClient is not connected. Call connect() first.");
    return this.client;
  }

  async listTools(): Promise<ToolDef[]> {
    const client = this.requireClient();
    const tools: ToolDef[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      for (const t of page.tools) {
        tools.push({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown>,
          outputSchema: t.outputSchema as Record<string, unknown> | undefined,
          annotations: t.annotations as Record<string, unknown> | undefined,
          _meta: t._meta as Record<string, unknown> | undefined,
        });
      }
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  /**
   * Calls a tool. A JSON-RPC error response (for example invalid params) is returned as an `isError` result
   * with `structuredContent.error`, so the orchestrator can speak it. HTTP 401 throws UnauthorizedError.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const client = this.requireClient();
    const t0 = mono();
    try {
      const result = await client.callTool({ name, arguments: args });
      const ms = Math.round(mono() - t0);
      const content = Array.isArray(result.content)
        ? result.content.map((c) => {
            const item = c as { type: string; text?: unknown };
            return typeof item.text === "string" ? { type: item.type, text: item.text } : { type: item.type };
          })
        : [];
      return {
        content,
        structuredContent: isRecord(result.structuredContent) ? result.structuredContent : undefined,
        isError: result.isError === true ? true : undefined,
        _meta: isRecord(result._meta) ? result._meta : undefined,
        ms,
      };
    } catch (error) {
      if (error instanceof McpError) {
        const code = error.code === -32602 ? "invalid_input" : "internal";
        return {
          content: [{ type: "text", text: error.message }],
          structuredContent: { error: { code, message: error.message } },
          isError: true,
          ms: Math.round(mono() - t0),
        };
      }
      throw error;
    }
  }

  /** Reads a ui:// resource. Cached per URI: widget URIs carry a content hash, so a cache hit is always the same HTML. */
  async readResource(uri: string): Promise<{ html: string; mimeType: string; ms: number }> {
    const client = this.requireClient();
    const cached = this.resourceCache.get(uri);
    if (cached) {
      const hit = await cached;
      return { ...hit, ms: 0 };
    }
    const t0 = mono();
    const pending = (async () => {
      const res = await client.readResource({ uri });
      const first = res.contents[0];
      if (!first) throw new Error(`Resource ${uri} returned no contents`);
      const html = "text" in first ? first.text : decodeBase64(first.blob);
      return { html, mimeType: first.mimeType ?? MCP_APP_MIME };
    })();
    this.resourceCache.set(uri, pending);
    try {
      const value = await pending;
      return { ...value, ms: Math.round(mono() - t0) };
    } catch (error) {
      this.resourceCache.delete(uri);
      throw error;
    }
  }

  async close(): Promise<void> {
    const transport = this.transport;
    const client = this.client;
    this.client = undefined;
    this.transport = undefined;
    this.resourceCache.clear();
    if (transport?.sessionId) {
      try {
        await transport.terminateSession();
      } catch {
        // The server may not support explicit session termination; closing the client is enough.
      }
    }
    if (client) {
      try {
        await client.close();
      } catch {
        // Already closed.
      }
    }
  }
}
