import type { HomeProfileOutput } from "@hearth/contracts";
import { mountWidget } from "../runtime/bridge";
import { h, icon } from "../runtime/dom";
import { plural, shortDate, typeLabel } from "../runtime/format";
import * as icons from "../runtime/icons";
import "../styles/home-card.css";

type Event = HomeProfileOutput["recentEvents"][number];

const EVENT_LABEL: Record<Event["type"], string> = {
  repair: "Repair",
  maintenance: "Maintenance",
  order: "Order",
  escalation: "Escalation",
  added_asset: "Added",
};

function locationCard(loc: HomeProfileOutput["keyLocations"][number], isNew: boolean): HTMLElement {
  return h(
    "li",
    { class: `place${isNew ? " place--new" : ""}` },
    h(
      "div",
      { class: "place__thumb" },
      loc.photoUrl ? h("img", { src: loc.photoUrl, alt: "", decoding: "async", draggable: "false" }) : icon(icons.houseSimple),
    ),
    h("div", { class: "place__text" }, h("p", { class: "place__label" }, loc.label), h("p", { class: "place__where small dim" }, icon(icons.mapPin), loc.location)),
    isNew ? h("span", { class: "place__new mono" }, "NEW") : null,
  );
}

function render(props: HomeProfileOutput): HTMLElement {
  const types = Object.entries(props.inventoryByType)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  const banner = props.highlight
    ? h(
        "div",
        { class: "banner", role: "status" },
        icon(icons.check, "banner__icon"),
        h(
          "p",
          { class: "banner__text" },
          h("span", { class: "mono banner__kicker" }, props.highlight.created ? "ADDED TO HEARTH" : "UPDATED"),
          h("span", { class: "banner__label" }, props.highlight.label),
        ),
      )
    : null;

  const counts = h(
    "div",
    { class: "inventory" },
    h("p", { class: "mono-label" }, "Hearth remembers"),
    h(
      "div",
      { class: "inventory__total" },
      h("p", { class: "inventory__count numeral", "aria-label": `${props.assetCount} things` }, String(props.assetCount)),
      h("p", { class: "inventory__noun title" }, plural(props.assetCount, "thing", "things"), h("br"), "in your home"),
    ),
    h(
      "ul",
      { class: "types" },
      ...types.map(([type, count]) => h("li", { class: "types__row" }, h("span", { class: "types__n numeral" }, String(count)), h("span", { class: "types__label mono" }, typeLabel(type, count)))),
    ),
  );

  const places =
    props.keyLocations.length > 0
      ? h(
          "section",
          { class: "panel" },
          h("h2", { class: "mono-label" }, "Where things are"),
          h("ul", { class: "places" }, ...props.keyLocations.map((loc) => locationCard(loc, props.highlight?.assetId === loc.assetId))),
        )
      : h("section", { class: "panel" }, h("h2", { class: "mono-label" }, "Where things are"), h("p", { class: "small dim" }, "Say where a shut-off or panel is and Hearth will remember it."));

  const events =
    props.recentEvents.length > 0
      ? h(
          "section",
          { class: "panel" },
          h("h2", { class: "mono-label" }, "Last events"),
          h(
            "ol",
            { class: "events" },
            ...props.recentEvents.map((event) =>
              h(
                "li",
                { class: "event" },
                h("span", { class: "event__when mono" }, shortDate(event.ts)),
                h("span", { class: "event__type mono dim" }, EVENT_LABEL[event.type]),
                h("span", { class: "event__summary" }, event.summary),
              ),
            ),
          ),
        )
      : null;

  const issues =
    props.openIssues.length > 0
      ? h(
          "section",
          { class: "panel panel--issues" },
          h("h2", { class: "mono-label" }, `Open ${plural(props.openIssues.length, "issue")}`),
          h("ul", { class: "issues" }, ...props.openIssues.map((issue) => h("li", { class: "issue" }, h("span", null, issue.title), h("span", { class: "chip" }, issue.status.toUpperCase())))),
        )
      : null;

  return h(
    "section",
    { class: "home", "aria-label": props.name },
    h(
      "header",
      { class: "home__head" },
      h("h1", { class: "display home__name" }, props.name),
      h("p", { class: "mono home__where" }, `${props.city}, ${props.state}. Built ${props.yearBuilt}.`),
    ),
    banner,
    h("div", { class: "home__grid" }, counts, h("div", { class: "home__right" }, places, issues)),
    events,
  );
}

mountWidget({ name: "home-card", skeleton: "split", render });
