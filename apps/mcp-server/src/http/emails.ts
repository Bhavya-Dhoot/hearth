import type { EmailMessage } from "../services/email";
import { longDate } from "../services/dates";
import { money } from "../services/format";
import { color, esc, font, radius } from "./theme";

export interface OrderEmailInput {
  to: string;
  tag: string;
  orderNumber: string;
  itemName: string;
  qty: number;
  totals: { subtotal: number; tax: number; shipping: number; total: number };
  paymentDisplay: string;
  etaDate: string;
  summary: string;
  receiptUrl: string;
  supportEmail: string;
}

/** Confirmation sent within the same request as the order (Alexa+ add-on checklist: confirm by email). */
export function orderConfirmationEmail(i: OrderEmailInput): EmailMessage {
  const subject = `Your Hearth order ${i.orderNumber} is confirmed`;
  const shipping = i.totals.shipping === 0 ? "Free" : money(i.totals.shipping);
  const text = [
    i.summary,
    "",
    `Item: ${i.qty}× ${i.itemName}`,
    `Subtotal: ${money(i.totals.subtotal)}`,
    `Tax: ${money(i.totals.tax)}`,
    `Shipping: ${shipping}`,
    `Total: ${money(i.totals.total)}`,
    `Paid with: ${i.paymentDisplay}`,
    `Arrives: ${longDate(i.etaDate)}`,
    "",
    `Receipt: ${i.receiptUrl}`,
    `Questions? Write to ${i.supportEmail}.`,
    "",
    "Hearth runs on test payments in this build. No real card was charged.",
  ].join("\n");

  const line = (label: string, value: string): string =>
    `<tr><td style="padding:6px 0;color:${color.stone}">${esc(label)}</td><td style="padding:6px 0;text-align:right">${esc(value)}</td></tr>`;

  const html = `<!doctype html>
<html lang="en"><body style="margin:0;background:${color.bone};color:${color.ink};font-family:${font.body.replace(/"/g, "'")}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
<tr><td style="border-top:4px solid ${color.signal};padding-top:16px;font-family:${font.mono.replace(/"/g, "'")};font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:${color.stone}">Hearth</td></tr>
<tr><td style="padding:12px 0 4px;font-family:${font.display.replace(/"/g, "'")};font-size:30px;font-weight:650;letter-spacing:-.01em">Your order is confirmed</td></tr>
<tr><td style="padding:0 0 16px;color:${color.stone};font-family:${font.mono.replace(/"/g, "'")};font-size:13px;letter-spacing:.08em">${esc(i.orderNumber)}</td></tr>
<tr><td style="padding:0 0 16px;font-size:16px;line-height:1.5">${esc(i.summary)}</td></tr>
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${color.stone};font-size:15px">
${line("Item", `${i.qty}× ${i.itemName}`)}
${line("Subtotal", money(i.totals.subtotal))}
${line("Tax", money(i.totals.tax))}
${line("Shipping", shipping)}
${line("Total", money(i.totals.total))}
${line("Paid with", i.paymentDisplay)}
${line("Arrives", longDate(i.etaDate))}
</table></td></tr>
<tr><td style="padding:20px 0"><a href="${esc(i.receiptUrl)}" style="display:inline-block;background:${color.signal};color:${color.ink};padding:12px 20px;border-radius:${radius.button};text-decoration:none;font-weight:600">View your receipt</a></td></tr>
<tr><td style="font-size:13px;color:${color.stone};line-height:1.5">Questions? Write to ${esc(i.supportEmail)}.<br>Hearth runs on test payments in this build. No real card was charged.</td></tr>
</table></td></tr></table>
</body></html>`;

  return { to: i.to, subject, text, html, tag: i.tag };
}
