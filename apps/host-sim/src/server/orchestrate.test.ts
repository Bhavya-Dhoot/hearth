import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALEXA_SYSTEM_PROMPT, createInitialState, type ConversationState, type OrchestratorDecision, type Turn } from "@hearth/host-sim-core";
import { guardrails } from "./orchestrate";

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
