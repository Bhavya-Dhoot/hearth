import type { CompleteCheckoutOutput, CreateCheckoutOutput } from "@hearth/contracts";
import { mountWidget, type RenderContext } from "../runtime/bridge";
import { h, icon, type Child } from "../runtime/dom";
import { breakableUrl, money, weekdayDate } from "../runtime/format";
import * as icons from "../runtime/icons";
import { stamp } from "../runtime/stamp";
import "../styles/checkout-card.css";

type Props = CreateCheckoutOutput | CompleteCheckoutOutput;

/** One labelled fact row: icon, mono label, value. */
const fact = (iconMarkup: string, label: string, ...value: Child[]): HTMLElement =>
  h("div", { class: "fact" }, icon(iconMarkup), h("div", { class: "fact__text" }, h("p", { class: "mono-label" }, label), h("p", { class: "fact__value" }, ...value)));

function totalsRow(label: string, value: string, strong = false): HTMLElement {
  return h("div", { class: `totals__row${strong ? " totals__row--total" : ""}` }, h("dt", { class: strong ? "title" : "dim" }, label), h("dd", { class: strong ? "display totals__sum" : "mono" }, value));
}

function checkoutView(props: CreateCheckoutOutput, ctx: RenderContext): HTMLElement {
  const { totals } = props;
  const lines = h(
    "ul",
    { class: "lines" },
    ...props.lineItems.map((line) =>
      h(
        "li",
        { class: "line" },
        h("span", { class: "line__qty mono" }, `${line.qty} x`),
        h("span", { class: "line__name" }, h("span", { class: "title" }, line.name), h("span", { class: "line__sku mono dim" }, `SKU ${line.sku}`)),
        h("span", { class: "line__price mono" }, money(line.unitPrice * line.qty)),
      ),
    ),
  );

  const confirm = h(
    "button",
    { class: "btn btn--primary btn--block", type: "button", "data-voice": "confirm", on: { click: () => ctx.act({ name: "confirm_checkout", args: { sessionId: props.sessionId } }, confirm) } },
    icon(icons.check),
    "Confirm",
  );
  const cancel = h(
    "button",
    { class: "btn btn--ghost btn--block", type: "button", "data-voice": "cancel", on: { click: () => ctx.act({ name: "cancel_checkout", args: { sessionId: props.sessionId } }, cancel) } },
    "Cancel",
  );

  return h(
    "section",
    { class: "checkout", "aria-label": "Order summary" },
    h(
      "div",
      { class: "checkout__order" },
      h("p", { class: "mono-label" }, "Your order"),
      lines,
      h("div", { class: "facts" }, fact(icons.truck, "Arrives", weekdayDate(props.etaDate)), fact(icons.creditCard, "Pay with", props.paymentDisplay)),
      h(
        "dl",
        { class: "totals" },
        totalsRow("Subtotal", money(totals.subtotal)),
        totalsRow("Tax", money(totals.tax)),
        totalsRow("Shipping", totals.shipping === 0 ? "Free" : money(totals.shipping)),
        totalsRow("Total", money(totals.total), true),
      ),
    ),
    h(
      "div",
      { class: "checkout__ask" },
      h("p", { class: "ask__label mono" }, "CONFIRM?"),
      h("p", { class: "ask__text display" }, props.commitmentText),
      h("div", { class: "ask__actions" }, confirm, cancel),
    ),
  );
}

const PAYMENT_LABEL: Record<CompleteCheckoutOutput["paymentMode"], string> = { stripe_test: "Stripe test mode", simulated: "Simulated payment" };
const EMAIL_LABEL: Record<CompleteCheckoutOutput["emailStatus"], string> = { sent: "Emailed to you", written_to_outbox: "Written to the outbox" };

function confirmationView(props: CompleteCheckoutOutput): HTMLElement {
  return h(
    "section",
    { class: "checkout checkout--done", "aria-label": "Order placed" },
    h(
      "div",
      { class: "done__main" },
      h("div", { class: "done__stamp" }, stamp("Ordered", "verdigris", "stamp--animate")),
      h("p", { class: "mono-label" }, "Order number"),
      h("p", { class: "done__number mono" }, props.orderNumber),
      h("h1", { class: "display done__summary" }, props.summary),
      props.nextSuggestion ? h("p", { class: "done__next" }, icon(icons.arrowRight), h("span", null, props.nextSuggestion)) : null,
    ),
    h(
      "div",
      { class: "done__side" },
      fact(icons.truck, "Arrives", weekdayDate(props.etaDate)),
      fact(icons.creditCard, "Charged", `${money(props.chargedAmount)}`, h("span", { class: "fact__aside mono dim" }, PAYMENT_LABEL[props.paymentMode])),
      fact(icons.receipt, "Receipt", h("span", { class: "mono fact__url" }, ...breakableUrl(props.receiptUrl))),
      fact(icons.linkSimple, "Confirmation email", EMAIL_LABEL[props.emailStatus]),
      h("p", { class: "done__support small dim" }, `Questions? ${props.supportEmail}`),
    ),
  );
}

function render(props: Props, ctx: RenderContext): HTMLElement {
  return props.state === "checkout" ? checkoutView(props, ctx) : confirmationView(props);
}

mountWidget({ name: "checkout-card", skeleton: "split", render });
