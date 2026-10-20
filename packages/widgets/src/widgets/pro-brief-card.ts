import type { ProBriefOutput } from "@hearth/contracts";
import { mountWidget, type RenderContext } from "../runtime/bridge";
import { h, icon } from "../runtime/dom";
import { breakableUrl, plural } from "../runtime/format";
import * as icons from "../runtime/icons";
import { qrSvg } from "../runtime/qr";
import { stamp } from "../runtime/stamp";
import "../styles/pro-brief-card.css";

const TRADE_LABEL: Record<ProBriefOutput["trade"], string> = {
  plumber: "Plumber",
  electrician: "Electrician",
  hvac: "HVAC technician",
  appliance: "Appliance repair",
  gas_utility: "Gas utility",
  general: "General contractor",
};

const field = (label: string, value: string): HTMLElement => h("div", { class: "spec" }, h("dt", { class: "mono-label" }, label), h("dd", { class: "spec__value mono" }, value));

/** The mono line a trimmed block ends with: "and 1 earlier on your phone". */
const andMore = (count: number, what: string): HTMLElement => h("p", { class: "mono-label more" }, `and ${count} ${what} on your phone`);

const section = (label: string, ...body: (Node | string | null)[]): HTMLElement => h("section", { class: "block" }, h("h2", { class: "block__label mono-label" }, label), ...body);

/** What a fixed frame keeps of the brief at each level; the rest is on the phone and at the share link. */
interface Keep {
  photos: boolean;
  timeline: number;
  tried: number;
  /** A smaller QR code. */
  qrSmall: boolean;
  /** The access notes and the timeline swap columns, when the right column is the one that overflows. */
  accessLeft: boolean;
}

/** One cumulative trim per level, least important first: photos, older timeline entries, attempts, then the QR size, the columns swap, and last the timeline. */
function trims(props: ProBriefOutput): Array<(keep: Keep) => void> {
  const steps: Array<(keep: Keep) => void> = [];
  if (props.photos.length > 0) steps.push((k) => void (k.photos = false));
  for (let n = props.timeline.length; n > 2; n--) steps.push((k) => void (k.timeline = Math.min(k.timeline, n - 1)));
  for (let n = props.attempted.length; n > 2; n--) steps.push((k) => void (k.tried = Math.min(k.tried, n - 1)));
  if (props.timeline.length > 1) steps.push((k) => void (k.timeline = 1));
  for (let n = Math.min(props.attempted.length, 2); n > 0; n--) steps.push((k) => void (k.tried = n - 1));
  steps.push((k) => void (k.qrSmall = true), (k) => void (k.accessLeft = true));
  if (props.timeline.length > 0) steps.push((k) => void (k.timeline = 0));
  return steps;
}

function keepAt(props: ProBriefOutput, level: number): Keep {
  const keep: Keep = { photos: true, timeline: props.timeline.length, tried: props.attempted.length, qrSmall: false, accessLeft: false };
  trims(props).slice(0, level).forEach((trim) => trim(keep));
  return keep;
}

function render(props: ProBriefOutput, ctx: RenderContext): HTMLElement {
  const keep = keepAt(props, ctx.level);
  // The timeline reads oldest first, so the entries that survive a trim are the latest ones.
  const timeline = props.timeline.slice(props.timeline.length - keep.timeline);
  const earlier = props.timeline.length - timeline.length;
  const tried = props.attempted.slice(0, keep.tried);
  const triedHidden = props.attempted.length - tried.length;
  const findPro = h(
    "button",
    {
      class: "btn btn--ink btn--block brief__cta",
      type: "button",
      "data-find-pro": props.briefId,
      on: { click: () => ctx.act({ name: "find_pro", args: { briefId: props.briefId } }, findPro) },
    },
    "Find a pro",
    icon(icons.arrowRight),
  );

  const photos =
    props.photos.length > 0 && keep.photos
      ? h(
          "ul",
          { class: "photos", "aria-label": `${props.photos.length} ${plural(props.photos.length, "photo")}` },
          ...props.photos.map((url, i) => h("li", { class: "photos__item" }, h("img", { src: url, alt: `Brief photo ${i + 1}`, decoding: "async", draggable: "false" }))),
        )
      : null;

  const access = section("Access", h("p", { class: "small" }, props.accessNotes));
  const timelineBlock =
    props.timeline.length > 0
      ? section(
          "Timeline",
          timeline.length > 0 ? h("ol", { class: "timeline" }, ...timeline.map((entry) => h("li", { class: "timeline__item" }, h("span", { class: "timeline__ts mono" }, entry.ts), h("span", null, entry.text)))) : null,
          earlier > 0 ? andMore(earlier, timeline.length > 0 ? "earlier" : props.timeline.length === 1 ? "entry" : "entries") : null,
        )
      : null;

  return h(
    "article",
    { class: `brief${keep.qrSmall ? " brief--qr-small" : ""}`, "aria-label": "Job brief" },
    h(
      "header",
      { class: "brief__top" },
      h(
        "div",
        { class: "brief__id" },
        h("p", { class: "mono-label brief__order" }, "Work order"),
        h("p", { class: "mono brief__no" }, `No. ${props.briefId.toUpperCase()}`),
        h("p", { class: "mono brief__trade" }, `For: ${TRADE_LABEL[props.trade]}`),
      ),
      h("h1", { class: "brief__headline display" }, props.headline),
      h("div", { class: "brief__stamp" }, stamp("Job brief", "copper")),
    ),
    h("div", { class: "perforation", "aria-hidden": "true" }),
    h(
      "div",
      { class: "brief__body" },
      h(
        "div",
        { class: "brief__col" },
        h("dl", { class: "specs" }, field("Brand", props.asset.brand), field("Model", props.asset.model), field("Age", `${props.asset.ageYears} ${plural(props.asset.ageYears, "YR")}`)),
        section("Symptom", h("p", { class: "brief__symptom" }, props.symptom)),
        keep.accessLeft ? access : null,
        keep.accessLeft ? null : timelineBlock,
        tried.length > 0
          ? section(
              "Already tried",
              h("ul", { class: "tried" }, ...tried.map((text) => h("li", { class: "tried__item" }, icon(icons.check), h("span", null, text)))),
              triedHidden > 0 ? andMore(triedHidden, "more") : null,
            )
          : null,
      ),
      h(
        "aside",
        { class: "brief__side" },
        h(
          "div",
          { class: "share" },
          h("div", { class: "share__qr" }, qrSvg(props.qrPayload, "QR code linking to this brief")),
          h("p", { class: "mono-label share__label" }, "Scan to share"),
          h("p", { class: "share__url mono" }, ...breakableUrl(props.shareUrl)),
        ),
        photos,
        keep.accessLeft ? timelineBlock : access,
        findPro,
      ),
    ),
  );
}

mountWidget({ name: "pro-brief-card", skeleton: "split", render, levels: (props) => trims(props).length });
