import { h } from "./dom";

export type SkeletonShape = "split" | "rows" | "cards";

const bar = (width: string, tall = false) => h("span", { class: `skel__bar${tall ? " skel__bar--tall" : ""}`, style: { width } });

/** Loading placeholder shaped like the final layout, shown until ui/render arrives. */
export function skeleton(shape: SkeletonShape): HTMLElement {
  const root = h("div", { class: `skel skel--${shape}`, role: "status", "aria-label": "Loading" });
  root.append(h("span", { class: "mono-label" }, "Loading"));
  if (shape === "split") {
    root.append(h("div", { class: "skel__split" }, h("span", { class: "skel__block" }), h("div", { class: "skel__col" }, bar("34%"), bar("92%", true), bar("78%", true), bar("60%"))));
  } else if (shape === "rows") {
    for (let i = 0; i < 4; i++) root.append(h("div", { class: "skel__row" }, h("span", { class: "skel__dot" }), h("div", { class: "skel__col" }, bar("55%", true), bar("82%"))));
  } else {
    root.append(h("div", { class: "skel__cards" }, ...[0, 1, 2].map(() => h("span", { class: "skel__block skel__block--card" }))));
  }
  return root;
}
