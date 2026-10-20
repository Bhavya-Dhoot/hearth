import type { FindPartOutput } from "@hearth/contracts";
import { mountWidget, type RenderContext } from "../runtime/bridge";
import { h, icon } from "../runtime/dom";
import { money, ordinalPhrase, weekdayDate } from "../runtime/format";
import * as icons from "../runtime/icons";
import "../styles/parts-carousel.css";

type Item = FindPartOutput["items"][number];

function partCard(item: Item, index: number, selected: boolean, ctx: RenderContext): HTMLElement {
  const card = h(
    "button",
    {
      class: `part${selected ? " part--selected" : ""}${index > 0 ? " part--stream" : ""}`,
      type: "button",
      style: { "--i": index },
      "data-voice-index": index,
      "aria-pressed": selected ? "true" : "false",
      "aria-label": `${index + 1}. ${item.name}, ${money(item.price)}. Say ${ordinalPhrase(index)} to choose it.`,
      on: { click: () => ctx.act({ name: "select_part", args: { index, sku: item.sku } }, card) },
    },
    h(
      "span",
      { class: "part__top" },
      h("span", { class: "part__numeral numeral", "aria-hidden": "true" }, String(index + 1)),
      h("span", { class: "part__art" }, h("img", { src: item.image, alt: "", decoding: "async", draggable: "false" })),
    ),
    h(
      "span",
      { class: "part__flags" },
      h("span", { class: `chip part__badge${item.badge === "EXACT FIT" ? " part__badge--exact" : ""}` }, item.badge === "EXACT FIT" ? icon(icons.shieldCheck) : null, item.badge),
      selected ? h("span", { class: "part__selected mono" }, icon(icons.check), "SELECTED") : null,
    ),
    h("span", { class: "part__name" }, item.name),
    h("span", { class: "part__price display" }, money(item.price)),
    h("span", { class: "part__fit small" }, item.fitReason),
    h(
      "span",
      { class: "part__meta" },
      h("span", { class: "part__eta mono" }, icon(icons.truck), `Arrives ${weekdayDate(item.etaDate)}`),
      h("span", { class: "part__sku mono dim" }, `SKU ${item.sku}`),
    ),
  );
  return card;
}

function render(props: FindPartOutput, ctx: RenderContext): HTMLElement {
  const { items, selectedIndex } = props;
  const track = h("ol", { class: "parts__track", style: { "--n": items.length } });
  items.forEach((item, i) => track.append(h("li", { class: "parts__cell" }, partCard(item, i, i === selectedIndex, ctx))));

  return h(
    "section",
    { class: "parts", "aria-label": props.title },
    h(
      "header",
      { class: "parts__head" },
      h(
        "div",
        { class: "parts__heading" },
        h("p", { class: "mono-label" }, props.assetLabel ? `For your ${props.assetLabel}` : `Part: ${props.partRole.replace(/_/g, " ")}`),
        h("h1", { class: "title parts__title" }, props.title),
      ),
      h(
        "p",
        { class: "parts__say mono" },
        icon(icons.microphone),
        `Say "order ${ordinalPhrase(0)}"`,
      ),
    ),
    track,
  );
}

mountWidget({ name: "parts-carousel", skeleton: "cards", render });
