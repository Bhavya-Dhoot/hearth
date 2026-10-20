import {
  HostToWidget,
  WidgetProps,
  type HostContext,
  type WidgetAction,
  type WidgetName,
  type WidgetPropsOf,
  type WidgetToHost,
} from "@hearth/contracts";
import { h, icon } from "./dom";
import * as icons from "./icons";
import { inkDefs } from "./stamp";
import { skeleton, type SkeletonShape } from "./skeleton";
import "../styles/fonts.css";
import "../styles/base.css";

/** What a widget module supplies. Everything else (bridge, validation, theming, resizing) lives here. */
export interface WidgetDefinition<W extends WidgetName> {
  name: W;
  skeleton: SkeletonShape;
  render(props: WidgetPropsOf<W>, ctx: RenderContext): HTMLElement;
  /**
   * How many times render can be asked to give up one more piece of secondary content (see RenderContext.level)
   * for these props. Omit when the layout never needs it.
   */
  levels?(props: WidgetPropsOf<W>): number;
}

export interface RenderContext {
  host: HostContext;
  /**
   * 0 renders everything. In a fixed frame (Show 8 fullscreen, Show 15 tile) the bridge measures the render and, while it is
   * taller than hostContext.maxHeight, renders again one level higher. Each step gives up the least important content first,
   * so a widget always fits the frame at full scale instead of being scaled down by the host.
   */
  level: number;
  /** Post a tap to the host. `source` is locked until the next render so a double tap cannot double-fire. */
  act(action: WidgetAction, source?: HTMLElement): void;
}

const DEFAULT_HOST: HostContext = {
  deviceClass: "echo-show-8",
  maxWidth: 1280,
  maxHeight: 800,
  isMobile: false,
  platform: "alexa-plus-host-sim",
  displayMode: "fullscreen",
  safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  deviceCapabilities: { touch: true, camera: true, voice: true, screen: true },
  theme: "dark",
};

/** At or below this frame height (Show 8 gives 680, the reference context 800) layouts use their tight, one-screen form. */
const TIGHT_MAX_HEIGHT = 840;

const PENDING_RELEASE_MS = 2500;
const PULSE_MS = 1100;

function post(message: WidgetToHost): void {
  window.parent.postMessage(message, "*");
}

/** A frame with a fixed height the host will not scroll: fullscreen or a tile on a screen device. Phones scroll at natural height. */
const isFixedFrame = (ctx: HostContext): boolean => !ctx.isMobile && ctx.maxHeight > 0 && ctx.displayMode !== "inline";

/** Sets theme, device scale and frame limits on <html>; tokens.css does the rest. */
function applyHostContext(ctx: HostContext): void {
  const root = document.documentElement;
  root.dataset.theme = ctx.theme;
  // Voice-only never draws a frame; if a host renders anyway, use the Show 8 scale.
  root.dataset.device = ctx.deviceClass === "voice-only" ? "echo-show-8" : ctx.deviceClass;
  root.dataset.display = ctx.displayMode;
  const fixed = isFixedFrame(ctx);
  root.dataset.frame = fixed ? "fixed" : "flow";
  // Density follows the room the host actually gives, not the device class.
  root.dataset.density = fixed && ctx.maxHeight <= TIGHT_MAX_HEIGHT ? "tight" : "roomy";
  // Only a fullscreen frame is stretched to the screen; a tile or inline card is as tall as its content.
  const fills = ctx.displayMode === "fullscreen" && !ctx.isMobile;
  root.style.setProperty("--max-w", ctx.maxWidth > 0 ? `${ctx.maxWidth}px` : "none");
  root.style.setProperty("--min-h", fills && ctx.maxHeight > 0 ? `${ctx.maxHeight}px` : "0px");
  const inset = ctx.displayMode === "fullscreen" ? ctx.safeAreaInsets : { top: 0, right: 0, bottom: 0, left: 0 };
  root.style.setProperty("--safe-top", `${inset.top}px`);
  root.style.setProperty("--safe-right", `${inset.right}px`);
  root.style.setProperty("--safe-bottom", `${inset.bottom}px`);
  root.style.setProperty("--safe-left", `${inset.left}px`);
}

function errorStrip(widget: string, detail: string): HTMLElement {
  return h(
    "div",
    { class: "error-strip", role: "alert" },
    icon(icons.warning, "error-strip__icon"),
    h("div", null, h("p", { class: "error-strip__title" }, "This card could not be shown."), h("p", { class: "mono-label" }, `${widget}: ${detail}`)),
  );
}

function pulse(el: Element | null): void {
  if (!(el instanceof HTMLElement)) return;
  el.scrollIntoView({ block: "nearest", inline: "center", behavior: "auto" });
  el.classList.remove("voice-pulse");
  void el.offsetWidth;
  el.classList.add("voice-pulse");
  window.setTimeout(() => el.classList.remove("voice-pulse"), PULSE_MS);
}

export function mountWidget<W extends WidgetName>(def: WidgetDefinition<W>): void {
  const app = document.getElementById("app");
  if (!app) throw new Error("#app missing");
  const schema = WidgetProps[def.name];

  let host: HostContext = DEFAULT_HOST;
  let lastProps: unknown;
  let lastHeight = -1;
  let level = 0;
  let maxLevel = 0;

  applyHostContext(host);
  document.body.append(inkDefs(), h("div", { class: "listening-mark", "aria-live": "polite" }, icon(icons.microphone), "LISTENING"));
  app.replaceChildren(skeleton(def.skeleton));

  const postResize = (force: boolean): void => {
    const height = Math.ceil(app.getBoundingClientRect().height);
    if (!force && height === lastHeight) return;
    lastHeight = height;
    post({ type: "ui/resize", height });
  };

  const ctx: RenderContext = {
    get host() {
      return host;
    },
    get level() {
      return level;
    },
    act(action, source) {
      if (source) {
        source.dataset.pending = "true";
        source.setAttribute("aria-disabled", "true");
        window.setTimeout(() => {
          delete source.dataset.pending;
          source.removeAttribute("aria-disabled");
        }, PENDING_RELEASE_MS);
      }
      post({ type: "ui/action", action });
    },
  };

  const overflows = (): boolean => app.getBoundingClientRect().height > host.maxHeight + 0.5;

  /** Late layout changes (fonts, images) can push a fitted render over the frame; step up a level, never back down. */
  const refit = (): void => {
    if (lastProps === undefined || level >= maxLevel || !overflows()) return;
    const parsed = schema.safeParse(lastProps);
    if (!parsed.success) return;
    const props = parsed.data as WidgetPropsOf<W>;
    do {
      level++;
      app.replaceChildren(def.render(props, ctx));
    } while (level < maxLevel && overflows());
  };

  const render = (): void => {
    if (lastProps === undefined) return;
    const parsed = schema.safeParse(lastProps);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const detail = issue ? `${issue.path.join(".") || "props"} ${issue.message}` : "invalid props";
      app.replaceChildren(errorStrip(def.name, detail));
      post({ type: "ui/error", message: `${def.name}: ${detail}` });
    } else {
      try {
        const props = parsed.data as WidgetPropsOf<W>;
        maxLevel = isFixedFrame(host) ? (def.levels?.(props) ?? 0) : 0;
        level = 0;
        app.replaceChildren(def.render(props, ctx));
        // Give up secondary content one level at a time until the frame holds it. Layout is read synchronously, so no flash.
        while (level < maxLevel && overflows()) {
          level++;
          app.replaceChildren(def.render(props, ctx));
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : "render failed";
        app.replaceChildren(errorStrip(def.name, detail));
        post({ type: "ui/error", message: `${def.name}: ${detail}` });
      }
    }
    postResize(true);
  };

  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window.parent) return;
    const message = HostToWidget.safeParse(event.data);
    if (!message.success) return;
    const data = message.data;
    if (data.type === "ui/hostContext") {
      const changed = JSON.stringify(host) !== JSON.stringify(data.payload);
      host = data.payload;
      applyHostContext(host);
      if (changed) render();
      postResize(true);
    } else if (data.type === "ui/render") {
      lastProps = data.props;
      render();
    } else {
      const intent = data.intent;
      const root = document.documentElement;
      if (intent.kind === "listening") root.dataset.listening = "true";
      else if (intent.kind === "idle") delete root.dataset.listening;
      else if (intent.kind === "select_index") pulse(app.querySelector(`[data-voice-index="${intent.index ?? 0}"]`));
      else pulse(app.querySelector(`[data-voice="${intent.kind}"]`));
    }
  });

  new ResizeObserver(() => {
    postResize(false);
    // Out of the observer callback: changing the DOM inside it is what raises "loop completed with undelivered notifications".
    window.requestAnimationFrame(() => {
      refit();
      postResize(false);
    });
  }).observe(app);
  // The first render can happen on fallback fonts; measure again once the real ones are in.
  void document.fonts?.ready.then(() => render());
  post({ type: "ui/ready" });
}
