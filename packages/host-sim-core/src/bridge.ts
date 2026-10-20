import {
  HostContext,
  HostToWidget,
  WidgetToHost,
  type VoiceIntent,
  type WidgetAction,
} from "@hearth/contracts";

/**
 * Host side of the C4 bridge (PRD 9.1).
 *
 *   widget -> host  ui/ready
 *   host   -> widget ui/hostContext, then ui/render
 *   widget -> host  ui/resize (after every layout), ui/action (a tap), ui/error
 *   host   -> widget ui/voice-intent
 *
 * The decision logic is a pure reducer (reduceWidgetMessage) so it can be tested without a DOM; WidgetBridge
 * only wires it to an iframe and to window message events.
 */

/* ------------------------------------------------------------------ pure core */

export interface BridgeState {
  /** True once the widget has posted ui/ready for the current document. */
  ready: boolean;
  context: HostContext | null;
  props: Record<string, unknown> | null;
}

export type BridgeEffect =
  | { kind: "ready" }
  | { kind: "action"; action: WidgetAction }
  | { kind: "resize"; height: number }
  | { kind: "error"; message: string };

export interface BridgeStep {
  state: BridgeState;
  /** Messages to post to the widget, in order. */
  outbound: HostToWidget[];
  effects: BridgeEffect[];
}

export const initialBridgeState = (): BridgeState => ({ ready: false, context: null, props: null });

/** Messages the host sends once the widget is ready: context first, then render, as the contract requires. */
export function readyOutbound(state: BridgeState): HostToWidget[] {
  const out: HostToWidget[] = [];
  if (state.context) out.push({ type: "ui/hostContext", payload: state.context });
  if (state.props) out.push({ type: "ui/render", props: state.props });
  return out;
}

/** Validates one inbound postMessage payload and decides what the host does with it. */
export function reduceWidgetMessage(state: BridgeState, raw: unknown): BridgeStep {
  const parsed = WidgetToHost.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues[0]?.message ?? "unrecognised message";
    return { state, outbound: [], effects: [{ kind: "error", message: `Ignored an invalid widget message: ${detail}` }] };
  }
  const msg = parsed.data;
  switch (msg.type) {
    case "ui/ready": {
      const next: BridgeState = { ...state, ready: true };
      return { state: next, outbound: readyOutbound(next), effects: [{ kind: "ready" }] };
    }
    case "ui/resize": {
      if (msg.height < 0) {
        return { state, outbound: [], effects: [{ kind: "error", message: "Ignored a widget resize with a negative height" }] };
      }
      return { state, outbound: [], effects: [{ kind: "resize", height: Math.ceil(msg.height) }] };
    }
    case "ui/action":
      return { state, outbound: [], effects: [{ kind: "action", action: msg.action }] };
    case "ui/error":
      return { state, outbound: [], effects: [{ kind: "error", message: msg.message }] };
  }
}

/** True when a message event came from the widget iframe's own window (anything else is ignored). */
export const isFromWidget = (source: unknown, iframeWindow: unknown): boolean =>
  source !== null && source !== undefined && source === iframeWindow;

/* ------------------------------------------------------------------ iframe wiring */

export interface WidgetBridgeOptions {
  onAction(a: WidgetAction): void;
  onResize(height: number): void;
  onError?(message: string): void;
  onReady?(): void;
}

export class WidgetBridge {
  private readonly iframe: HTMLIFrameElement;
  private readonly opts: WidgetBridgeOptions;
  private state: BridgeState = initialBridgeState();
  private destroyed = false;
  private listening: Window | undefined;

  constructor(iframe: HTMLIFrameElement, opts: WidgetBridgeOptions) {
    this.iframe = iframe;
    this.opts = opts;
  }

  /**
   * Loads the widget HTML into the sandboxed iframe. The widget posts ui/ready when it has booted; only then are
   * ui/hostContext and ui/render sent. Mounting again resets readiness for the new document.
   */
  mount(html: string, ctx: HostContext, props: Record<string, unknown>): void {
    if (this.destroyed) throw new Error("WidgetBridge was destroyed");
    this.state = { ready: false, context: HostContext.parse(ctx), props };
    this.listen();
    // allow-scripts without allow-same-origin: the widget runs in an opaque origin and cannot touch the host.
    this.iframe.setAttribute("sandbox", "allow-scripts");
    this.iframe.srcdoc = html;
  }

  setContext(ctx: HostContext): void {
    const context = HostContext.parse(ctx);
    this.state = { ...this.state, context };
    this.post({ type: "ui/hostContext", payload: context });
  }

  render(props: Record<string, unknown>): void {
    this.state = { ...this.state, props };
    this.post({ type: "ui/render", props });
  }

  voiceIntent(intent: VoiceIntent): void {
    this.post({ type: "ui/voice-intent", intent });
  }

  destroy(): void {
    this.destroyed = true;
    this.listening?.removeEventListener("message", this.onMessage);
    this.listening = undefined;
    this.state = initialBridgeState();
  }

  private listen(): void {
    if (this.listening) return;
    const view = this.iframe.ownerDocument?.defaultView ?? (typeof window !== "undefined" ? window : null);
    if (!view) return;
    view.addEventListener("message", this.onMessage);
    this.listening = view;
  }

  private readonly onMessage = (event: MessageEvent): void => {
    if (this.destroyed) return;
    if (!isFromWidget(event.source, this.iframe.contentWindow)) return;
    const step = reduceWidgetMessage(this.state, event.data);
    this.state = step.state;
    for (const message of step.outbound) this.send(message);
    for (const effect of step.effects) {
      switch (effect.kind) {
        case "ready":
          this.opts.onReady?.();
          break;
        case "action":
          this.opts.onAction(effect.action);
          break;
        case "resize":
          this.opts.onResize(effect.height);
          break;
        case "error":
          this.opts.onError?.(effect.message);
          break;
      }
    }
  };

  private post(message: HostToWidget): void {
    if (this.destroyed || !this.state.ready) return;
    this.send(message);
  }

  private send(message: HostToWidget): void {
    const target = this.iframe.contentWindow;
    if (!target) return;
    // The sandboxed document has an opaque origin, so the only valid targetOrigin is "*". The source check on
    // inbound messages and the fact that we post only to this iframe's own window bound the exposure.
    target.postMessage(HostToWidget.parse(message), "*");
  }
}
