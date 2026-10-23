import type { ProBriefOutput } from "@hearth/contracts";
import { longDate } from "../services/dates";
import { money } from "../services/format";
import type { OutboxEntry, OutboxMessage } from "../services/email";
import { esc, renderDocument } from "./theme";

/* ------------------------------------------------------------------ receipt */

export interface ReceiptView {
  orderNumber: string;
  itemName: string;
  qty: number;
  unitPrice: number;
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  paymentDisplay: string;
  etaDate: string;
  paymentMode: "stripe_test" | "simulated";
  supportEmail: string;
}

const receiptCss = `
.stamp{display:inline-block;margin:var(--space-3,12px) 0 24px;padding:6px 16px;border:3px solid var(--moss-ink);border-radius:var(--radius-button);color:var(--moss-ink);font-family:var(--font-mono);font-size:15px;letter-spacing:.18em;transform:rotate(-6deg)}
.sheet{background:var(--surface);border-radius:var(--radius-card);padding:8px 24px}
.row b{font-weight:500}
.row.total{font-family:var(--font-display);font-size:24px}
.row .k{color:var(--muted)}
.note{margin-top:24px;padding:16px;border-left:4px solid var(--signal);font-size:15px;color:var(--muted)}
footer{margin-top:32px}
`;

export function renderReceipt(v: ReceiptView): string {
  const shipping = v.shipping === 0 ? "Free" : money(v.shipping);
  const mode =
    v.paymentMode === "stripe_test"
      ? "This order used Stripe in test mode. No real card was charged."
      : "This order used a simulated payment. No card was charged.";
  const body = `
<p class="mono">Receipt ${esc(v.orderNumber)}</p>
<h1>Order confirmed</h1>
<span class="stamp">ORDERED</span>
<section class="sheet" aria-label="Order details">
  <div class="row"><span>${esc(v.qty)}× ${esc(v.itemName)}</span><b>${money(v.subtotal)}</b></div>
  <div class="row"><span class="k">Unit price</span><span>${money(v.unitPrice)}</span></div>
  <div class="row"><span class="k">Tax</span><span>${money(v.tax)}</span></div>
  <div class="row"><span class="k">Shipping</span><span>${esc(shipping)}</span></div>
  <div class="row total"><span>Total</span><b>${money(v.total)}</b></div>
  <div class="row"><span class="k">Paid with</span><span>${esc(v.paymentDisplay)}</span></div>
  <div class="row"><span class="k">Arrives</span><span>${esc(longDate(v.etaDate))}</span></div>
</section>
<p class="note">${esc(mode)}</p>
<footer class="mono">Questions? ${esc(v.supportEmail)}</footer>`;
  return renderDocument({ title: `Receipt ${v.orderNumber}`, body, css: receiptCss, noindex: true });
}

/* ------------------------------------------------------------------ pro brief (blueprint paper) */

const briefCss = `
:root{--text:var(--bone);--muted:var(--mist);--line:color-mix(in srgb,var(--bone) 45%,transparent)}
body{background-image:repeating-linear-gradient(0deg,color-mix(in srgb,var(--bone) 8%,transparent) 0 1px,transparent 1px 24px),repeating-linear-gradient(90deg,color-mix(in srgb,var(--bone) 8%,transparent) 0 1px,transparent 1px 24px)}
.stamp{display:inline-block;padding:4px 14px;border:3px solid var(--signal);border-radius:var(--radius-button);color:var(--signal);font-family:var(--font-mono);font-size:14px;letter-spacing:.2em;white-space:nowrap;transform:rotate(-6deg)}
header{display:flex;flex-wrap:wrap-reverse;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:24px}
header h1{overflow-wrap:anywhere}
section{padding:20px 0;border-top:2px dotted var(--line)}
section h2{font-family:var(--font-mono);font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:500;color:var(--muted);margin:0 0 12px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 24px;margin:0}
dt{color:var(--muted)}
dd{margin:0;font-weight:500}
ol,ul{margin:0;padding:0;list-style:none}
li{padding:6px 0}
ol li{display:grid;grid-template-columns:110px 1fr;gap:12px}
ol time{font-family:var(--font-mono);font-size:13px;letter-spacing:.06em;color:var(--muted)}
.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.photos img{width:100%;border-radius:12px;border:1px solid var(--line);background:var(--bone)}
.share{word-break:break-all}
`;

export function renderBrief(b: ProBriefOutput, preparedOn: string): string {
  const tradeLabel = b.trade.replace("_", " ");
  const timeline = b.timeline.map((t) => `<li><time>${esc(t.ts)}</time><span>${esc(t.text)}</span></li>`).join("");
  const attempted = b.attempted.length > 0 ? b.attempted.map((a) => `<li>${esc(a)}</li>`).join("") : "<li>Nothing tried yet.</li>";
  const photos =
    b.photos.length > 0
      ? `<section><h2>Photos</h2><div class="photos">${b.photos.map((p) => `<img src="${esc(p)}" alt="Photo from the customer's home" loading="lazy">`).join("")}</div></section>`
      : "";
  const body = `
<header>
  <div>
    <p class="mono">${esc(tradeLabel)} · ${esc(preparedOn)}</p>
    <h1>${esc(b.headline)}</h1>
  </div>
  <span class="stamp">JOB BRIEF</span>
</header>
<section><h2>The unit</h2>
  <dl><dt>Brand</dt><dd>${esc(b.asset.brand)}</dd><dt>Model</dt><dd>${esc(b.asset.model)}</dd><dt>Age</dt><dd>${esc(b.asset.ageYears)} ${b.asset.ageYears === 1 ? "year" : "years"}</dd></dl>
</section>
<section><h2>What is wrong</h2><p>${esc(b.symptom)}</p></section>
<section><h2>Timeline</h2><ol>${timeline}</ol></section>
<section><h2>Already tried</h2><ul>${attempted}</ul></section>
<section><h2>Access</h2><p>${esc(b.accessNotes)}</p></section>
${photos}
<section><h2>Brief link</h2><p class="mono share">${esc(b.shareUrl)}</p><p class="mono">Prepared by Hearth from the customer's home records</p></section>`;
  return renderDocument({ title: `Job brief: ${b.headline}`, body, css: briefCss, noindex: true, background: "blueprint" });
}

/* ------------------------------------------------------------------ outbox */

const outboxCss = `
ul.mail{list-style:none;margin:0;padding:0}
ul.mail li{padding:16px 0;border-bottom:1px solid var(--line)}
ul.mail a{font-family:var(--font-display);font-size:22px;font-weight:650;color:var(--text);text-decoration:none;line-height:1.2}
ul.mail a:hover{color:var(--signal)}
ul.mail .mono{margin-top:6px;text-transform:none;letter-spacing:.04em;overflow-wrap:anywhere}
a{color:var(--signal)}
iframe{width:100%;height:760px;border:0;border-radius:var(--radius-card);background:var(--bone)}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 20px;margin:16px 0 24px}
dt{color:var(--muted)}
dd{margin:0;overflow-wrap:anywhere}
`;

export function renderOutboxList(entries: OutboxEntry[]): string {
  const items = entries
    .map(
      (e) =>
        `<li><a href="/outbox/${encodeURIComponent(e.file)}">${esc(e.subject)}</a><div class="mono">${esc(e.date)} · to ${esc(e.to)}</div></li>`,
    )
    .join("");
  const body = `
<p class="mono">Local outbox</p>
<h1>Sent mail</h1>
<p>Without a Resend key, confirmation emails are written here as .eml files instead of being sent.</p>
${entries.length === 0 ? "<p>No messages yet. Place a test order and its confirmation lands here.</p>" : `<ul class="mail">${items}</ul>`}`;
  return renderDocument({ title: "Hearth outbox", body, css: outboxCss, theme: "dark", noindex: true });
}

export function renderOutboxMessage(m: OutboxMessage): string {
  const body = `
<p class="mono"><a href="/outbox">Back to outbox</a></p>
<h1>${esc(m.subject)}</h1>
<dl><dt>From</dt><dd>${esc(m.from)}</dd><dt>To</dt><dd>${esc(m.to)}</dd><dt>Date</dt><dd>${esc(m.date)}</dd></dl>
<iframe title="Email body" sandbox srcdoc="${esc(m.html)}"></iframe>`;
  return renderDocument({ title: m.subject, body, css: outboxCss, theme: "dark", noindex: true });
}

export function renderNotFound(what: string): string {
  const body = `<p class="mono">Not found</p><h1>${esc(what)}</h1><p>The link may be mistyped, or it no longer exists.</p>`;
  return renderDocument({ title: "Not found", body, noindex: true });
}
