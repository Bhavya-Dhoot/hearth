import {
  DEVICE_CONTEXTS,
  WidgetToHost,
  type DeviceClass,
  type HostContext,
  type HostToWidget,
  type VoiceIntent,
  type WidgetName,
} from "@hearth/contracts";
import { cssText } from "@hearth/design-tokens";
import { WIDGET_SAMPLES, WIDGET_SAMPLES_EXTRA } from "../src/samples";
import { summarize } from "./summaries";

/* ---------------------------------------------------------------- tokens for the page itself */
const tokens = document.createElement("style");
tokens.textContent = cssText();
document.head.prepend(tokens);

/* ---------------------------------------------------------------- what is on the matrix */
interface Entry {
  id: string;
  widget: WidgetName;
  label: string;
  props: unknown;
}

const ENTRIES: Entry[] = [
  { id: "step-card", widget: "step-card", label: "Step card", props: WIDGET_SAMPLES["step-card"] },
  { id: "step-card-final", widget: "step-card", label: "Step card, last step", props: WIDGET_SAMPLES_EXTRA["step-card"].final },
  { id: "parts-carousel", widget: "parts-carousel", label: "Parts carousel", props: WIDGET_SAMPLES["parts-carousel"] },
  { id: "checkout", widget: "checkout-card", label: "Checkout card", props: WIDGET_SAMPLES_EXTRA["checkout-card"].checkout },
  { id: "confirmation", widget: "checkout-card", label: "Confirmation card", props: WIDGET_SAMPLES_EXTRA["checkout-card"].confirmation },
  { id: "weekend-list", widget: "weekend-list", label: "Weekend list", props: WIDGET_SAMPLES["weekend-list"] },
  { id: "pro-brief-card", widget: "pro-brief-card", label: "Pro brief card", props: WIDGET_SAMPLES["pro-brief-card"] },
  { id: "home-card", widget: "home-card", label: "Home card", props: WIDGET_SAMPLES["home-card"] },
  { id: "timeline-list", widget: "timeline-list", label: "Timeline list", props: WIDGET_SAMPLES["timeline-list"] },
  { id: "recall-card", widget: "recall-card", label: "Recall card", props: WIDGET_SAMPLES["recall-card"] },
  { id: "recall-empty", widget: "recall-card", label: "Recall card, empty", props: WIDGET_SAMPLES_EXTRA["recall-card"].empty },
];

const DEVICES: ReadonlyArray<{ id: DeviceClass; label: string }> = [
  { id: "echo-show-8", label: "Echo Show 8" },
  { id: "echo-show-15", label: "Echo Show 15 tile" },
  { id: "phone", label: "Phone" },
  { id: "voice-only", label: "Voice only" },
];
const THEMES = ["dark", "light"] as const;
type Theme = (typeof THEMES)[number];

/** The MCP server serves illustrations at :4200; this page serves the same files itself so it works offline. */
const MEDIA_FROM = "http://localhost:4200/media/";
function localMedia<T>(value: T): T {
  if (typeof value === "string") return value.startsWith(MEDIA_FROM) ? (`${location.origin}/media/${value.slice(MEDIA_FROM.length)}` as T) : value;
  if (Array.isArray(value)) return value.map((v: unknown) => localMedia(v)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, localMedia(v)])) as T;
  return value;
}

/* ---------------------------------------------------------------- tiny DOM helper */
type Kid = Node | string | null | false;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  for (const kid of kids) if (kid !== null && kid !== false) node.append(kid);
  return node;
}

/* ---------------------------------------------------------------- manifest */
interface Manifest {
  widgets: Record<string, { file: string; uri: string; hash: string; bytes: number }>;
}
let manifest: Manifest | null = null;
const htmlCache = new Map<string, Promise<string>>();
async function widgetHtml(widget: WidgetName): Promise<string> {
  const cached = htmlCache.get(widget);
  if (cached) return cached;
  const task = (async () => {
    manifest ??= (await (await fetch("/ui/manifest.json", { cache: "no-store" })).json()) as Manifest;
    const entry = manifest.widgets[widget];
    if (!entry) throw new Error(`${widget} is not in the manifest. Run: pnpm --filter @hearth/widgets build`);
    return (await fetch(`/ui/${entry.file}`, { cache: "no-store" })).text();
  })();
  htmlCache.set(widget, task);
  return task;
}

/* ---------------------------------------------------------------- global action log */
const actionLog = el("ol", "actionlog__list");
function logTurn(text: string): void {
  actionLog.prepend(el("li", "actionlog__row mono", text));
  while (actionLog.children.length > 40) actionLog.lastElementChild?.remove();
}

/* ---------------------------------------------------------------- one frame = one iframe + host side of the bridge */
const frames = new Set<Frame>();

class Frame {
  readonly node: HTMLElement;
  private readonly iframe = el("iframe", "frame__iframe");
  private readonly stage = el("div", "frame__stage");
  private readonly log = el("ol", "frame__log mono");
  private props: unknown;
  private loaded = false;
  private ctx: HostContext;

  constructor(
    private readonly entry: Entry,
    private readonly device: DeviceClass,
    private readonly theme: Theme,
  ) {
    this.props = localMedia(entry.props);
    this.ctx = { ...DEVICE_CONTEXTS[device], theme };
    this.iframe.setAttribute("sandbox", "allow-scripts");
    this.iframe.setAttribute("title", `${entry.label}, ${device}, ${theme}`);
    this.iframe.style.width = `${this.ctx.maxWidth}px`;
    this.iframe.style.height = `${this.ctx.maxHeight}px`;
    this.stage.append(this.iframe);
    const deviceLabel = DEVICES.find((d) => d.id === device)?.label ?? device;
    const size = this.ctx.maxWidth > 0 ? `${this.ctx.maxWidth} x ${this.ctx.maxHeight}` : "no screen";
    this.node = el(
      "figure",
      `frame frame--${device}`,
      el("figcaption", "frame__cap mono-label", `${deviceLabel}, ${size}, ${theme}`),
      this.stage,
      el("div", "frame__sim mono", "SIMULATED ALEXA+ HOST"),
      this.log,
    );
    if (device === "voice-only") {
      this.stage.className = "frame__voice";
      this.stage.replaceChildren(
        el("p", "mono-label", "No screen. Alexa speaks:"),
        el("p", "frame__speech", summarize(entry.widget, this.props as never)),
        el("p", "mono dim", "The widget is never loaded on this device."),
      );
      this.node.querySelector(".frame__sim")?.remove();
      return;
    }
    frames.add(this);
    this.fit();
  }

  /** Loads the widget when the frame scrolls near the viewport, so 64 iframes do not all boot at once. */
  observe(io: IntersectionObserver): void {
    if (this.device !== "voice-only") io.observe(this.node);
  }

  async load(): Promise<void> {
    if (this.loaded || this.device === "voice-only") return;
    this.loaded = true;
    try {
      this.iframe.srcdoc = await widgetHtml(this.entry.widget);
    } catch (error) {
      this.note("error", error instanceof Error ? error.message : "load failed");
    }
  }

  /** Scales the device-sized iframe down to the cell width. */
  fit(): void {
    if (this.device === "voice-only") return;
    const cell = this.node.clientWidth || 640;
    const scale = Math.min(1, cell / this.ctx.maxWidth);
    this.iframe.style.transform = `scale(${scale})`;
    this.stage.style.width = `${this.ctx.maxWidth * scale}px`;
    this.stage.style.height = `${(Number.parseFloat(this.iframe.style.height) || this.ctx.maxHeight) * scale}px`;
    this.stage.dataset["scale"] = String(scale);
  }

  owns(source: MessageEventSource | null): boolean {
    return source !== null && source === this.iframe.contentWindow;
  }

  send(message: HostToWidget): void {
    this.iframe.contentWindow?.postMessage(message, "*");
    this.note("in", message.type);
  }

  voice(intent: VoiceIntent): void {
    if (this.loaded) this.send({ type: "ui/voice-intent", intent });
  }

  receive(data: unknown): void {
    const parsed = WidgetToHost.safeParse(data);
    if (!parsed.success) {
      this.note("error", "invalid message from widget");
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case "ui/ready":
        this.note("out", "ui/ready");
        this.send({ type: "ui/hostContext", payload: this.ctx });
        this.send({ type: "ui/render", props: this.props as Record<string, unknown> });
        break;
      case "ui/resize": {
        this.note("out", `ui/resize ${message.height}`);
        this.iframe.style.height = `${message.height}px`;
        this.fit();
        break;
      }
      case "ui/action": {
        const turn = `[tap] ${message.action.name} ${JSON.stringify(message.action.args)}`;
        this.note("out", turn);
        logTurn(`${this.entry.label}, ${this.device}, ${this.theme}: ${turn}`);
        // Play the host for the one action whose result is visible in the card: picking a part moves the highlight.
        if (message.action.name === "select_part" && typeof this.props === "object" && this.props) {
          this.props = { ...(this.props as Record<string, unknown>), selectedIndex: message.action.args.index };
          this.send({ type: "ui/render", props: this.props as Record<string, unknown> });
        }
        break;
      }
      case "ui/error":
        this.note("error", message.message);
        break;
    }
  }

  private note(kind: "in" | "out" | "error", text: string): void {
    const row = el("li", `frame__row frame__row--${kind}`, el("span", "frame__dir", kind === "in" ? "HOST > WIDGET" : kind === "out" ? "WIDGET > HOST" : "ERROR"), ` ${text}`);
    this.log.prepend(row);
    while (this.log.children.length > 6) this.log.lastElementChild?.remove();
  }
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  for (const frame of frames) {
    if (frame.owns(event.source)) {
      frame.receive(event.data);
      return;
    }
  }
});

/* ---------------------------------------------------------------- page */
const io = new IntersectionObserver(
  (records) => {
    for (const record of records) {
      if (!record.isIntersecting) continue;
      for (const frame of frames) if (frame.node === record.target) void frame.load();
      io.unobserve(record.target);
    }
  },
  { rootMargin: "800px 0px" },
);

let current = ENTRIES[0]?.id ?? "";
const matrix = el("main", "matrix");
const tabs = el("nav", "tabs");

function build(): void {
  frames.clear();
  matrix.replaceChildren();
  const shown = current === "all" ? ENTRIES : ENTRIES.filter((e) => e.id === current);
  for (const entry of shown) {
    const section = el("section", "entry", el("h2", "entry__title", entry.label), el("p", "mono dim", `ui://hearth/${entry.widget}`));
    for (const device of DEVICES) {
      const row = el("div", `row row--${device.id}`);
      for (const theme of THEMES) {
        // The PRD pairs dark with the Show devices and light with the phone; the other pairing is shown too, as a check.
        const frame = new Frame(entry, device.id, theme);
        frame.observe(io);
        row.append(frame.node);
      }
      section.append(row);
    }
    matrix.append(section);
  }
  requestAnimationFrame(() => frames.forEach((f) => f.fit()));
}

function renderTabs(): void {
  tabs.replaceChildren(
    ...[{ id: "all", label: "All" }, ...ENTRIES.map((e) => ({ id: e.id, label: e.label }))].map((tab) => {
      const button = el("button", `tab mono${tab.id === current ? " tab--on" : ""}`, tab.label);
      button.type = "button";
      button.addEventListener("click", () => {
        current = tab.id;
        renderTabs();
        build();
      });
      return button;
    }),
  );
}

function voiceButton(label: string, intent: VoiceIntent): HTMLButtonElement {
  const button = el("button", "voice mono", label);
  button.type = "button";
  button.addEventListener("click", () => frames.forEach((f) => f.voice(intent)));
  return button;
}

const header = el(
  "header",
  "top",
  el("div", "top__title", el("p", "mono-label", "Hearth widgets"), el("h1", "display", "Preview matrix")),
  el("p", "top__lede small dim", "Every widget on every device and theme. Each frame is a sandboxed iframe running the built HTML from dist/ui; this page plays the host side of the bridge."),
  tabs,
  el(
    "div",
    "voices",
    el("span", "mono-label", "Voice intent"),
    voiceButton("next", { kind: "next" }),
    voiceButton("the first one", { kind: "select_index", index: 0 }),
    voiceButton("the second one", { kind: "select_index", index: 1 }),
    voiceButton("confirm", { kind: "confirm" }),
    voiceButton("cancel", { kind: "cancel" }),
    voiceButton("listening", { kind: "listening" }),
    voiceButton("idle", { kind: "idle" }),
  ),
);

const actions = el("details", "actionlog", el("summary", "mono", "Action log (user turns the host would send)"), actionLog);
actions.open = true;

document.getElementById("root")?.append(header, matrix, actions);
renderTabs();
build();
window.addEventListener("resize", () => frames.forEach((f) => f.fit()));
