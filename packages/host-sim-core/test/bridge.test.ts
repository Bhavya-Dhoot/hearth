import { describe, expect, it } from "vitest";
import { DEVICE_CONTEXTS } from "@hearth/contracts";
import { initialBridgeState, isFromWidget, reduceWidgetMessage, WidgetBridge, type BridgeState } from "../src";

const ctx = DEVICE_CONTEXTS["echo-show-8"];
const props = { issueId: "leak-under-sink-ptrap", stepIndex: 0 };

describe("bridge message handling (pure)", () => {
  it("answers ui/ready with hostContext then render", () => {
    const state: BridgeState = { ready: false, context: ctx, props };
    const step = reduceWidgetMessage(state, { type: "ui/ready" });
    expect(step.state.ready).toBe(true);
    expect(step.outbound).toEqual([
      { type: "ui/hostContext", payload: ctx },
      { type: "ui/render", props },
    ]);
    expect(step.effects).toEqual([{ kind: "ready" }]);
  });

  it("sends nothing on ready when there is nothing to send yet", () => {
    expect(reduceWidgetMessage(initialBridgeState(), { type: "ui/ready" }).outbound).toEqual([]);
  });

  it("rounds a resize up to whole pixels and rejects negative or non-finite heights", () => {
    const s = initialBridgeState();
    expect(reduceWidgetMessage(s, { type: "ui/resize", height: 412.2 }).effects).toEqual([{ kind: "resize", height: 413 }]);
    expect(reduceWidgetMessage(s, { type: "ui/resize", height: -5 }).effects[0]?.kind).toBe("error");
    expect(reduceWidgetMessage(s, { type: "ui/resize", height: Number.NaN }).effects[0]?.kind).toBe("error");
    expect(reduceWidgetMessage(s, { type: "ui/resize", height: "tall" }).effects[0]?.kind).toBe("error");
  });

  it("validates actions against the WidgetAction contract", () => {
    const s = initialBridgeState();
    const ok = reduceWidgetMessage(s, { type: "ui/action", action: { name: "next_step", args: { issueId: "x", stepIndex: 1 } } });
    expect(ok.effects).toEqual([{ kind: "action", action: { name: "next_step", args: { issueId: "x", stepIndex: 1 } } }]);
    for (const bad of [
      { type: "ui/action", action: { name: "next_step", args: { issueId: "x" } } },
      { type: "ui/action", action: { name: "format_disk", args: {} } },
      { type: "ui/action" },
    ]) {
      const step = reduceWidgetMessage(s, bad);
      expect(step.effects).toHaveLength(1);
      expect(step.effects[0]?.kind).toBe("error");
      expect(step.outbound).toEqual([]);
    }
  });

  it("surfaces widget errors and ignores unknown message types and non-objects", () => {
    const s = initialBridgeState();
    expect(reduceWidgetMessage(s, { type: "ui/error", message: "bad props" }).effects).toEqual([{ kind: "error", message: "bad props" }]);
    for (const junk of [null, undefined, 42, "ui/ready", [], { type: "ui/unknown" }, { nope: true }]) {
      const step = reduceWidgetMessage(s, junk);
      expect(step.state).toBe(s);
      expect(step.effects[0]?.kind).toBe("error");
    }
  });

  it("only trusts messages from the iframe's own window", () => {
    const w = {};
    expect(isFromWidget(w, w)).toBe(true);
    expect(isFromWidget({}, w)).toBe(false);
    expect(isFromWidget(null, null)).toBe(false);
    expect(isFromWidget(undefined, undefined)).toBe(false);
  });
});

function fakeIframe() {
  type Listener = (e: { data: unknown; source: unknown }) => void;
  const listeners = new Set<Listener>();
  const posted: { message: unknown; origin: string }[] = [];
  const attrs: Record<string, string> = {};
  const contentWindow = { postMessage: (message: unknown, origin: string) => posted.push({ message, origin }) };
  const view = {
    addEventListener: (_t: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_t: string, fn: Listener) => listeners.delete(fn),
  };
  const iframe = { ownerDocument: { defaultView: view }, contentWindow, setAttribute: (k: string, v: string) => (attrs[k] = v), srcdoc: "" };
  return {
    iframe: iframe as unknown as HTMLIFrameElement,
    raw: iframe,
    posted,
    attrs,
    listeners,
    fromWidget: (data: unknown) => listeners.forEach((l) => l({ data, source: contentWindow })),
    fromElsewhere: (data: unknown) => listeners.forEach((l) => l({ data, source: {} })),
  };
}

describe("WidgetBridge", () => {
  const make = () => {
    const env = fakeIframe();
    const seen = { actions: [] as unknown[], heights: [] as number[], errors: [] as string[], ready: 0 };
    const bridge = new WidgetBridge(env.iframe, {
      onAction: (a) => seen.actions.push(a),
      onResize: (h) => seen.heights.push(h),
      onError: (m) => seen.errors.push(m),
      onReady: () => (seen.ready += 1),
    });
    return { env, seen, bridge };
  };

  it("sandboxes the iframe, loads the html, and waits for ui/ready before sending", () => {
    const { env, bridge, seen } = make();
    bridge.mount("<p>widget</p>", ctx, props);
    expect(env.attrs.sandbox).toBe("allow-scripts");
    expect(env.raw.srcdoc).toBe("<p>widget</p>");
    expect(env.posted).toHaveLength(0);
    env.fromWidget({ type: "ui/ready" });
    expect(env.posted.map((p) => (p.message as { type: string }).type)).toEqual(["ui/hostContext", "ui/render"]);
    expect(env.posted.every((p) => p.origin === "*")).toBe(true);
    expect(seen.ready).toBe(1);
  });

  it("ignores messages from other windows", () => {
    const { env, bridge, seen } = make();
    bridge.mount("<p/>", ctx, props);
    env.fromElsewhere({ type: "ui/ready" });
    env.fromElsewhere({ type: "ui/action", action: { name: "done", args: { issueId: "x" } } });
    expect(env.posted).toHaveLength(0);
    expect(seen.actions).toHaveLength(0);
    expect(seen.ready).toBe(0);
  });

  it("forwards valid actions and resizes, and reports invalid messages", () => {
    const { env, bridge, seen } = make();
    bridge.mount("<p/>", ctx, props);
    env.fromWidget({ type: "ui/ready" });
    env.fromWidget({ type: "ui/resize", height: 300.4 });
    env.fromWidget({ type: "ui/action", action: { name: "done", args: { issueId: "x" } } });
    env.fromWidget({ type: "ui/action", action: { name: "nope", args: {} } });
    env.fromWidget({ type: "ui/error", message: "props did not validate" });
    expect(seen.heights).toEqual([301]);
    expect(seen.actions).toEqual([{ name: "done", args: { issueId: "x" } }]);
    expect(seen.errors).toHaveLength(2);
    expect(seen.errors[1]).toBe("props did not validate");
  });

  it("holds context and render until ready, then posts live updates immediately", () => {
    const { env, bridge } = make();
    bridge.mount("<p/>", ctx, props);
    bridge.setContext({ ...ctx, theme: "light" });
    bridge.render({ stepIndex: 2 });
    bridge.voiceIntent({ kind: "next" });
    expect(env.posted).toHaveLength(0);
    env.fromWidget({ type: "ui/ready" });
    expect(env.posted.map((p) => p.message)).toEqual([
      { type: "ui/hostContext", payload: { ...ctx, theme: "light" } },
      { type: "ui/render", props: { stepIndex: 2 } },
    ]);
    bridge.setContext(ctx);
    bridge.render({ stepIndex: 3 });
    bridge.voiceIntent({ kind: "select_index", index: 1 });
    expect(env.posted.slice(2).map((p) => p.message)).toEqual([
      { type: "ui/hostContext", payload: ctx },
      { type: "ui/render", props: { stepIndex: 3 } },
      { type: "ui/voice-intent", intent: { kind: "select_index", index: 1 } },
    ]);
  });

  it("rejects a malformed host context before it reaches the widget", () => {
    const { bridge } = make();
    expect(() => bridge.mount("<p/>", { ...ctx, theme: "sepia" } as never, props)).toThrow();
  });

  it("stops listening after destroy", () => {
    const { env, bridge, seen } = make();
    bridge.mount("<p/>", ctx, props);
    expect(env.listeners.size).toBe(1);
    bridge.destroy();
    expect(env.listeners.size).toBe(0);
    env.fromWidget({ type: "ui/ready" });
    bridge.render({ a: 1 });
    expect(env.posted).toHaveLength(0);
    expect(seen.ready).toBe(0);
    expect(() => bridge.mount("<p/>", ctx, props)).toThrow("destroyed");
  });

  it("re-sends context and the latest props when a remounted document says ready again", () => {
    const { env, bridge } = make();
    bridge.mount("<p>one</p>", ctx, props);
    env.fromWidget({ type: "ui/ready" });
    bridge.mount("<p>two</p>", ctx, { stepIndex: 1 });
    expect(env.raw.srcdoc).toBe("<p>two</p>");
    bridge.render({ stepIndex: 9 });
    expect(env.posted).toHaveLength(2);
    env.fromWidget({ type: "ui/ready" });
    expect(env.posted.slice(2).map((p) => p.message)).toEqual([
      { type: "ui/hostContext", payload: ctx },
      { type: "ui/render", props: { stepIndex: 9 } },
    ]);
  });
});
