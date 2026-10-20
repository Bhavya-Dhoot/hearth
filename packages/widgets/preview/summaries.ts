import type { WidgetName, WidgetPropsOf } from "@hearth/contracts";
import { money, weekdayDate } from "../src/runtime/format";

/** Text a voice-only device speaks in place of the card. One short paragraph per widget state. */
export function summarize<W extends WidgetName>(name: W, props: WidgetPropsOf<W>): string {
  switch (name) {
    case "step-card": {
      const p = props as WidgetPropsOf<"step-card">;
      return `Step ${p.stepIndex + 1} of ${p.stepCount}. ${p.instruction}${p.caution ? ` Caution: ${p.caution}` : ""} Say next when you are ready.`;
    }
    case "parts-carousel": {
      const p = props as WidgetPropsOf<"parts-carousel">;
      const first = p.items[0];
      return `${p.items.length} matches. The first is ${first?.name ?? "unknown"}, ${first ? money(first.price) : ""}. ${first?.fitReason ?? ""} Say the first one to order it.`;
    }
    case "checkout-card": {
      const p = props as WidgetPropsOf<"checkout-card">;
      return p.state === "checkout" ? `${p.commitmentText} Confirm?` : `Ordered. ${p.summary}. Arriving ${weekdayDate(p.etaDate)}.`;
    }
    case "weekend-list": {
      const p = props as WidgetPropsOf<"weekend-list">;
      return `${p.weekendLabel}. ${p.tasks.slice(0, 2).map((t, i) => `${i + 1}. ${t.title}.`).join(" ")}`;
    }
    case "pro-brief-card": {
      const p = props as WidgetPropsOf<"pro-brief-card">;
      return `${p.headline}. ${p.handoffLine}`;
    }
    case "home-card": {
      const p = props as WidgetPropsOf<"home-card">;
      const where = p.keyLocations[0];
      return `Hearth remembers ${p.assetCount} things in your home.${where ? ` ${where.label}: ${where.location}.` : ""}`;
    }
    case "timeline-list": {
      const p = props as WidgetPropsOf<"timeline-list">;
      return `${p.title}. Most recent: ${p.events[0]?.summary ?? "nothing logged yet"}`;
    }
    case "recall-card": {
      const p = props as WidgetPropsOf<"recall-card">;
      const first = p.flagged[0];
      return first ? `${first.assetName} matches a recall. ${first.remedy[0] ?? ""} This is a sample dataset.` : `Nothing in your home matches a recall. This is a sample dataset.`;
    }
    default:
      return "";
  }
}
