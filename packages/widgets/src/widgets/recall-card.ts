import type { RecallsOutput } from "@hearth/contracts";
import { mountWidget, type RenderContext } from "../runtime/bridge";
import { h, icon } from "../runtime/dom";
import { plural } from "../runtime/format";
import * as icons from "../runtime/icons";
import { moreOnPhone } from "../runtime/more";
import { stamp } from "../runtime/stamp";
import "../styles/recall-card.css";

type Flag = RecallsOutput["flagged"][number];

function flagCard(flag: Flag): HTMLElement {
  return h(
    "article",
    { class: "flag" },
    h(
      "div",
      { class: "flag__head" },
      h("div", { class: "flag__stamp" }, stamp("Recall", "hazard", "stamp--animate")),
      h(
        "div",
        { class: "flag__id" },
        h("p", { class: "mono-label" }, `${flag.assetName}, ${flag.brand} ${flag.model}`),
        h("h2", { class: "title flag__title" }, flag.title),
        h("p", { class: "flag__ref mono dim" }, `RECALL ${flag.recallId}`, flag.isSample ? h("span", { class: "chip flag__sample" }, "SAMPLE") : null),
      ),
    ),
    h("p", { class: "flag__hazard" }, h("span", { class: "mono-label flag__label" }, "Hazard"), flag.hazard),
    h(
      "div",
      { class: "remedy" },
      h("h3", { class: "mono-label" }, "What to do"),
      h(
        "ol",
        { class: "remedy__steps" },
        ...flag.remedy.map((step, i) => h("li", { class: "remedy__step" }, h("span", { class: "remedy__n numeral", "aria-hidden": "true" }, String(i + 1)), h("span", { class: "remedy__text" }, step))),
      ),
    ),
  );
}

function render(props: RecallsOutput, ctx: RenderContext): HTMLElement {
  const count = props.flagged.length;
  const head = h(
    "header",
    { class: "recalls__head" },
    h(
      "div",
      null,
      h("p", { class: "mono-label" }, `Recall check, ${props.checkedCount} ${plural(props.checkedCount, "thing")} checked`),
      h("h1", { class: "display recalls__title" }, count === 0 ? "Nothing in your home matches a recall" : `${count} ${plural(count, "match", "matches")} in your home`),
    ),
    h("div", { class: "dataset" }, h("span", { class: "chip dataset__chip" }, "SAMPLE DATASET"), h("p", { class: "dataset__label mono dim" }, props.datasetLabel)),
  );

  if (count === 0) {
    return h(
      "section",
      { class: "recalls", "aria-label": "Recall check" },
      head,
      h("div", { class: "recalls__empty" }, icon(icons.shieldCheck, "recalls__icon"), h("p", { class: "title" }, `All ${props.checkedCount} ${plural(props.checkedCount, "thing")} checked against the sample dataset.`), h("p", { class: "small dim" }, "Hearth will flag anything that matches when you add new appliances.")),
    );
  }

  // In a fixed frame the bridge raises ctx.level until it fits: further matches go to the phone, the first always stays.
  const shown = props.flagged.slice(0, props.flagged.length - ctx.level);
  const hidden = props.flagged.length - shown.length;
  return h("section", { class: "recalls", "aria-label": "Recall check" }, head, ...shown.map(flagCard), hidden > 0 ? moreOnPhone(hidden, hidden === 1 ? "match" : "matches") : null);
}

mountWidget({ name: "recall-card", skeleton: "split", render, levels: (props) => Math.max(0, props.flagged.length - 1) });
