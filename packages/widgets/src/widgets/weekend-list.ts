import type { WeekendPlanOutput } from "@hearth/contracts";
import { mountWidget, type RenderContext } from "../runtime/bridge";
import { h, icon } from "../runtime/dom";
import { ordinalPhrase, plural } from "../runtime/format";
import * as icons from "../runtime/icons";
import { moreOnPhone } from "../runtime/more";
import "../styles/weekend-list.css";

type Task = WeekendPlanOutput["tasks"][number];

const DUE_LABEL: Record<Task["dueState"], string> = { overdue: "Overdue", due: "Due", soon: "Soon", seasonal: "Seasonal" };

function taskRow(task: Task, index: number, ctx: RenderContext): HTMLElement {
  const action = task.action;
  let reorder: HTMLButtonElement | null = null;
  if (action) {
    const button = h(
      "button",
      {
        class: "btn btn--primary task__reorder",
        type: "button",
        "data-reorder": task.id,
        "aria-label": `Reorder for ${task.title}`,
        on: { click: () => ctx.act({ name: "reorder", args: { sku: action.sku, taskId: task.id } }, button) },
      },
      icon(icons.arrowClockwise),
      "Reorder",
    );
    reorder = button;
  }

  return h(
    "li",
    { class: `task task--${task.dueState}`, "data-voice-index": index, "aria-label": `${index + 1}. ${task.title}. Say ${ordinalPhrase(index)}.` },
    h("span", { class: "task__numeral numeral", "aria-hidden": "true" }, String(index + 1)),
    h(
      "div",
      { class: "task__main" },
      h(
        "p",
        { class: "task__meta mono" },
        h("span", { class: `chip task__due task__due--${task.dueState}` }, DUE_LABEL[task.dueState]),
        h("span", { class: "task__minutes" }, icon(icons.clock), `${task.minutes} MIN`),
        h("span", { class: "task__asset dim" }, task.assetName),
      ),
      h("h2", { class: "task__title" }, task.title),
      h("p", { class: "task__why small" }, task.why),
    ),
    reorder,
  );
}

function render(props: WeekendPlanOutput, ctx: RenderContext): HTMLElement {
  const total = props.tasks.reduce((sum, t) => sum + t.minutes, 0);
  const head = h(
    "header",
    { class: "weekend__head" },
    h(
      "div",
      null,
      h("p", { class: "mono-label" }, "This weekend"),
      h("h1", { class: "display weekend__title" }, props.weekendLabel),
    ),
    props.tasks.length > 0
      ? h("p", { class: "weekend__sum mono" }, `${props.tasks.length} ${plural(props.tasks.length, "job")}, about ${total} MIN`)
      : null,
  );

  if (props.tasks.length === 0) {
    return h(
      "section",
      { class: "weekend", "aria-label": "Weekend plan" },
      head,
      h("div", { class: "weekend__empty" }, icon(icons.check), h("p", { class: "title" }, "Nothing is due this weekend."), h("p", { class: "small dim" }, "Hearth will list jobs here as filters, batteries and seasonal checks come due.")),
    );
  }

  // In a fixed frame the bridge raises ctx.level until the rows fit; the rest are one phone away.
  const shown = props.tasks.slice(0, props.tasks.length - ctx.level);
  const hidden = props.tasks.length - shown.length;
  return h("section", { class: "weekend", "aria-label": "Weekend plan" }, head, h("ol", { class: "tasks" }, ...shown.map((task, i) => taskRow(task, i, ctx))), hidden > 0 ? moreOnPhone(hidden, hidden === 1 ? "job" : "jobs") : null);
}

mountWidget({ name: "weekend-list", skeleton: "rows", render, levels: (props) => Math.max(0, props.tasks.length - 1) });
