import { h } from "./dom";

/** The mono line a trimmed list ends with: the rows that did not fit the frame are still on the person's phone. */
export const moreOnPhone = (count: number, what = ""): HTMLElement =>
  h("p", { class: "mono-label more" }, `${count} more${what ? ` ${what}` : ""} on your phone`);
