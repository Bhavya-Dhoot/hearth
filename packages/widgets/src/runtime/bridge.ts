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
}

export interface RenderContext {
  host: HostContext;
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

const PENDING_RELEASE_MS = 2500;
const PULSE_MS = 1100;

function post(message: WidgetToHost): void {
  window.parent.postMessage(message, "*");
}

/** Sets theme, device scale and frame limits on <html>; tokens.css does the rest. */
function applyHostContext(ctx: HostContext): void {
  const root = document.documentElement;
  root.dataset.theme = ctx.theme;
  // Voice-only never draws a frame; if a host renders anyway, use the Show 8 scale.
  root.dataset.device = ctx.deviceClass === "voice-only" ? "echo-show-8" : ctx.deviceClass;
  root.dataset.display = ctx.displayMode;
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
        app.replaceChildren(def.render(parsed.data as WidgetPropsOf<W>, ctx));
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

  new ResizeObserver(() => postResize(false)).observe(app);
  post({ type: "ui/ready" });
}
