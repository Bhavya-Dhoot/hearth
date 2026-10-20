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

const section = (label: string, ...body: (Node | string)[]): HTMLElement => h("section", { class: "block" }, h("h2", { class: "block__label mono-label" }, label), ...body);

function render(props: ProBriefOutput, ctx: RenderContext): HTMLElement {
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
    props.photos.length > 0
      ? h(
          "ul",
          { class: "photos", "aria-label": `${props.photos.length} ${plural(props.photos.length, "photo")}` },
          ...props.photos.map((url, i) => h("li", { class: "photos__item" }, h("img", { src: url, alt: `Brief photo ${i + 1}`, decoding: "async", draggable: "false" }))),
        )
      : null;

  return h(
    "article",
    { class: "brief", "aria-label": "Job brief" },
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
        section(
          "Timeline",
          h("ol", { class: "timeline" }, ...props.timeline.map((entry) => h("li", { class: "timeline__item" }, h("span", { class: "timeline__ts mono" }, entry.ts), h("span", null, entry.text)))),
        ),
        props.attempted.length > 0
          ? section("Already tried", h("ul", { class: "tried" }, ...props.attempted.map((text) => h("li", { class: "tried__item" }, icon(icons.check), h("span", null, text)))))
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
        section("Access", h("p", { class: "small" }, props.accessNotes)),
        findPro,
      ),
    ),
  );
}

mountWidget({ name: "pro-brief-card", skeleton: "split", render });
