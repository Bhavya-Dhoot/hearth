import { z } from "zod";
import type { WidgetName } from "./common";
import {
  CompleteCheckoutOutput,
  CreateCheckoutOutput,
  FindPartOutput,
  HistoryOutput,
  HomeProfileOutput,
  ProBriefOutput,
  RecallsOutput,
  RepairStepsOutput,
  WeekendPlanOutput,
} from "./tools";

/**
 * C2 - Widget payloads. A widget's props are its tool's output, unchanged.
 * Widgets validate on receipt with these schemas and render an inline error strip on failure.
 */
export const WidgetProps = {
  "step-card": RepairStepsOutput,
  "parts-carousel": FindPartOutput,
  "checkout-card": z.discriminatedUnion("state", [CreateCheckoutOutput, CompleteCheckoutOutput]),
  "weekend-list": WeekendPlanOutput,
  "pro-brief-card": ProBriefOutput,
  "home-card": HomeProfileOutput,
  "timeline-list": HistoryOutput,
  "recall-card": RecallsOutput,
} as const satisfies Record<WidgetName, z.ZodType>;

export type WidgetPropsOf<W extends WidgetName> = z.infer<(typeof WidgetProps)[W]>;

/** Actions a widget may post. The host turns each into a user turn: `[tap] <name> <args json>`. */
export const WidgetAction = z.discriminatedUnion("name", [
  z.object({ name: z.literal("next_step"), args: z.object({ issueId: z.string(), stepIndex: z.number().int() }) }),
  z.object({ name: z.literal("done"), args: z.object({ issueId: z.string() }) }),
  z.object({ name: z.literal("skip_step"), args: z.object({ issueId: z.string(), stepIndex: z.number().int() }) }),
  z.object({ name: z.literal("select_part"), args: z.object({ index: z.number().int(), sku: z.string() }) }),
  z.object({ name: z.literal("confirm_checkout"), args: z.object({ sessionId: z.string() }) }),
  z.object({ name: z.literal("cancel_checkout"), args: z.object({ sessionId: z.string() }) }),
  z.object({ name: z.literal("reorder"), args: z.object({ sku: z.string(), taskId: z.string() }) }),
  z.object({ name: z.literal("find_pro"), args: z.object({ briefId: z.string() }) }),
  z.object({ name: z.literal("open_event"), args: z.object({ eventId: z.string() }) }),
]);
export type WidgetAction = z.infer<typeof WidgetAction>;
