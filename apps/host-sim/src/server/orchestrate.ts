import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type ToolConfiguration,
} from "@aws-sdk/client-bedrock-runtime";
import {
  ALEXA_SYSTEM_PROMPT,
  createRulesOrchestrator,
  isExplicitYes,
  parseTapUtterance,
  stateToChatMessages,
  stripWakeWord,
  toOllamaTools,
  type ConversationState,
  type OrchestratorDecision,
  type ToolDef,
} from "@hearth/host-sim-core";

/* ------------------------------------------------------------------------------------------------
 * Provider order (contract amendment A0):  Bedrock (AWS credentials)  ->  Ollama (local, probed)  ->  rules.
 * HEARTH_ORCHESTRATOR=bedrock|ollama|rules forces one. Whatever a model decides, the deterministic
 * guardrails below run on the decision before it leaves the server.
 * ---------------------------------------------------------------------------------------------- */

export type Provider = "bedrock" | "ollama" | "rules";

export type StepReport = {
  decision: OrchestratorDecision;
  mode: Provider;
  model?: string;
  /** true when the model runs on this machine */
  local?: boolean;
  /** known only after a chat has run: did Ollama load the model into VRAM */
  gpu?: boolean;
  /** why the requested/default provider was not the one that answered */
  fallbackReason?: string;
  note?: string;
  /** rules orchestrator working memory after this step (the browser carries it forward) */
  memory?: ConversationState["memory"];
};

const BEDROCK_MODEL = () => process.env.HEARTH_BEDROCK_MODEL ?? "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
const OLLAMA_URL = () => (process.env.HEARTH_OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
const OLLAMA_MODEL = () => process.env.HEARTH_OLLAMA_MODEL ?? "qwen3:4b-instruct-2507-q4_K_M";
const OLLAMA_TIMEOUT_MS = 20_000;
const PROBE_TTL_MS = 30_000;

export const hasAwsCredentials = () =>
  Boolean(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE || process.env.AWS_WEB_IDENTITY_TOKEN_FILE);
export const awsRegion = () => process.env.AWS_REGION ?? "us-east-1";

const isLoopback = (url: string) => {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
  } catch {
    return false;
  }
};

/* ------------------------------------------------------------------ system prompt */

let promptCache: string | null = null;
async function systemPrompt(): Promise<string> {
  if (promptCache) return promptCache;
  try {
    promptCache = (await readFile(path.join(process.cwd(), "prompts", "alexa.md"), "utf8")).trim();
  } catch {
    promptCache = ALEXA_SYSTEM_PROMPT.trim();
  }
  return promptCache;
}

const deviceLine = (state: ConversationState) =>
  state.device === "voice-only"
    ? "The customer is on a voice-only device with no screen. Read tool content text instead of referring to the screen."
    : `The customer is on a device with a screen (${state.device}). Prefer showing a widget and keep spoken lines short.`;

/* ------------------------------------------------------------------ Ollama probe (cached 30 s) */

type Probe = { at: number; ok: boolean; reason?: string };
let probe: Probe | null = null;
let ollamaGpu: boolean | undefined;

async function timedFetch(url: string, init: RequestInit & { timeoutMs: number }): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), init.timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

export async function ollamaAvailable(): Promise<{ ok: boolean; reason?: string }> {
  if (probe && Date.now() - probe.at < PROBE_TTL_MS) return probe;
  let next: Probe;
  try {
    const res = await timedFetch(`${OLLAMA_URL()}/api/tags`, { timeoutMs: 1500 });
    if (!res.ok) next = { at: Date.now(), ok: false, reason: `Ollama answered ${res.status} at ${OLLAMA_URL()}.` };
    else {
      const body = (await res.json()) as { models?: { name?: string; model?: string }[] };
      const want = OLLAMA_MODEL();
      const has = (body.models ?? []).some((m) => m.name === want || m.model === want);
      next = has ? { at: Date.now(), ok: true } : { at: Date.now(), ok: false, reason: `Ollama is running but model ${want} is not pulled.` };
    }
  } catch {
    next = { at: Date.now(), ok: false, reason: `Ollama is not reachable at ${OLLAMA_URL()}.` };
  }
  probe = next;
  return next;
}

/* ------------------------------------------------------------------ which provider */

export async function chooseProvider(prefer?: string): Promise<{ provider: Provider; fallbackReason?: string }> {
  const forced = process.env.HEARTH_ORCHESTRATOR;
  const wanted = (forced === "bedrock" || forced === "ollama" || forced === "rules" ? forced : undefined) ??
    (prefer === "bedrock" || prefer === "ollama" || prefer === "rules" ? prefer : undefined);

  if (wanted === "rules") return { provider: "rules" };
  if (wanted === "bedrock") {
    return hasAwsCredentials() ? { provider: "bedrock" } : { provider: "rules", fallbackReason: "Bedrock was requested but no AWS credentials are configured." };
  }
  if (wanted === "ollama") {
    const p = await ollamaAvailable();
    return p.ok ? { provider: "ollama" } : { provider: "rules", fallbackReason: p.reason };
  }
  if (hasAwsCredentials()) return { provider: "bedrock" };
  if ((await ollamaAvailable()).ok) return { provider: "ollama" };
  return { provider: "rules" };
}

/* ------------------------------------------------------------------ deterministic guardrails */

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Runs on every model decision (Bedrock or Ollama). Returns a replacement decision, or null to let it through.
 *  - A hard-stop triage result is spoken verbatim, never paraphrased and never followed by steps.
 *  - complete_checkout only passes when the previous assistant turn read that session's commitmentText and
 *    the latest user turn is an explicit yes (or a tap on confirm_checkout for the session).
 */
export function guardrails(state: ConversationState, decision: OrchestratorDecision): OrchestratorDecision | null {
  const last = state.turns[state.turns.length - 1];
  if (last?.role === "tool" && last.name === "triage_issue") {
    const safety = last.result.structuredContent?.safety as { hardStop?: boolean; message?: string } | undefined;
    if (safety?.hardStop === true && typeof safety.message === "string") {
      return { kind: "speak", text: safety.message, expectReply: false };
    }
  }

  if (decision.kind === "tool_calls") {
    for (const call of decision.calls) {
      if (call.name !== "complete_checkout") continue;
      if (!checkoutConfirmed(state, call.args)) {
        return { kind: "speak", text: "Say yes to confirm, or no to cancel.", expectReply: true };
      }
    }
  }
  return null;
}

function checkoutConfirmed(state: ConversationState, args: Record<string, unknown>): boolean {
  let userIdx = -1;
  for (let i = state.turns.length - 1; i >= 0; i -= 1) {
    if (state.turns[i]?.role === "user") {
      userIdx = i;
      break;
    }
  }
  if (userIdx < 1) return false;
  const user = state.turns[userIdx];
  const prev = state.turns[userIdx - 1];
  if (user?.role !== "user" || prev?.role !== "assistant") return false;

  const sessionId = typeof args.sessionId === "string" ? args.sessionId : "";
  let commitment: string | undefined;
  for (let i = userIdx - 1; i >= 0; i -= 1) {
    const t = state.turns[i];
    if (t?.role === "tool" && t.name === "create_checkout_session" && !t.result.isError) {
      const sc = t.result.structuredContent;
      if (sc && (sc.sessionId === sessionId || !sessionId) && typeof sc.commitmentText === "string") {
        commitment = sc.commitmentText;
        break;
      }
    }
  }
  if (!commitment || !squash(prev.text).includes(squash(commitment))) return false;

  const tap = parseTapUtterance(user.text);
  if (tap) return tap.name === "confirm_checkout" && tap.args.sessionId === sessionId;
  return isExplicitYes(stripWakeWord(user.text)) || isExplicitYes(user.text);
}

/* ------------------------------------------------------------------ Bedrock */

let bedrock: BedrockRuntimeClient | null = null;

const toolText = (t: Extract<ConversationState["turns"][number], { role: "tool" }>) => {
  const text = t.result.content
    .map((c) => c.text)
    .filter((s): s is string => typeof s === "string")
    .join("\n");
  const sc = t.result.structuredContent ? JSON.stringify(t.result.structuredContent) : "";
  const body = sc && sc.length > 6000 ? `${sc.slice(0, 6000)} ...[truncated]` : sc;
  return [text, body && `structuredContent: ${body}`].filter(Boolean).join("\n") || "(no content)";
};

export function stateToConverseMessages(state: ConversationState): Message[] {
  const out: Message[] = [];
  const push = (role: "user" | "assistant", block: ContentBlock) => {
    const lastMsg = out[out.length - 1];
    if (lastMsg && lastMsg.role === role) lastMsg.content!.push(block);
    else out.push({ role, content: [block] });
  };
  for (const t of state.turns) {
    if (t.role === "user") push("user", { text: t.text });
    else if (t.role === "assistant") push("assistant", { text: t.text });
    else {
      push("assistant", { toolUse: { toolUseId: t.callId, name: t.name, input: t.args as never } });
      push("user", {
        toolResult: { toolUseId: t.callId, status: t.result.isError ? "error" : "success", content: [{ text: toolText(t) }] },
      });
    }
  }
  return out;
}

async function stepBedrock(state: ConversationState, tools: ToolDef[]): Promise<OrchestratorDecision> {
  bedrock ??= new BedrockRuntimeClient({ region: awsRegion() });
  const toolConfig: ToolConfiguration = {
    tools: tools.map((t) => {
      const { $schema: _drop, ...schema } = t.inputSchema as Record<string, unknown>;
      return { toolSpec: { name: t.name, description: t.description ?? t.title ?? t.name, inputSchema: { json: schema as never } } };
    }),
  };
  const res = await bedrock.send(
    new ConverseCommand({
      modelId: BEDROCK_MODEL(),
      system: [{ text: await systemPrompt() }, { text: deviceLine(state) }],
      messages: stateToConverseMessages(state),
      toolConfig,
      inferenceConfig: { maxTokens: 700, temperature: 0.3 },
    }),
  );
  const blocks = res.output?.message?.content ?? [];
  const text = blocks.map((b) => b.text).filter((s): s is string => !!s).join(" ").trim();
  const calls = blocks
    .filter((b) => b.toolUse)
    .map((b) => ({ id: b.toolUse!.toolUseId ?? crypto.randomUUID(), name: b.toolUse!.name ?? "", args: (b.toolUse!.input ?? {}) as Record<string, unknown> }));
  if (calls.length) return { kind: "tool_calls", calls, say: text || undefined };
  if (!text) throw new Error("Bedrock returned neither text nor a tool call.");
  return { kind: "speak", text, expectReply: /\?\s*$/.test(text) };
}

/* ------------------------------------------------------------------ Ollama */

const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<\/?think>/gi, "").trim();

async function stepOllama(state: ConversationState, tools: ToolDef[]): Promise<OrchestratorDecision> {
  const history = (stateToChatMessages(state) as { role: string }[]).filter((m) => m.role !== "system");
  const messages = [{ role: "system", content: `${await systemPrompt()}

${deviceLine(state)}` }, ...history];
  const res = await timedFetch(`${OLLAMA_URL()}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    timeoutMs: OLLAMA_TIMEOUT_MS,
    body: JSON.stringify({
      model: OLLAMA_MODEL(),
      messages,
      tools: toOllamaTools(tools),
      stream: false,
      think: false,
      keep_alive: "30m",
      // ponytail: 8k context fits the 12 tool schemas + 20 turns on a 4 GB GPU; the default 128k KV cache does not.
      options: { temperature: 0.2, num_ctx: 8192, num_predict: 400 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama answered ${res.status}.`);
  const body = (await res.json()) as {
    message?: { content?: string; tool_calls?: { function?: { name?: string; arguments?: unknown } }[] };
  };
  void noteGpu();
  const msg = body.message;
  const text = stripThink(msg?.content ?? "");
  const rawCalls = msg?.tool_calls ?? [];
  if (rawCalls.length) {
    const calls = rawCalls.map((c) => {
      const name = c.function?.name ?? "";
      const def = tools.find((t) => t.name === name);
      if (!def) throw new Error(`The model called an unknown tool "${name}".`);
      let args = c.function?.arguments;
      if (typeof args === "string") args = JSON.parse(args);
      if (typeof args !== "object" || args === null || Array.isArray(args)) throw new Error(`The model sent malformed arguments for ${name}.`);
      const required = ((def.inputSchema as { required?: string[] }).required ?? []) as string[];
      const missing = required.filter((k) => (args as Record<string, unknown>)[k] === undefined);
      if (missing.length) throw new Error(`The model left out required arguments for ${name}: ${missing.join(", ")}.`);
      return { id: `call_${crypto.randomUUID().slice(0, 12)}`, name, args: args as Record<string, unknown> };
    });
    return { kind: "tool_calls", calls, say: text || undefined };
  }
  if (!text) throw new Error("The model returned neither text nor a tool call.");
  return { kind: "speak", text, expectReply: /\?\s*$/.test(text) };
}

/** Best effort: ask Ollama whether the model it just ran sits in VRAM. Never blocks or fails a turn. */
async function noteGpu(): Promise<void> {
  try {
    const res = await timedFetch(`${OLLAMA_URL()}/api/ps`, { timeoutMs: 800 });
    if (!res.ok) return;
    const body = (await res.json()) as { models?: { name?: string; model?: string; size_vram?: number }[] };
    const m = (body.models ?? []).find((x) => x.name === OLLAMA_MODEL() || x.model === OLLAMA_MODEL());
    if (m) ollamaGpu = (m.size_vram ?? 0) > 0;
  } catch {
    /* unknown stays unknown */
  }
}

/* ------------------------------------------------------------------ entry point */

export async function orchestrateStep(state: ConversationState, tools: ToolDef[], prefer?: string): Promise<StepReport> {
  const choice = await chooseProvider(prefer);
  let fallbackReason = choice.fallbackReason;

  if (choice.provider !== "rules") {
    try {
      const decision = choice.provider === "bedrock" ? await stepBedrock(state, tools) : await stepOllama(state, tools);
      const model = choice.provider === "bedrock" ? BEDROCK_MODEL() : OLLAMA_MODEL();
      const base = { mode: choice.provider, model } as const;
      const local = choice.provider === "ollama" ? isLoopback(OLLAMA_URL()) : undefined;
      const gpu = choice.provider === "ollama" ? ollamaGpu : undefined;
      const override = guardrails(state, decision);
      return { ...base, local, gpu, decision: override ?? decision, note: override ? "A deterministic guardrail replaced the model's decision." : undefined };
    } catch (e) {
      fallbackReason = `${choice.provider} failed: ${e instanceof Error ? e.message : String(e)}`;
      if (choice.provider === "ollama") probe = null; // re-probe next time
    }
  }

  // The rules orchestrator keeps its working memory in state.memory; it is returned so the browser,
  // which owns the conversation, carries it into the next step.
  const decision = await createRulesOrchestrator().step(state, tools);
  return { mode: "rules", decision, memory: state.memory, fallbackReason, note: fallbackReason };
}

export async function describeProvider(prefer?: string) {
  const choice = await chooseProvider(prefer);
  return {
    mode: choice.provider,
    model: choice.provider === "bedrock" ? BEDROCK_MODEL() : choice.provider === "ollama" ? OLLAMA_MODEL() : undefined,
    local: choice.provider === "ollama" ? isLoopback(OLLAMA_URL()) : undefined,
    gpu: choice.provider === "ollama" ? ollamaGpu : undefined,
    fallbackReason: choice.fallbackReason,
  };
}
