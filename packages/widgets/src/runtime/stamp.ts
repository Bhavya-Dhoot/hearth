import { h, s } from "./dom";

export type StampTone = "hazard" | "moss" | "signal";

/** Hidden SVG holding the ink-texture filter. Added once per document; stamps reference it from CSS. */
export function inkDefs(): SVGSVGElement {
  const svg = s(
    "svg",
    { class: "ink-defs", width: "0", height: "0", "aria-hidden": "true", focusable: "false" },
    s(
      "defs",
      null,
      s(
        "filter",
        { id: "hearth-ink", x: "-4%", y: "-8%", width: "108%", height: "116%", "color-interpolation-filters": "sRGB" },
        s("feTurbulence", { type: "fractalNoise", baseFrequency: "0.8", numOctaves: "2", seed: "7", result: "grain" }),
        s("feColorMatrix", { in: "grain", type: "matrix", values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -3.2 0 0 0 2.35", result: "mask" }),
        s("feTurbulence", { type: "fractalNoise", baseFrequency: "0.04", numOctaves: "1", seed: "3", result: "warp" }),
        s("feDisplacementMap", { in: "SourceGraphic", in2: "warp", scale: "2.2", xChannelSelector: "R", yChannelSelector: "G", result: "rough" }),
        s("feComposite", { in: "rough", in2: "mask", operator: "in" }),
      ),
    ),
  );
  return svg;
}

/** A rotated rounded-rect rubber stamp. Colour is chosen by tone; hazard = recall, moss = ordered/done, signal = neutral "look here" (the job brief). */
export function stamp(label: string, tone: StampTone, extraClass = ""): HTMLSpanElement {
  return h("span", { class: `stamp stamp--${tone} ${extraClass}`.trim() }, h("span", { class: "stamp__text" }, label));
}
