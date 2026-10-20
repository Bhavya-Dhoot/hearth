import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { urlsFromEnv, type HomeRepository, type PartsApi, type PlaybooksApi } from "@hearth/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import cors from "cors";
import express, { type ErrorRequestHandler, type Express, type Request, type RequestHandler, type Response } from "express";
import pkg from "../package.json";
import type { VerifyToken } from "./auth/jwt";
import { bearerAuth, subjectOf } from "./auth/middleware";
import { checkoutRouter } from "./http/checkout";
import { publicRouter } from "./http/public";
import { type Logger, createJsonLogger, redactPath } from "./log";
import { createMcpServer } from "./mcp/server";
import { WidgetStore } from "./mcp/widgets";
import type { Core } from "./services/core";
import { type EmailService, createOutboxEmail } from "./services/email";
import { KeyedLock } from "./services/lock";
import { type PaymentGateway, createSimulatedGateway } from "./services/payments";

export interface AppDeps {
  repo: HomeRepository;
  playbooks: PlaybooksApi;
  parts: PartsApi;
  /** Directory holding manifest.json and the built widget HTML (packages/widgets/dist/ui). */
  widgetsDir: string;
  /** Directory of illustrations served at /media (packages/widgets/media). */
  mediaDir: string;
  verifyToken: VerifyToken;
  now?: () => Date;
  /** Public base URL of this server. Default: HEARTH_MCP_BASE or http://localhost:4200 */
  mcpBase?: string;
  authIssuer?: string;
  hostBase?: string;
  /** Where `.eml` files go when Resend is not configured. Default: apps/mcp-server/.outbox */
  outboxDir?: string;
  email?: EmailService;
  payments?: PaymentGateway;
  logger?: Logger;
  /** Used when the access token has no email claim. */
  defaultRecipient?: (userId: string) => string;
  emailFrom?: string;
  /** Idle sessions are closed after this many minutes. Default 60. */
  sessionIdleMinutes?: number;
}

export interface HearthApp {
  app: Express;
  core: Core;
  /** Closes every MCP session and stops background timers. */
  close(): Promise<void>;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  sub: string;
  lastSeen: number;
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_OUTBOX_DIR = path.join(packageRoot, ".outbox");

const CORS_HEADERS = ["Authorization", "Content-Type", "Mcp-Session-Id", "Mcp-Protocol-Version", "Last-Event-ID"];

const rpcError = (message: string): { jsonrpc: "2.0"; error: { code: number; message: string }; id: null } => ({
  jsonrpc: "2.0",
  error: { code: -32000, message },
  id: null,
});

export function createApp(deps: AppDeps): HearthApp {
  const urls = urlsFromEnv();
  const mcpBase = deps.mcpBase ?? urls.mcpBase;
  const authIssuer = deps.authIssuer ?? urls.authIssuer;
  const hostBase = deps.hostBase ?? urls.hostBase;
  const logger = deps.logger ?? createJsonLogger();
  const now = deps.now ?? (() => new Date());
  const outboxDir = deps.outboxDir ?? DEFAULT_OUTBOX_DIR;
  const emailFrom = deps.emailFrom ?? "Hearth <orders@hearth.example>";

  const core: Core = {
    repo: deps.repo,
    playbooks: deps.playbooks,
    parts: deps.parts,
    mcpBase,
    now,
    logger,
    locks: new KeyedLock(),
    email: deps.email ?? createOutboxEmail(outboxDir, emailFrom, now),
    payments: deps.payments ?? createSimulatedGateway(),
    defaultRecipient: deps.defaultRecipient ?? ((userId) => `${userId}@users.hearth.example`),
  };

  const widgets = new WidgetStore(deps.widgetsDir, logger);
  const sessions = new Map<string, Session>();
  const auth = bearerAuth(deps.verifyToken, mcpBase, logger);

  const app = express();
  app.disable("x-powered-by");
  app.set("etag", "strong");

  /* -------------------------------------------------------------- request log (no tokens, no secret paths) */
  app.use((req, res, next) => {
    const started = performance.now();
    res.on("finish", () => {
      const body: unknown = req.body;
      const rpc = typeof body === "object" && body !== null ? (body as { method?: unknown; params?: { name?: unknown } }) : undefined;
      logger.info("request", {
        method: req.method,
        path: redactPath(req.path),
        status: res.statusCode,
        ms: Math.round((performance.now() - started) * 10) / 10,
        ...(subjectOf(req) ? { sub: subjectOf(req) } : {}),
        ...(typeof rpc?.method === "string" ? { rpc: rpc.method } : {}),
        ...(typeof rpc?.params?.name === "string" ? { tool: rpc.params.name } : {}),
      });
    });
    next();
  });

  /* -------------------------------------------------------------- CORS */
  const allowedOrigin = (origin: string | undefined): boolean =>
    origin === undefined || origin === hostBase || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  app.use(
    cors({
      origin: (origin, callback) => callback(null, allowedOrigin(origin)),
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: CORS_HEADERS,
      exposedHeaders: ["Mcp-Session-Id"],
      maxAge: 600,
    }),
  );

  /* -------------------------------------------------------------- public routes */
  app.use(
    publicRouter(core, {
      mcpBase,
      authIssuer,
      mediaDir: deps.mediaDir,
      outboxDir,
      version: pkg.version,
      liveStats: () => ({ sessions: sessions.size, widgets: widgets.entries().length }),
    }),
  );

  /* -------------------------------------------------------------- REST checkout */
  app.use("/checkout-sessions", auth, checkoutRouter(core));

  /* -------------------------------------------------------------- MCP, Streamable HTTP */
  const sessionFor = (req: Request, res: Response): Session | undefined => {
    const sid = req.get("mcp-session-id");
    if (!sid) {
      res.status(400).json(rpcError("Bad Request: Mcp-Session-Id header is required"));
      return undefined;
    }
    const session = sessions.get(sid);
    if (!session) {
      res.status(404).json(rpcError("Session not found. Send a new initialize request."));
      return undefined;
    }
    if (session.sub !== subjectOf(req)) {
      logger.warn("session_owner_mismatch", { sub: subjectOf(req) });
      res.status(403).json(rpcError("This session belongs to a different account."));
      return undefined;
    }
    session.lastSeen = Date.now();
    return session;
  };

  const dispatch = async (session: Session, req: Request, res: Response): Promise<void> => {
    try {
      await session.transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error("mcp_transport_failed", { message: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  };

  const openSession = async (req: Request, res: Response, sub: string): Promise<void> => {
    const server = createMcpServer(core, widgets, { version: pkg.version, mcpBase });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, { transport, server, sub, lastSeen: Date.now() });
      },
    });
    await server.connect(transport);
    server.server.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await dispatch({ transport, server, sub, lastSeen: Date.now() }, req, res);
  };

  const postMcp: RequestHandler = async (req, res) => {
    if (req.get("mcp-session-id")) {
      const session = sessionFor(req, res);
      if (session) await dispatch(session, req, res);
      return;
    }
    const sub = subjectOf(req);
    if (!sub || !isInitializeRequest(req.body)) {
      res.status(400).json(rpcError("Bad Request: send an initialize request first, then include Mcp-Session-Id"));
      return;
    }
    await openSession(req, res, sub);
  };

  const streamMcp: RequestHandler = async (req, res) => {
    const session = sessionFor(req, res);
    if (session) await dispatch(session, req, res);
  };

  // MCP transport spec: reject a browser Origin we do not know, which blocks DNS rebinding. Clients with no Origin are unaffected.
  const originGuard: RequestHandler = (req, res, next) => {
    if (allowedOrigin(req.get("origin"))) return next();
    logger.warn("origin_rejected", { origin: req.get("origin") });
    res.status(403).json(rpcError("Origin not allowed."));
  };

  app.post("/mcp", originGuard, auth, express.json({ limit: "1mb" }), postMcp);
  app.get("/mcp", originGuard, auth, streamMcp);
  app.delete("/mcp", originGuard, auth, streamMcp);

  /* -------------------------------------------------------------- fallthrough */
  app.use((_req, res) => {
    res.status(404).json({ error: "not_found", error_description: "No such route." });
  });

  const onError: ErrorRequestHandler = (err: unknown, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = typeof err === "object" && err !== null && "status" in err && typeof err.status === "number" ? err.status : 500;
    if (status >= 500) logger.error("unhandled_error", { path: redactPath(req.path), message: err instanceof Error ? err.message : String(err) });
    if (req.path === "/mcp") {
      res.status(status).json({ jsonrpc: "2.0", error: { code: status === 400 ? -32700 : -32603, message: status === 400 ? "Parse error" : "Internal server error" }, id: null });
      return;
    }
    res.status(status).json({ error: status === 400 ? "invalid_request" : "internal", error_description: status === 400 ? "The request body could not be read." : "Something went wrong." });
  };
  app.use(onError);

  /* -------------------------------------------------------------- idle session sweep */
  const idleMs = (deps.sessionIdleMinutes ?? 60) * 60_000;
  const sweeper = setInterval(() => {
    const cutoff = Date.now() - idleMs;
    for (const [sid, session] of sessions) {
      if (session.lastSeen < cutoff) {
        sessions.delete(sid);
        void session.server.close().catch(() => undefined);
      }
    }
  }, 60_000);
  sweeper.unref();

  return {
    app,
    core,
    async close() {
      clearInterval(sweeper);
      const open = [...sessions.values()];
      sessions.clear();
      await Promise.allSettled(open.map((s) => s.server.close()));
    },
  };
}
