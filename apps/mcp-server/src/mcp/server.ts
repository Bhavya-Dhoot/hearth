import { MCP_APP_MIME, SERVER_NAME, type WidgetName } from "@hearth/contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Core } from "../services/core";
import { createToolRunner } from "./tools";
import type { WidgetEntry, WidgetStore } from "./widgets";

/** MCP error code for an unknown resource (spec: resources/read). */
const RESOURCE_NOT_FOUND = -32002;

const WIDGET_TITLES: Record<WidgetName, string> = {
  "step-card": "Step Card",
  "parts-carousel": "Parts Carousel",
  "checkout-card": "Checkout and Confirmation Card",
  "weekend-list": "Weekend List",
  "pro-brief-card": "Pro Brief Card",
  "home-card": "Home Card",
  "timeline-list": "Timeline List",
  "recall-card": "Recall Card",
};

const WIDGET_DESCRIPTIONS: Record<WidgetName, string> = {
  "step-card": "One repair step with the customer's own photo and a hand-drawn annotation.",
  "parts-carousel": "Three to five parts that fit the customer's own fixture, ranked, with fit reasons.",
  "checkout-card": "The order summary and explicit confirmation, then the order confirmation.",
  "weekend-list": "Ranked maintenance for the weekend, numbered for voice.",
  "pro-brief-card": "A job brief for a professional, laid out like a work order.",
  "home-card": "What Hearth remembers about the home, key locations and recent events.",
  "timeline-list": "Dated repairs, maintenance, orders and escalations.",
  "recall-card": "Items in the home that match the sample recall dataset, with remedy steps.",
};

const INSTRUCTIONS =
  "Hearth remembers the customer's home. For any home problem call triage_issue first, then get_repair_steps. " +
  "Read commitmentText aloud and wait for an explicit yes before complete_checkout. " +
  "Every tool result has a short spoken summary in content and the full data in structuredContent.";

export interface McpServerOptions {
  version: string;
  mcpBase: string;
}

/** One SDK server per client session. Tools and resources are served from the shared runner and widget store. */
export function createMcpServer(core: Core, widgets: WidgetStore, opts: McpServerOptions): McpServer {
  const runner = createToolRunner(core, widgets);
  const mediaOrigin = new URL(opts.mcpBase).origin;

  const mcp = new McpServer(
    { name: SERVER_NAME, version: opts.version, title: "Hearth" },
    { capabilities: { tools: {}, resources: {}, logging: {} }, instructions: INSTRUCTIONS },
  );
  const server = mcp.server;

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: runner.list() }));

  server.setRequestHandler(CallToolRequestSchema, (request, extra) => runner.call(request.params.name, request.params.arguments, extra.authInfo));

  const csp = { resourceDomains: [mediaOrigin], connectDomains: [] as string[], frameDomains: [] as string[], baseUriDomains: [] as string[] };
  const resourceMeta = (entry: WidgetEntry): Record<string, unknown> => ({
    mcpApp: { pattern: entry.pattern, widget: entry.name, hash: entry.hash, csp },
    ui: { csp },
  });

  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: widgets.entries().map((entry) => ({
      uri: entry.uri,
      name: entry.name,
      title: WIDGET_TITLES[entry.name],
      description: WIDGET_DESCRIPTIONS[entry.name],
      mimeType: MCP_APP_MIME,
      size: entry.bytes,
      _meta: resourceMeta(entry),
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    const entry = widgets.byUri(request.params.uri);
    if (!entry) throw new McpError(RESOURCE_NOT_FOUND, `Resource not found: ${request.params.uri}`);
    let text: string;
    try {
      text = widgets.htmlFor(entry);
    } catch {
      throw new McpError(ErrorCode.InternalError, "Widget file could not be read");
    }
    return { contents: [{ uri: entry.uri, mimeType: MCP_APP_MIME, text, _meta: resourceMeta(entry) }] };
  });

  return mcp;
}
