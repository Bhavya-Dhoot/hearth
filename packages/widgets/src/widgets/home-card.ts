import type { HomeProfileOutput } from "@hearth/contracts";
import { mountWidget, type RenderContext } from "../runtime/bridge";
import { h, icon } from "../runtime/dom";
import { plural, shortDate, typeLabel } from "../runtime/format";
import * as icons from "../runtime/icons";
import { moreOnPhone } from "../runtime/more";
import "../styles/home-card.css";

type Event = HomeProfileOutput["recentEvents"][number];

const EVENT_LABEL: Record<Event["type"], string> = {
  repair: "Repair",
  maintenance: "Maintenance",
  order: "Order",
  escalation: "Escalation",
  added_asset: "Added",
};

function locationCard(loc: HomeProfileOutput["keyLocations"][number], isNew: boolean, thumb: boolean): HTMLElement {
  return h(
    "li",
    { class: `place${isNew ? " place--new" : ""}` },
    thumb
      ? h(
          "div",
          { class: "place__thumb" },
          loc.photoUrl ? h("img", { src: loc.photoUrl, alt: "", decoding: "async", draggable: "false" }) : icon(icons.houseSimple),
        )
      : null,
    h("div", { class: "place__text" }, h("p", { class: "place__label" }, loc.label), h("p", { class: "place__where small dim" }, icon(icons.mapPin), loc.location)),
    isNew ? h("span", { class: "place__new mono" }, "NEW") : null,
  );
}

interface Keep {
  events: number;
  places: number;
  thumbs: boolean;
}

/** One cumulative trim per level, least important first: older events down to two, the place thumbnails, the last events, extra places down to four, then down to two. */
function trims(props: HomeProfileOutput): Array<(keep: Keep) => void> {
  const steps: Array<(keep: Keep) => void> = [];
  for (let n = props.recentEvents.length; n > 2; n--) steps.push((k) => void (k.events = Math.min(k.events, n - 1)));
  if (props.keyLocations.some((loc) => loc.photoUrl)) steps.push((k) => void (k.thumbs = false));
  if (props.recentEvents.length > 1) steps.push((k) => void (k.events = 1));
  for (let n = props.keyLocations.length; n > 4; n--) steps.push((k) => void (k.places = Math.min(k.places, n - 1)));
  if (props.recentEvents.length > 0) steps.push((k) => void (k.events = 0));
  for (let n = Math.min(props.keyLocations.length, 4); n > 2; n--) steps.push((k) => void (k.places = Math.min(k.places, n - 1)));
  return steps;
}

function render(props: HomeProfileOutput, ctx: RenderContext): HTMLElement {
  const keep: Keep = { events: props.recentEvents.length, places: props.keyLocations.length, thumbs: true };
  trims(props).slice(0, ctx.level).forEach((trim) => trim(keep));
  const shownPlaces = props.keyLocations.slice(0, keep.places);
  const shownEvents = props.recentEvents.slice(0, keep.events);
  const hiddenPlaces = props.keyLocations.length - shownPlaces.length;

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
          h("ul", { class: "places" }, ...shownPlaces.map((loc) => locationCard(loc, props.highlight?.assetId === loc.assetId, keep.thumbs))),
          hiddenPlaces > 0 ? moreOnPhone(hiddenPlaces, "places") : null,
        )
      : h("section", { class: "panel" }, h("h2", { class: "mono-label" }, "Where things are"), h("p", { class: "small dim" }, "Say where a shut-off or panel is and Hearth will remember it."));

  const hiddenEvents = props.recentEvents.length - shownEvents.length;
  const events =
    props.recentEvents.length > 0
      ? h(
          "section",
          { class: "panel" },
          h("h2", { class: "mono-label" }, "Last events"),
          shownEvents.length > 0
            ? h(
                "ol",
                { class: "events" },
                ...shownEvents.map((event) =>
                  h(
                    "li",
                    { class: "event" },
                    h("span", { class: "event__when mono" }, shortDate(event.ts)),
                    h("span", { class: "event__type mono dim" }, EVENT_LABEL[event.type]),
                    h("span", { class: "event__summary" }, event.summary),
                  ),
                ),
              )
            : null,
          // Only when none fit: a recent event or two is worth more than a line saying the rest are elsewhere.
          shownEvents.length === 0 ? h("p", { class: "mono-label more" }, `${hiddenEvents} ${plural(hiddenEvents, "event")} on your phone`) : null,
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

mountWidget({ name: "home-card", skeleton: "split", render, levels: (props) => trims(props).length });
