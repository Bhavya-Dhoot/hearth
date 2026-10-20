/** Minimal DOM construction helpers. Text always goes through text nodes; only static icon markup uses innerHTML. */

export type Child = Node | string | number | null | undefined | false;
export type AttrValue = string | number | boolean | null | undefined;
export interface Attrs {
  class?: string;
  /** CSS custom properties or properties, applied with setProperty. */
  style?: Record<string, string | number>;
  on?: { click?: (event: MouseEvent) => void; keydown?: (event: KeyboardEvent) => void; load?: () => void; error?: () => void };
  [attr: string]: AttrValue | Attrs["style"] | Attrs["on"];
}

const SVG_NS = "http://www.w3.org/2000/svg";

function apply(el: Element, attrs: Attrs | null | undefined): void {
  if (!attrs) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class" && typeof value === "string") el.setAttribute("class", value);
    else if (key === "style" && typeof value === "object") {
      const style = (el as HTMLElement | SVGElement).style;
      for (const [prop, v] of Object.entries(value as Record<string, string | number>)) style.setProperty(prop, String(v));
    } else if (key === "on" && typeof value === "object") {
      for (const [type, handler] of Object.entries(value as NonNullable<Attrs["on"]>)) {
        if (handler) el.addEventListener(type, handler as EventListener);
      }
    } else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
}

/** Sizes, fractions and part numbers that must not break across lines: "1-1/2", "3/4", "HR-PT-150-WSH". */
const KEEP_TOGETHER = /\d+-\d+\/\d+|\d+\/\d+|\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/g;

function textNodes(text: string): Node[] {
  const nodes: Node[] = [];
  let last = 0;
  for (const match of text.matchAll(KEEP_TOGETHER)) {
    const at = match.index ?? 0;
    if (at > last) nodes.push(document.createTextNode(text.slice(last, at)));
    const keep = document.createElement("span");
    keep.className = "nb";
    keep.textContent = match[0];
    nodes.push(keep);
    last = at + match[0].length;
  }
  if (last < text.length || nodes.length === 0) nodes.push(document.createTextNode(text.slice(last)));
  return nodes;
}

function append(el: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (typeof child === "string") el.append(...textNodes(child));
    else if (typeof child === "number") el.append(document.createTextNode(String(child)));
    else el.append(child);
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

/** Wraps one of the raw Phosphor SVG strings from ./icons in a decorative span. */
export function icon(markup: string, className = ""): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className ? `icon ${className}` : "icon";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = markup;
  return span;
}
