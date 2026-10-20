import {
  TOOLS,
  ToolError,
  UiMeta,
  toolSpec,
  type ToolErrorCode,
  type ToolName,
  type ToolSpec,
} from "@hearth/contracts";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { HearthError, fail } from "../errors";
import { addAsset, getHomeProfile } from "../services/home";
import { checkRecalls } from "../services/recalls";
import { findExactPart, getRepairSteps, triageIssue } from "../services/repair";
import { completeSession, completeSpeech, createSession, createSpeech, toCheckoutOutput } from "../services/checkout";
import { prepareProBrief } from "../services/brief";
import { getHistory, logCompletion } from "../services/timeline";
import { getWeekendPlan } from "../services/weekend";
import type { Core, Ctx } from "../services/core";
import type { WidgetStore } from "./widgets";

/* ------------------------------------------------------------------ typed registry */

type SpecOf<K extends ToolName> = Extract<(typeof TOOLS)[number], { name: K }>;
type InputOf<K extends ToolName> = z.output<SpecOf<K>["input"]>;
type OutputOf<K extends ToolName> = z.input<SpecOf<K>["output"]>;

interface Outcome {
  output: unknown;
  text: string;
}

interface RegisteredTool {
  spec: ToolSpec;
  /** Validates the arguments against the contract schema, then runs the handler. */
  run(raw: unknown, ctx: Ctx): Promise<Outcome>;
  /** Cheap checks that must run before schema validation (for example an unconfirmed checkout). */
  preflight?: (raw: unknown) => void;
}

const INVALID_INPUT_VOICE = "I didn't get everything I need for that. Could you say it again?";

function define<K extends ToolName>(
  name: K,
  handler: (input: InputOf<K>, ctx: Ctx) => Promise<{ output: OutputOf<K>; text: string }>,
  preflight?: (raw: unknown) => void,
): RegisteredTool {
  const spec = toolSpec(name);
  if (!spec) throw new Error(`unknown tool in registry: ${name}`);
  return {
    spec,
    ...(preflight ? { preflight } : {}),
    async run(raw, ctx) {
      const parsed = spec.input.safeParse(raw ?? {});
      if (!parsed.success) {
        throw fail("invalid_input", INVALID_INPUT_VOICE, parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
      }
      // The schema is the one named by `name`, so its output type is exactly InputOf<K>.
      return handler(parsed.data as InputOf<K>, ctx);
    },
  };
}

function buildRegistry(core: Core): Map<string, RegisteredTool> {
  const tools: RegisteredTool[] = [
    define("get_home_profile", (_input, ctx) => getHomeProfile(core, ctx)),
    define("add_asset", (input, ctx) => addAsset(core, ctx, input)),
    define("triage_issue", (input, ctx) => triageIssue(core, ctx, input)),
    define("get_repair_steps", (input, ctx) => getRepairSteps(core, ctx, input)),
    define("find_exact_part", (input, ctx) => findExactPart(core, ctx, input)),
    define("create_checkout_session", async (input, ctx) => {
      const output = toCheckoutOutput(core, await createSession(core, ctx, input));
      return { output, text: createSpeech(output) };
    }),
    define(
      "complete_checkout",
      async (input, ctx) => {
        const output = await completeSession(core, ctx, input);
        return { output, text: completeSpeech(output) };
      },
      (raw) => {
        const args = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
        const phrase = args.confirmationPhrase;
        if (args.userConfirmed !== true || typeof phrase !== "string" || phrase.trim() === "") {
          throw fail("not_confirmed", "I need a clear yes from you before I can place the order.");
        }
      },
    ),
    define("prepare_pro_brief", (input, ctx) => prepareProBrief(core, ctx, input)),
    define("get_weekend_plan", (input, ctx) => getWeekendPlan(core, ctx, input)),
    define("log_completion", (input, ctx) => logCompletion(core, ctx, input)),
    define("get_history", (input, ctx) => getHistory(core, ctx, input)),
    define("check_recalls", (_input, ctx) => checkRecalls(core, ctx)),
  ];
  return new Map(tools.map((t) => [t.spec.name, t]));
}

/* ------------------------------------------------------------------ results */

const roundMs = (ms: number): number => Math.round(ms * 10) / 10;

function errorResult(code: ToolErrorCode, voice: string, ms: number, issues: string[] = []): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: voice }],
    structuredContent: { error: { code, message: voice } },
    _meta: { "hearth/serverMs": roundMs(ms), ...(issues.length > 0 ? { "hearth/issues": issues } : {}) },
  };
}

export interface ToolRunner {
  call(name: string, args: unknown, auth: AuthInfo | undefined): Promise<CallToolResult>;
  list(): Tool[];
}

export function createToolRunner(core: Core, widgets: WidgetStore): ToolRunner {
  const registry = buildRegistry(core);

  async function contextFor(auth: AuthInfo | undefined): Promise<Ctx> {
    const sub = auth?.extra?.sub;
    if (typeof sub !== "string" || sub === "") throw fail("unauthorized", "Please link your Hearth account to continue.");
    const home = await core.repo.getHomeForUser(sub);
    if (!home) throw fail("no_home", "I don't have a home set up for you yet. Open the Hearth app to get started.");
    const email = auth?.extra?.email;
    return { userId: sub, home, ...(typeof email === "string" ? { email } : {}) };
  }

  return {
    async call(name, args, auth) {
      const started = performance.now();
      const elapsed = (): number => performance.now() - started;
      const tool = registry.get(name);
      if (!tool) return errorResult("not_found", "I don't have a tool by that name.", elapsed());
      const { spec } = tool;
      try {
        if (!auth?.scopes.includes(spec.scope)) {
          throw fail("forbidden_scope", "I don't have permission for that yet. Please link your Hearth account again and allow access.");
        }
        tool.preflight?.(args);
        const ctx = await contextFor(auth);
        const outcome = await tool.run(args, ctx);

        const checked = spec.output.safeParse(outcome.output);
        if (!checked.success) {
          core.logger.error("tool_output_violates_contract", { tool: name, issues: checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
          throw fail("internal", "Something went wrong on my side. Please try again.");
        }
        const structured = checked.data;

        const meta: Record<string, unknown> = { "hearth/serverMs": roundMs(elapsed()) };
        if (spec.widget) {
          const entry = widgets.byName(spec.widget);
          if (entry) {
            meta.ui = UiMeta.parse({ resourceUri: entry.uri, pattern: entry.pattern, widget: spec.widget, props: structured });
          }
        }
        return { content: [{ type: "text", text: outcome.text }], structuredContent: structured, _meta: meta };
      } catch (err) {
        if (err instanceof HearthError) return errorResult(err.code, err.voice, elapsed(), err.issues);
        core.logger.error("tool_failed", { tool: name, message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
        return errorResult("internal", "Something went wrong on my side. Please try again.", elapsed());
      }
    },

    list() {
      return TOOLS.map((spec): Tool => {
        const entry = spec.widget ? widgets.byName(spec.widget) : undefined;
        const schemas = SCHEMAS.get(spec.name);
        return {
          name: spec.name,
          title: spec.title,
          description: spec.description,
          inputSchema: schemas?.input ?? toJsonSchema(spec.input, "input"),
          outputSchema: schemas?.output ?? toJsonSchema(spec.output, "output"),
          annotations: { title: spec.title, ...spec.annotations },
          ...(entry
            ? { _meta: { ui: { resourceUri: entry.uri, pattern: entry.pattern }, "ui/resourceUri": entry.uri } }
            : {}),
        };
      });
    },
  };
}

/**
 * What a tool may return in structuredContent: its output, or the error envelope.
 * The SDK client validates structuredContent against outputSchema even when isError is true, so an
 * outputSchema that only describes success would make every error throw on the client.
 */
function outputOrError(output: z.ZodObject): Tool["outputSchema"] {
  const { $schema, ...success } = toJsonSchema(output, "output");
  const { $schema: _unused, ...error } = toJsonSchema(ToolError, "output");
  return { ...($schema !== undefined ? { $schema } : {}), type: "object", anyOf: [success, error] };
}

const SCHEMAS = new Map(TOOLS.map((spec) => [spec.name, { input: toJsonSchema(spec.input, "input"), output: outputOrError(spec.output) }]));

function toJsonSchema(schema: z.ZodObject, io: "input" | "output"): Tool["inputSchema"] {
  const { properties, required, ...rest } = z.toJSONSchema(schema, { target: "draft-7", io });
  return {
    ...rest,
    type: "object",
    ...(properties ? { properties: properties as Record<string, object> } : {}),
    ...(required ? { required } : {}),
  };
}
