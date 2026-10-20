import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ALEXA_SYSTEM_PROMPT, createInitialState, type ConversationState, type OrchestratorDecision, type Turn } from "@hearth/host-sim-core";
import { buildConverseInput, guardrailConfigFromEnv, guardrails, stepBedrock } from "./orchestrate";

describe("prompts/alexa.md", () => {
  it("has the same content as ALEXA_SYSTEM_PROMPT", () => {
    const md = readFileSync(path.join(__dirname, "../../prompts/alexa.md"), "utf8");
    expect(md.trim()).toBe(ALEXA_SYSTEM_PROMPT.trim());
  });
});

const tool = (name: string, structuredContent: Record<string, unknown>, callId = "c1"): Turn => ({
  role: "tool",
  callId,
  name,
  args: {},
  result: { content: [{ type: "text", text: "ok" }], structuredContent, ms: 5 },
});

describe("guardrails", () => {
  it("speaks a hard-stop message verbatim", () => {
    const s: ConversationState = createInitialState("echo-show-8");
    s.turns.push({ role: "user", text: "I smell gas", source: "voice" });
    s.turns.push(tool("triage_issue", { safety: { hardStop: true, message: "Stop. Leave the house." } }));
    const out = guardrails(s, { kind: "speak", text: "Here is a step.", expectReply: false });
    expect(out).toEqual({ kind: "speak", text: "Stop. Leave the house.", expectReply: false });
  });

  const checkout = (reply: string, spoken: string): ConversationState => {
    const s = createInitialState("echo-show-8");
    s.turns.push({ role: "user", text: "order it", source: "voice" });
    s.turns.push(tool("create_checkout_session", { sessionId: "cs_1", commitmentText: "You are ordering one washer for $4.20." }));
    s.turns.push({ role: "assistant", text: spoken });
    s.turns.push({ role: "user", text: reply, source: "voice" });
    return s;
  };
  const complete: OrchestratorDecision = { kind: "tool_calls", calls: [{ id: "x", name: "complete_checkout", args: { sessionId: "cs_1" } }] };

  it("blocks complete_checkout without an explicit yes", () => {
    const out = guardrails(checkout("what is the delivery date", "You are ordering one washer for $4.20. Confirm?"), complete);
    expect(out).toEqual({ kind: "speak", text: "Say yes to confirm, or no to cancel.", expectReply: true });
  });
  it("blocks complete_checkout when the commitment was not read", () => {
    expect(guardrails(checkout("Yes.", "Sure."), complete)).not.toBeNull();
  });
  it("lets complete_checkout through after the commitment and a yes", () => {
    expect(guardrails(checkout("Yes.", "You are ordering one washer for $4.20. Confirm?"), complete)).toBeNull();
  });
});

describe("Bedrock Converse request", () => {
  const keys = ["HEARTH_GUARDRAIL_ID", "HEARTH_GUARDRAIL_VERSION", "HEARTH_BEDROCK_MODEL", "HEARTH_BEDROCK_MODEL_ID"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  beforeEach(() => keys.forEach((k) => delete process.env[k]));
  afterEach(() => keys.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))));

  const state = () => {
    const s = createInitialState("echo-show-8");
    s.turns.push({ role: "user", text: "water under the sink", source: "voice" });
    return s;
  };

  it("attaches no guardrail when HEARTH_GUARDRAIL_ID is unset", () => {
    expect(buildConverseInput("sys", state(), [])).not.toHaveProperty("guardrailConfig");
    expect(guardrailConfigFromEnv()).toBeUndefined();
  });

  it("attaches the guardrail with version DRAFT by default and trace enabled", () => {
    process.env.HEARTH_GUARDRAIL_ID = "gr-123";
    expect(buildConverseInput("sys", state(), []).guardrailConfig).toEqual({ guardrailIdentifier: "gr-123", guardrailVersion: "DRAFT", trace: "enabled" });
    process.env.HEARTH_GUARDRAIL_VERSION = "3";
    expect(buildConverseInput("sys", state(), []).guardrailConfig).toEqual({ guardrailIdentifier: "gr-123", guardrailVersion: "3", trace: "enabled" });
  });

  it("reads the model from HEARTH_BEDROCK_MODEL, then the HEARTH_BEDROCK_MODEL_ID alias", () => {
    process.env.HEARTH_BEDROCK_MODEL_ID = "alias-model";
    expect(buildConverseInput("sys", state(), []).modelId).toBe("alias-model");
    process.env.HEARTH_BEDROCK_MODEL = "primary-model";
    expect(buildConverseInput("sys", state(), []).modelId).toBe("primary-model");
  });

  const stub = (output: object, stopReason: string) => {
    const sent: unknown[] = [];
    return { sent, client: { send: async (cmd: { input: unknown }) => (sent.push(cmd.input), { output: { message: { role: "assistant", content: [output] } }, stopReason }) } };
  };

  it("sends the guardrail on the Converse call and speaks the blocked message when it intervenes", async () => {
    process.env.HEARTH_GUARDRAIL_ID = "gr-123";
    const { sent, client } = stub({ text: "I can't help with that one." }, "guardrail_intervened");
    const out = await stepBedrock(state(), [], client as never);
    expect((sent[0] as { guardrailConfig?: unknown }).guardrailConfig).toEqual({ guardrailIdentifier: "gr-123", guardrailVersion: "DRAFT", trace: "enabled" });
    expect(out.decision).toEqual({ kind: "speak", text: "I can't help with that one.", expectReply: false });
    expect(out.note).toMatch(/guardrail intervened/);
  });

  it("treats a normal end_turn as an ordinary decision", async () => {
    const { client } = stub({ text: "Which pipe is it?" }, "end_turn");
    const out = await stepBedrock(state(), [], client as never);
    expect(out.decision).toEqual({ kind: "speak", text: "Which pipe is it?", expectReply: true });
    expect(out.note).toBeUndefined();
  });
});
