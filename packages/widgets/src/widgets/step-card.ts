import type { RepairStepsOutput } from "@hearth/contracts";
import { buildAnnotation } from "../runtime/annotation";
import { mountWidget, type RenderContext } from "../runtime/bridge";
import { h, icon, s } from "../runtime/dom";
import * as icons from "../runtime/icons";
import "../styles/step-card.css";

type Image = NonNullable<RepairStepsOutput["image"]>;

const DEFAULT_RATIO = 4 / 3;
const STROKE_PX = 3;
const VIEWBOX_W = 1000;

/** Blueprint sheet: 1px slate grid sits behind the photo only, never behind text. */
function blueprintGrid(): SVGSVGElement {
  return s(
    "svg",
    { class: "blueprint", "aria-hidden": "true", focusable: "false" },
    s(
      "defs",
      null,
      s("pattern", { id: "bp-grid", width: "32", height: "32", patternUnits: "userSpaceOnUse" }, s("path", { d: "M32 0H0V32" })),
      s("pattern", { id: "bp-major", width: "160", height: "160", patternUnits: "userSpaceOnUse" }, s("path", { class: "blueprint__major", d: "M160 0H0V160" })),
    ),
    s("rect", { width: "100%", height: "100%", fill: "url(#bp-grid)" }),
    s("rect", { width: "100%", height: "100%", fill: "url(#bp-major)" }),
  );
}

function photoSheet(image: Image, chip: string | undefined): HTMLElement {
  const sheet = h("div", { class: "sheet" }, blueprintGrid());
  const box = h("div", { class: "photo", style: { "--ratio": DEFAULT_RATIO } });
  let overlay: SVGSVGElement | null = null;

  /** Keeps the stroke a true 3px whatever size the box renders at. */
  const setStroke = (): void => {
    const width = box.getBoundingClientRect().width;
    if (overlay && width > 0) overlay.style.setProperty("--ann-w", String((STROKE_PX * VIEWBOX_W) / width));
  };

  const mountOverlay = (ratio: number): void => {
    overlay?.remove();
    overlay = null;
    box.style.setProperty("--ratio", String(ratio));
    if (!image.annotation) return;
    overlay = buildAnnotation(image.annotation, ratio);
    box.append(overlay);
    setStroke();
  };

  const img = h("img", {
    src: image.url,
    alt: image.alt,
    decoding: "async",
    draggable: "false",
    on: {
      load: () => {
        const ratio = img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : DEFAULT_RATIO;
        mountOverlay(ratio);
        box.classList.add("is-drawn");
      },
      error: () => {
        overlay = null;
        box.replaceChildren(
          h("div", { class: "photo__missing" }, icon(icons.imageBroken), h("span", { class: "mono-label" }, "Photo unavailable"), h("p", { class: "small dim" }, image.alt)),
        );
      },
    },
  });
  box.append(img);
  if (image.annotation) mountOverlay(DEFAULT_RATIO);
  sheet.append(box);
  if (chip) sheet.append(h("span", { class: "chip step__where" }, icon(icons.mapPin), chip));
  new ResizeObserver(setStroke).observe(box);
  return sheet;
}

function stepTicks(index: number, count: number): HTMLElement {
  const ticks = h("div", { class: "ticks", "aria-hidden": "true" });
  for (let i = 0; i < count; i++) ticks.append(h("span", { class: `tick${i < index ? " tick--past" : i === index ? " tick--now" : ""}` }));
  return ticks;
}

function render(props: RepairStepsOutput, ctx: RenderContext): HTMLElement {
  const { issueId, stepIndex } = props;
  const image = props.image;

  const media = h("div", { class: "step__media" });
  if (image) {
    media.append(photoSheet(image, image.isUsersPhoto ? props.locationChip : undefined));
  } else {
    media.append(h("div", { class: "step__numeral numeral", "aria-hidden": "true" }, String(stepIndex + 1)));
  }

  const body = h("div", { class: "step__body" });
  body.append(
    h("p", { class: "mono-label step__issue" }, props.issueTitle),
    h("div", { class: "step__counter" }, h("span", { class: "step__count mono" }, `STEP ${stepIndex + 1} / ${props.stepCount}`), stepTicks(stepIndex, props.stepCount)),
    h("h1", { class: "display step__instruction" }, props.instruction),
  );
  // In a fixed frame the bridge raises ctx.level until the step fits: first the add-an-asset hint goes, then the tools, then the detail.
  if (props.detail && ctx.level < 3) body.append(h("p", { class: "step__detail small" }, props.detail));
  if (props.caution) {
    body.append(h("div", { class: "strip", role: "note" }, icon(icons.warning), h("div", null, h("span", { class: "strip__label mono-label" }, "Caution"), props.caution)));
  }
  if (props.tools && props.tools.length > 0 && ctx.level < 2) {
    body.append(
      h(
        "div",
        { class: "step__tools" },
        h("span", { class: "mono-label" }, "Tools"),
        h("ul", { class: "step__chips" }, ...props.tools.map((tool) => h("li", { class: "chip chip--solid" }, icon(icons.wrench), tool))),
      ),
    );
  }
  if (props.addHint && ctx.level < 1) body.append(h("p", { class: "step__hint small" }, icon(icons.microphone), h("span", null, props.addHint)));

  const actions = h("div", { class: "step__actions" });
  if (props.primaryAction === "next") {
    const next = h(
      "button",
      { class: "btn btn--primary", type: "button", "data-voice": "next", on: { click: () => ctx.act({ name: "next_step", args: { issueId, stepIndex } }, next) } },
      "NEXT",
      icon(icons.arrowRight),
    );
    actions.append(next);
    if (props.canSkip) {
      const skip = h(
        "button",
        { class: "btn btn--ghost", type: "button", on: { click: () => ctx.act({ name: "skip_step", args: { issueId, stepIndex } }, skip) } },
        icon(icons.skipForward),
        "Skip step",
      );
      actions.append(skip);
    } else {
      const done = h("button", { class: "btn btn--ghost", type: "button", on: { click: () => ctx.act({ name: "done", args: { issueId } }, done) } }, "I'm done");
      actions.append(done);
    }
  } else {
    const done = h(
      "button",
      { class: "btn btn--primary", type: "button", "data-voice": "next", on: { click: () => ctx.act({ name: "done", args: { issueId } }, done) } },
      icon(icons.check),
      "I'm done",
    );
    actions.append(done);
  }
  body.append(actions);

  return h("section", { class: `step${image ? "" : " step--plain"}`, "aria-label": `Step ${stepIndex + 1} of ${props.stepCount}` }, media, body);
}

mountWidget({ name: "step-card", skeleton: "split", render, levels: () => 3 });
