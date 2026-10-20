import { describe, expect, it } from "vitest";
import { DEVICE_CONTEXTS, TOOLS, type DeviceClass } from "@hearth/contracts";
import {
  actionToUtterance,
  createInitialState,
  createRulesOrchestrator,
  parseTapUtterance,
  photoToUtterance,
  REPLAYS,
  runReplay,
  runTurn,
  stateToChatMessages,
  toOllamaTools,
  type ConversationState,
  type Orchestrator,
  type OrchestratorDecision,
  type ReplayId,
  type RunTurnResult,
  type ToolCallResult,
  type ToolDef,
} from "../src";
import { FakeHearth, GAS_MESSAGE } from "./fakeHearth";

const tools: ToolDef[] = TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: { type: "object" } }));

const counter = () => {
  let n = 0;
  return (prefix: string) => `${prefix}-key-${String((n += 1)).padStart(6, "0")}`;
};

class Session {
  state: ConversationState;
  readonly orchestrator = createRulesOrchestrator({ newKey: counter() });
  constructor(readonly fake: FakeHearth, device: DeviceClass = "echo-show-8") {
    this.state = createInitialState(device);
  }
  async say(text: string, source: "voice" | "text" | "tap" = "voice"): Promise<RunTurnResult> {
    const out = await runTurn({ client: this.fake, orchestrator: this.orchestrator, state: this.state, userText: text, source, tools });
    this.state = out.state;
    return out;
  }
  tap(a: Parameters<typeof actionToUtterance>[0]): Promise<RunTurnResult> {
    return this.say(actionToUtterance(a), "tap");
  }
}

/** Runs the first turns of J1 up to and including the parts carousel. */
async function toParts(s: Session): Promise<void> {
  await s.say("Alexa, there's water under the kitchen sink.");
  await s.say("The pipes.");
  await s.say("Next.");
  await s.say("Next.");
  await s.say("Next.");
}

async function toCommitment(s: Session): Promise<RunTurnResult> {
  await toParts(s);
  return s.say("Order the first one.");
}

const lastArgs = (fake: FakeHearth, name: string): Record<string, unknown> => {
  const hit = [...fake.calls].reverse().find((c) => c.name === name);
  if (!hit) throw new Error(`${name} was never called`);
  return hit.args;
};

describe("the five demo journeys", () => {
  const ids: ReplayId[] = ["J1", "J2", "J3", "J4", "J5"];
  for (const id of ids) {
    it(`${id} calls exactly the expected tools`, async () => {
      const fake = new FakeHearth();
      const run = await runReplay({ id, client: fake, orchestrator: createRulesOrchestrator({ newKey: counter() }), tools });
      expect(run.mismatch).toBeNull();
      expect(run.toolSequence).toEqual(REPLAYS[id].expectTools);
      // Calm copy: no exclamation marks, no em or en dashes, no "great question", in anything spoken.
      for (const t of run.turns) {
        expect(t.say).not.toMatch(/!|—|–|great question/i);
        expect(t.say.length).toBeGreaterThan(0);
      }
    });
  }

  it("J1 speaks only what the tools returned, and logs the part it ordered", async () => {
    const fake = new FakeHearth();
    const s = new Session(fake);
    const t1 = await s.say("Alexa, there's water under the kitchen sink.");
    expect(t1.say).toBe("Is it dripping from the pipes, or pooling from the dishwasher side?");
    expect(fake.calls[0]?.args).toEqual({ symptomText: "there's water under the kitchen sink." });

    const t2 = await s.say("The pipes.");
    expect(fake.calls[1]?.args).toEqual({ symptomText: "there's water under the kitchen sink.", answers: { source: "Pipes" } });
    expect(t2.say).toContain("Step 1 of 6: Turn off the cold water shut-off valve under your sink.");
    expect(t2.say).toContain("Careful: Turn it clockwise until it stops.");
    expect(t2.ui?.widget).toBe("step-card");

    await s.say("Next.");
    await s.say("Next.");
    const t5 = await s.say("Next.");
    expect(t5.toolCalls.map((c) => c.name)).toEqual(["get_repair_steps", "find_exact_part"]);
    expect(t5.say).toContain("Step 4 of 6");
    expect(t5.say).toContain("Hearth 1-1/2 inch slip-joint washer set at $4.29.");
    expect(t5.say).toContain("Fits your 1½″ slip-joint P-trap, installed 2019.");
    expect(t5.ui?.widget).toBe("parts-carousel");
    expect(lastArgs(fake, "find_exact_part")).toEqual({ assetId: "asset_ptrap_kitchen", issueId: "leak-under-sink-ptrap", partRole: "ptrap_washer" });

    const t6 = await s.say("Order the first one.");
    expect(lastArgs(fake, "create_checkout_session")).toMatchObject({ sku: "HR-PT-150-WSH", qty: 1 });
    expect(String(lastArgs(fake, "create_checkout_session").idempotencyKey).length).toBeGreaterThanOrEqual(8);
    expect(t6.say).toBe("You're ordering 1 Hearth 1-1/2 inch slip-joint washer set for $4.64, arriving Tuesday, October 27, on your Visa ending 4242. Confirm?");
    expect(t6.ui?.widget).toBe("checkout-card");

    const t7 = await s.say("Yes.");
    expect(lastArgs(fake, "complete_checkout")).toMatchObject({ userConfirmed: true, confirmationPhrase: "Yes." });
    expect(t7.say).toContain("Your order HR-1001 is placed for $4.64.");
    expect(t7.say).toContain("It arrives Tuesday, October 27.");

    await s.say("Next.");
    await s.say("Next.");
    const t10 = await s.say("It's fixed.");
    expect(lastArgs(fake, "log_completion")).toMatchObject({ kind: "repair", issueId: "leak-under-sink-ptrap", partSku: "HR-PT-150-WSH", assetId: "asset_ptrap_kitchen" });
    expect(t10.say).toContain("Next up is Check that the P-trap is still dry, due Friday, October 30.");
    expect(fake.completed).toHaveLength(1);
  });

  it("J2 re-runs triage with the new signal and sends what the customer already tried", async () => {
    const fake = new FakeHearth();
    const s = new Session(fake);
    await s.say("Alexa, there's water under the kitchen sink.");
    await s.say("The pipes.");
    await s.say("Next.");
    const t = await s.say("Actually, it's coming from the disposal unit itself.");
    expect(fake.calls.at(-2)?.args.symptomText).toBe("there's water under the kitchen sink. It's coming from the disposal unit itself.");
    const brief = lastArgs(fake, "prepare_pro_brief");
    expect(brief.attempted).toEqual(["Turn off the cold water shut-off valve under your sink"]);
    expect(brief.assetId).toBe("asset_disposal");
    expect(t.say).toBe("This one's past DIY. Internal seal failure on a 9-year-old unit. I've put together a job brief for the pro. Want me to find a plumber?");
    expect(t.ui?.widget).toBe("pro-brief-card");
    // After a brief, "next" no longer walks the old repair.
    const after = await s.say("Next.");
    expect(after.toolCalls).toHaveLength(0);
  });

  it("J3 reads the top two weekend rows and reorders the filter through the confirmation gate", async () => {
    const fake = new FakeHearth();
    const s = new Session(fake, "echo-show-15");
    const t1 = await s.say("Alexa, what should I do around the house this weekend?");
    expect(t1.say).toContain("Replace the furnace filter: It is 94 days old.");
    expect(t1.say).toContain("Check the dishwasher recall");
    expect(t1.say).not.toContain("gutters");
    const t2 = await s.say("Reorder the filter.");
    expect(lastArgs(fake, "create_checkout_session")).toMatchObject({ sku: "HR-FLT-16251-M11", qty: 1 });
    expect(t2.say.endsWith("Confirm?")).toBe(true);
    expect(fake.completed).toHaveLength(0);
    await s.say("Yes");
    expect(fake.completed).toHaveLength(1);
  });

  it("reorders a filter with no weekend plan in memory by finding the exact part first", async () => {
    const fake = new FakeHearth();
    const s = new Session(fake);
    const t = await s.say("Reorder the filter.");
    expect(fake.names).toEqual(["find_exact_part", "create_checkout_session"]);
    expect(lastArgs(fake, "find_exact_part")).toEqual({ partRole: "furnace_filter" });
    expect(t.say.endsWith("Confirm?")).toBe(true);
  });

  it("J4 adds the water heater from the label photo and the shut-off from the spoken location", async () => {
    const fake = new FakeHearth();
    const run = await runReplay({ id: "J4", client: fake, orchestrator: createRulesOrchestrator({ newKey: counter() }), tools });
    expect(run.turns[0]?.say).toBe("Show me the label on your water heater and I'll read the brand, model and serial.");
    expect(run.turns[0]?.toolCalls).toHaveLength(0);
    const [first, second] = fake.calls.map((c) => c.args);
    expect(first).toMatchObject({ type: "appliance", category: "water_heater", label: "water heater", brand: "Rheem", model: "XE50T10H45U0", installYear: 2018, location: { room: "Garage" } });
    expect(first?.photoUrl).toBe("http://localhost:4200/media/water-heater-label.svg");
    expect(second).toMatchObject({ type: "shutoff", category: "main_shutoff", label: "main water shut-off", location: { room: "Garage", note: "left of the panel" } });
    expect(run.turns[1]?.say).toContain("I've added your water heater in the garage.");
    expect(run.turns[1]?.say).toContain("I now remember 11 things in your home.");
    expect(run.turns[2]?.say).toContain("your main water shut-off in the garage, left of the panel.");
    expect(run.turns[2]?.ui?.widget).toBe("home-card");
  });

  it("J4 asks for the room when the photo does not carry one, and on a voice-only device skips the photo", async () => {
    const fake = new FakeHearth();
    const s = new Session(fake, "phone");
    await s.say("Add my water heater to Hearth.");
    const t = await s.say(photoToUtterance({ brand: "Rheem", model: "XE50T10H45U0" }), "tap");
    expect(t.say).toBe("I read the label on your water heater. Which room is it in?");
    expect(fake.calls).toHaveLength(0);
    await s.say("It's in the basement, next to the furnace.");
    expect(lastArgs(fake, "add_asset")).toMatchObject({ brand: "Rheem", location: { room: "Basement", note: "next to the furnace" } });

    const voice = new Session(new FakeHearth(), "voice-only");
    expect((await voice.say("Add my water heater.")).say).toBe("Which room is your water heater in?");
    await voice.say("The garage.");
    expect(lastArgs(voice.fake, "add_asset")).toMatchObject({ category: "water_heater", location: { room: "Garage" } });
    expect(lastArgs(voice.fake, "add_asset").brand).toBeUndefined();
  });

  it("J5 answers from the most relevant history event and discloses the sample recall dataset", async () => {
    const fake = new FakeHearth();
    const s = new Session(fake);
    const h = await s.say("Did we ever fix the disposal?");
    expect(lastArgs(fake, "get_history")).toEqual({ query: "disposal" });
    expect(h.say).toBe("Yes. I have it from March 14, 2025: Reset the garbage disposal after a jam.");
    expect(h.ui?.widget).toBe("timeline-list");
    const r = await s.say("Is anything in my house recalled?");
    expect(r.say).toContain("Your dishwasher is flagged");
    expect(r.say).toContain("First step: Stop using the heated dry cycle.");
    expect(r.say).toContain("labelled sample");
    const p = await s.say("What do you know about my house?");
    expect(p.say).toBe("I remember 10 things in your home, including your main water shut-off in garage, left of the panel.");
  });
});

describe("confirmation safety", () => {
  it("never completes a checkout without an explicit yes right after the commitment", async () => {
    for (const reply of ["Okay.", "Sure, but what is the total?", "Yes but not yet", "Maybe", "Next.", "Sounds good", "What's the delivery date?"]) {
      const fake = new FakeHearth();
      const s = new Session(fake);
      await toCommitment(s);
      await s.say(reply);
      expect(fake.completed, reply).toHaveLength(0);
      // The commitment is dead after any other reply: a late yes still places nothing.
      await s.say("Yes.");
      expect(fake.completed, `late yes after ${reply}`).toHaveLength(0);
    }
  });

  it("does nothing on a bare yes when no order is open", async () => {
    const fake = new FakeHearth();
    const s = new Session(fake);
    const t = await s.say("Yes.");
    expect(fake.calls).toHaveLength(0);
    expect(t.toolCalls).toHaveLength(0);
  });

  it("drops the order on no or cancel and says nothing was charged", async () => {
    for (const reply of ["No.", "Cancel", "Never mind"]) {
      const fake = new FakeHearth();
      const s = new Session(fake);
      await toCommitment(s);
      const t = await s.say(reply);
      expect(t.say).toBe("Okay, I won't place that order. Nothing was charged.");
      await s.say("Yes.");
      expect(fake.completed).toHaveLength(0);
    }
  });

  it("accepts the explicit forms of yes and echoes the customer's own words", async () => {
    for (const reply of ["Yes", "yes please", "Confirm", "Alexa, yes, go ahead", "Yes, place the order."]) {
      const fake = new FakeHearth();
      const s = new Session(fake);
      await toCommitment(s);
      await s.say(reply);
      expect(fake.completed, reply).toHaveLength(1);
      expect(lastArgs(fake, "complete_checkout").confirmationPhrase).toBe(reply.replace(/^Alexa,\s*/i, ""));
    }
  });

  it("completes on a tap of confirm_checkout for the open session only", async () => {
    const wrong = new FakeHearth();
    const sw = new Session(wrong);
    await toCommitment(sw);
    await sw.tap({ name: "confirm_checkout", args: { sessionId: "cs_other" } });
    expect(wrong.completed).toHaveLength(0);

    const ok = new FakeHearth();
    const so = new Session(ok);
    await toCommitment(so);
    const sessionId = String((so.state.memory.checkout ?? { sessionId: "" }).sessionId);
    await so.tap({ name: "confirm_checkout", args: { sessionId } });
    expect(ok.completed).toEqual([sessionId]);
    expect(lastArgs(ok, "complete_checkout").confirmationPhrase).toBe("confirm");
  });

  it("runTurn blocks a complete_checkout from any orchestrator that skips the gate", async () => {
    const fake = new FakeHearth();
    const s = new Session(fake);
    const commit = await toCommitment(s);
    const sessionId = String(s.state.memory.checkout?.sessionId);

    const rogue: Orchestrator = {
      mode: "bedrock",
      async step(state): Promise<OrchestratorDecision> {
        const last = state.turns.at(-1);
        if (last?.role === "tool" && last.name === "complete_checkout") return { kind: "speak", text: "done", expectReply: false };
        return {
          kind: "tool_calls",
          calls: [{ id: "c1", name: "complete_checkout", args: { sessionId, userConfirmed: true, confirmationPhrase: "okay", idempotencyKey: "rogue-key-1" } }],
        };
      },
    };
    const before = fake.calls.length;
    const blocked = await runTurn({ client: fake, orchestrator: rogue, state: s.state, userText: "Hmm, maybe.", source: "voice", tools });
    expect(fake.calls.length).toBe(before);
    expect(blocked.toolCalls[0]?.isError).toBe(true);
    expect(blocked.state.turns.at(-2)).toMatchObject({ role: "tool", name: "complete_checkout" });

    // A yes right after the verbatim commitment goes through, with the customer's words forced into the call.
    expect(commit.say.endsWith("Confirm?")).toBe(true);
    const allowed = await runTurn({ client: fake, orchestrator: rogue, state: s.state, userText: "Yes.", source: "voice", tools });
    expect(allowed.toolCalls[0]?.isError).toBe(false);
    expect(lastArgs(fake, "complete_checkout").confirmationPhrase).toBe("Yes.");

    // A yes that does not follow the spoken commitment is blocked even though the words are right.
    const unread = structuredClone(s.state);
    const idx = unread.turns.map((t) => t.role).lastIndexOf("assistant");
    unread.turns[idx] = { role: "assistant", text: "Anything else?" };
    const before2 = fake.calls.length;
    const refused = await runTurn({ client: fake, orchestrator: rogue, state: unread, userText: "Yes.", source: "voice", tools });
    expect(fake.calls.length).toBe(before2);
    expect(refused.toolCalls[0]?.isError).toBe(true);
  });
});

describe("hard stop and escalation", () => {
  it("reads the safety message verbatim, gives no steps, then offers a brief and builds it on yes", async () => {
    const fake = new FakeHearth();
    const s = new Session(fake);
    const t = await s.say("Alexa, I smell gas near the furnace.");
    expect(t.say.startsWith(GAS_MESSAGE)).toBe(true);
    expect(t.say).toBe(`${GAS_MESSAGE} Want me to put together a brief for your gas utility?`);
    expect(fake.names).toEqual(["triage_issue"]);
    expect(t.ui).toBeUndefined();

    const yes = await s.say("Yes.");
    expect(fake.names).toEqual(["triage_issue", "prepare_pro_brief"]);
    expect(lastArgs(fake, "prepare_pro_brief").symptom).toBe("I smell gas near the furnace.");
    expect(yes.say).toContain("Want me to find a plumber?");
  });

  it("declines politely when the customer says no to the brief", async () => {
    const fake = new FakeHearth();
    const s = new Session(fake);
    await s.say("I smell gas");
    const t = await s.say("No.");
    expect(t.say).toBe("Okay.");
    expect(fake.names).toEqual(["triage_issue"]);
  });
});

describe("turn loop limits", () => {
  it("runs at most four tool calls in a turn", async () => {
    const fake = new FakeHearth();
    const greedy: Orchestrator = {
      mode: "bedrock",
      async step(): Promise<OrchestratorDecision> {
        return { kind: "tool_calls", calls: [{ id: `c${fake.calls.length}`, name: "get_home_profile", args: {} }] };
      },
    };
    const out = await runTurn({ client: fake, orchestrator: greedy, state: createInitialState("echo-show-8"), userText: "keep going", source: "voice", tools });
    expect(fake.calls).toHaveLength(4);
    expect(out.toolCalls).toHaveLength(4);
    expect(out.say.length).toBeGreaterThan(0);
    expect(out.state.turns.at(-1)?.role).toBe("assistant");

    const fake2 = new FakeHearth();
    const out2 = await runTurn({ client: fake2, orchestrator: greedy, state: createInitialState("echo-show-8"), userText: "go", source: "voice", tools, maxToolCalls: 2 });
    expect(out2.toolCalls).toHaveLength(2);
  });

  it("does not mutate the state it is given", async () => {
    const fake = new FakeHearth();
    const state = createInitialState("echo-show-8");
    const snapshot = JSON.stringify(state);
    await runTurn({ client: fake, orchestrator: createRulesOrchestrator({ newKey: counter() }), state, userText: "there's water under the kitchen sink", source: "voice", tools });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it("converts a thrown client error into an error result the orchestrator can speak", async () => {
    const client = {
      async callTool(): Promise<ToolCallResult> {
        throw new Error("socket hang up");
      },
    };
    const out = await runTurn({ client, orchestrator: createRulesOrchestrator({ newKey: counter() }), state: createInitialState("echo-show-8"), userText: "is anything in my house recalled", source: "voice", tools });
    expect(out.toolCalls[0]?.isError).toBe(true);
    expect(out.say).toBe("Hearth ran into a problem and I couldn't finish that. Please try again in a moment.");
  });
});

describe("clarifying questions, taps and device behaviour", () => {
  it("asks two clarifying questions one at a time and sends all answers keyed by question id", async () => {
    const seen: Record<string, unknown>[] = [];
    const client = {
      async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
        seen.push(args);
        const answers = (args.answers ?? {}) as Record<string, string>;
        const base = { confidence: 0.5, safety: { hardStop: false }, escalate: false };
        const out =
          Object.keys(answers).length === 0
            ? { ...base, issueId: null, clarifyingQuestions: [{ id: "where", text: "Is the toilet leaking at the base?" }, { id: "when", text: "Does it happen when you flush?" }] }
            : { ...base, issueId: null, clarifyingQuestions: [] };
        return { content: [{ type: "text", text: name }], structuredContent: out, ms: 1 };
      },
    };
    const s = { state: createInitialState("echo-show-8"), o: createRulesOrchestrator({ newKey: counter() }) };
    const go = async (text: string) => {
      const r = await runTurn({ client, orchestrator: s.o, state: s.state, userText: text, source: "voice", tools });
      s.state = r.state;
      return r;
    };
    expect((await go("the toilet is leaking")).say).toBe("Is the toilet leaking at the base?");
    expect((await go("Yes, at the base")).say).toBe("Does it happen when you flush?");
    expect(seen).toHaveLength(1);
    await go("Only when I flush");
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatchObject({ symptomText: "the toilet is leaking", answers: { where: "Yes, at the base", when: "Only when I flush" } });
  });

  it("treats [tap] next_step, select_part and done like their spoken forms", async () => {
    const fake = new FakeHearth();
    const s = new Session(fake);
    await s.say("there's water under the kitchen sink");
    await s.say("pipes");
    await s.tap({ name: "next_step", args: { issueId: "leak-under-sink-ptrap", stepIndex: 0 } });
    expect(lastArgs(fake, "get_repair_steps")).toEqual({ issueId: "leak-under-sink-ptrap", stepIndex: 1 });
    await s.tap({ name: "next_step", args: { issueId: "leak-under-sink-ptrap", stepIndex: 1 } });
    await s.tap({ name: "next_step", args: { issueId: "leak-under-sink-ptrap", stepIndex: 2 } });
    expect(fake.names.slice(-2)).toEqual(["get_repair_steps", "find_exact_part"]);
    await s.tap({ name: "select_part", args: { index: 1, sku: "HR-PT-150-NUT" } });
    expect(lastArgs(fake, "create_checkout_session")).toMatchObject({ sku: "HR-PT-150-NUT" });
    await s.tap({ name: "done", args: { issueId: "leak-under-sink-ptrap" } });
    expect(fake.names.at(-1)).toBe("log_completion");
  });

  it("tap round trip", () => {
    const a = { name: "select_part", args: { index: 0, sku: "HR-PT-150-WSH" } } as const;
    expect(actionToUtterance(a)).toBe('[tap] select_part {"index":0,"sku":"HR-PT-150-WSH"}');
    expect(parseTapUtterance(actionToUtterance(a))).toEqual(a);
    expect(parseTapUtterance("[tap] select_part {nope")).toBeNull();
    expect(parseTapUtterance("[tap] explode {}")).toBeNull();
  });

  it("reads more aloud on a voice-only device and never points at a screen", async () => {
    const fake = new FakeHearth();
    const s = new Session(fake, "voice-only");
    await s.say("there's water under the kitchen sink");
    await s.say("pipes");
    await s.say("next");
    await s.say("next");
    const parts = await s.say("next");
    expect(parts.say).toContain("I also have Hearth 1-1/2 inch slip nut and washer kit at $6.49, and Hearth 1-1/4 inch washer set at $3.99.");
    expect(parts.say).not.toMatch(/screen|shown|display/i);
    expect(DEVICE_CONTEXTS["voice-only"].deviceCapabilities.screen).toBe(false);
  });

  it("explains itself when it does not understand", async () => {
    const fake = new FakeHearth();
    const s = new Session(fake);
    const t = await s.say("Tell me a joke.");
    expect(t.toolCalls).toHaveLength(0);
    expect(t.say).toBe("I can help with a home problem, your weekend plan, recalls, or your home history. What's going on?");
  });

  it("speaks a calm line for tool errors", async () => {
    const client = {
      async callTool(): Promise<ToolCallResult> {
        return { content: [{ type: "text", text: "boom" }], structuredContent: { error: { code: "unauthorized", message: "boom" } }, isError: true, ms: 1 };
      },
    };
    const out = await runTurn({ client, orchestrator: createRulesOrchestrator({ newKey: counter() }), state: createInitialState("echo-show-8"), userText: "what should I do around the house this weekend", source: "voice", tools });
    expect(out.say).toBe("Hearth needs to be linked to your account again before I can do that.");
  });
});

describe("LLM orchestrator helpers", () => {
  it("builds Ollama function tools from tools/list", () => {
    const def: ToolDef = { name: "check_recalls", title: "Check recalls", description: "Match assets.", inputSchema: { type: "object", properties: {} } };
    expect(toOllamaTools([def])).toEqual([{ type: "function", function: { name: "check_recalls", description: "Match assets.", parameters: { type: "object", properties: {} } } }]);
  });

  it("turns conversation state into chat messages with voice text plus compact data as the tool result", async () => {
    const fake = new FakeHearth();
    const s = new Session(fake);
    await s.say("is anything in my house recalled");
    const messages = stateToChatMessages(s.state);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("You are Alexa+");
    expect(messages[1]).toEqual({ role: "user", content: "is anything in my house recalled" });
    expect(messages[2]).toEqual({ role: "assistant", content: "", tool_calls: [{ function: { name: "check_recalls", arguments: {} } }] });
    expect(messages[3]).toMatchObject({ role: "tool", tool_name: "check_recalls" });
    // voice text first, then compact data so a model can act on ids and SKUs the voice text omits
    expect(messages[3]?.content.startsWith("Recalls.\nDATA: {")).toBe(true);
    expect(messages[3]?.content).not.toContain("photoUrl");
    expect(messages[4]?.role).toBe("assistant");
  });
});
