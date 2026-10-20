import { z } from "zod";

/** MCP protocol revision Hearth is built against. */
export const MCP_PROTOCOL_VERSION = "2025-11-25" as const;
export const SERVER_NAME = "hearth" as const;

/** The four MCP Apps visual patterns Alexa+ allows. Never invent a fifth. */
export const UiPattern = z.enum(["card", "carousel", "list", "map"]);
export type UiPattern = z.infer<typeof UiPattern>;

/** Every widget Hearth ships. File on disk: dist/ui/<name>-<hash>.html */
export const WidgetName = z.enum([
  "step-card",
  "parts-carousel",
  "checkout-card",
  "weekend-list",
  "pro-brief-card",
  "home-card",
  "timeline-list",
  "recall-card",
]);
export type WidgetName = z.infer<typeof WidgetName>;

export const WIDGET_PATTERN: Record<WidgetName, UiPattern> = {
  "step-card": "card",
  "parts-carousel": "carousel",
  "checkout-card": "card",
  "weekend-list": "list",
  "pro-brief-card": "card",
  "home-card": "card",
  "timeline-list": "list",
  "recall-card": "card",
};

/** MIME type advertised on ui:// resources (friction log: no canonical value documented). */
export const MCP_APP_MIME = "text/html+mcpapp" as const;

/** `_meta.ui` attached to every visual tool result. */
export const UiMeta = z.object({
  resourceUri: z.string().startsWith("ui://hearth/"),
  pattern: UiPattern,
  widget: WidgetName,
  props: z.record(z.string(), z.unknown()),
});
export type UiMeta = z.infer<typeof UiMeta>;

/** Error codes in `structuredContent.error.code` when `isError: true`. */
export const ToolErrorCode = z.enum([
  "not_found",
  "invalid_input",
  "unauthorized",
  "forbidden_scope",
  "no_home",
  "session_expired",
  "not_confirmed",
  "conflict",
  "internal",
]);
export type ToolErrorCode = z.infer<typeof ToolErrorCode>;

export const ToolError = z.object({
  error: z.object({ code: ToolErrorCode, message: z.string() }),
});
export type ToolError = z.infer<typeof ToolError>;

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
export const IsoDateTime = z.string().datetime({ offset: true });

export const Ports = { auth: 4100, mcp: 4200, host: 3000 } as const;
