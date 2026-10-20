import { describe, expect, it } from "vitest";
import type { Turn } from "@hearth/host-sim-core";
import { settledLabel } from "./settled";

const tool = (name: string, structuredContent: Record<string, unknown> = {}, ui?: unknown, isError = false): Turn => ({
  role: "tool",
  callId: name,
  name,
  args: {},
  result: { content: [{ type: "text", text: "ok" }], structuredContent, ...(ui ? { _meta: { ui } } : {}), isError, ms: 1 },
});
const user: Turn = { role: "user", text: "It's fixed.", source: "voice" };
const stepUi = { resourceUri: "ui://hearth/step-card", pattern: "card", widget: "step-card", props: {} };

describe("settledLabel", () => {
  it("settles after log_completion", () => {
    expect(settledLabel([user, tool("log_completion")])).toBe("LOGGED TO YOUR HOME TIMELINE");
  });
  it("settles after a hard-stop triage", () => {
    expect(settledLabel([user, tool("triage_issue", { safety: { hardStop: true, message: "Stop." } })])).toBe("SAFETY STOP");
  });
  it("does not settle on a normal triage or a failed completion", () => {
    expect(settledLabel([user, tool("triage_issue", { safety: { hardStop: false } })])).toBeNull();
    expect(settledLabel([user, tool("log_completion", {}, undefined, true)])).toBeNull();
  });
  it("a newer visual result wins; an older one does not", () => {
    expect(settledLabel([user, tool("log_completion"), tool("get_repair_steps", {}, stepUi)])).toBeNull();
    expect(settledLabel([user, tool("get_repair_steps", {}, stepUi), tool("log_completion")])).toBe("LOGGED TO YOUR HOME TIMELINE");
  });
  it("ignores tool results from earlier turns", () => {
    expect(settledLabel([tool("log_completion"), user])).toBeNull();
  });
});
