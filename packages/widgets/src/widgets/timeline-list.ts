import type { HistoryOutput } from "@hearth/contracts";
import { mountWidget, type RenderContext } from "../runtime/bridge";
import { h, icon } from "../runtime/dom";
import { money, ordinalPhrase, plural, shortDate } from "../runtime/format";
import * as icons from "../runtime/icons";
import { moreOnPhone } from "../runtime/more";
import "../styles/timeline-list.css";

type Event = HistoryOutput["events"][number];

const TYPE_LABEL: Record<Event["type"], string> = {
  repair: "Repair",
  maintenance: "Maintenance",
  order: "Order",
  escalation: "Escalation",
  added_asset: "Added",
};

function eventRow(event: Event, index: number, ctx: RenderContext): HTMLElement {
  const row = h(
    "button",
    {
      class: `event event--${event.type}`,
      type: "button",
      "data-voice-index": index,
      "aria-label": `${index + 1}. ${shortDate(event.ts)}, ${TYPE_LABEL[event.type]}. ${event.summary}. Say ${ordinalPhrase(index)} to open it.`,
      on: { click: () => ctx.act({ name: "open_event", args: { eventId: event.eventId } }, row) },
    },
    h("span", { class: "event__numeral numeral", "aria-hidden": "true" }, String(index + 1)),
    h(
      "span",
      { class: "event__body" },
      h(
        "span",
        { class: "event__meta mono" },
        h("span", { class: "event__date" }, shortDate(event.ts)),
        h("span", { class: `event__type event__type--${event.type}` }, TYPE_LABEL[event.type]),
        event.assetName ? h("span", { class: "event__asset dim" }, event.assetName) : null,
      ),
      h("span", { class: "event__summary" }, event.summary),
    ),
    event.cost !== undefined ? h("span", { class: "chip chip--solid event__cost" }, money(event.cost)) : null,
  );
  return row;
}

function render(props: HistoryOutput, ctx: RenderContext): HTMLElement {
  const head = h(
    "header",
    { class: "timeline__head" },
    h("p", { class: "mono-label" }, "Home timeline"),
    h("h1", { class: "display timeline__title" }, props.title),
    props.events.length > 0 ? h("p", { class: "mono dim" }, `${props.events.length} ${plural(props.events.length, "event")}, newest first`) : null,
  );

  if (props.events.length === 0) {
    return h(
      "section",
      { class: "timeline", "aria-label": props.title },
      head,
      h("div", { class: "timeline__empty" }, icon(icons.calendar), h("p", { class: "title" }, "Nothing logged yet."), h("p", { class: "small dim" }, "Repairs, orders and maintenance show up here as soon as Hearth records them.")),
    );
  }

  // In a fixed frame the bridge raises ctx.level until the rows fit; the older events are one phone away.
  const shown = props.events.slice(0, props.events.length - ctx.level);
  const hidden = props.events.length - shown.length;
  return h(
    "section",
    { class: "timeline", "aria-label": props.title },
    head,
    h("ol", { class: "events" }, ...shown.map((event, i) => h("li", { class: "events__item" }, eventRow(event, i, ctx)))),
    hidden > 0 ? moreOnPhone(hidden, hidden === 1 ? "event" : "events") : null,
  );
}

mountWidget({ name: "timeline-list", skeleton: "rows", render, levels: (props) => Math.max(0, props.events.length - 1) });
