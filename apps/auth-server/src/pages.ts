import type { ScopeName } from "@hearth/contracts";
import tokens from "../../../packages/design-tokens/tokens.json";
import type { FatalReason } from "./authorize";
import type { RegisteredClient } from "./clients";

/**
 * Sign-in and consent screens in the "Workshop Editorial" language (PRD section 10).
 * Every colour, font, size, radius, space and motion value comes from tokens.json and reaches
 * the stylesheet as a CSS custom property; the rules below only ever reference var(--...).
 */

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500..700" +
  "&family=Instrument+Sans:wght@400..700&family=JetBrains+Mono:wght@400..600&display=swap";

export const SCOPE_COPY: Readonly<Record<ScopeName, string>> = {
  "home:read": "See what Hearth remembers about your home",
  "home:write": "Remember new things in your home",
  "orders:write": "Place orders you confirm out loud",
};

const kebab = (name: string): string => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

function tokenVariables(): string {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(tokens.color)) lines.push(`--color-${name}: ${value};`);
  for (const [name, value] of Object.entries(tokens.font)) lines.push(`--font-${name}: ${value};`);
  for (const [name, value] of Object.entries(tokens.size.phone)) lines.push(`--size-${name}: ${value};`);
  lines.push(`--size-display-wide: ${tokens.size.show15.display};`);
  for (const [name, value] of Object.entries(tokens.radius)) lines.push(`--radius-${name}: ${value};`);
  for (const [name, value] of Object.entries(tokens.space)) lines.push(`--space-${name}: ${value};`);
  for (const [name, value] of Object.entries(tokens.motion)) lines.push(`--motion-${name}: ${value};`);
  lines.push(`--tap: ${tokens.tapTarget.phone};`);
  for (const [role, colour] of Object.entries(tokens.themes.dark)) {
    lines.push(`--${kebab(role)}: var(--color-${colour});`);
  }
  return lines.join("\n  ");
}

const STYLES = `
:root {
  color-scheme: dark;
  ${tokenVariables()}
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  font-size: var(--size-body);
  line-height: 1.5;
}
.bar { height: 4px; background: var(--color-brass); }
.page { max-width: 68rem; margin: 0 auto; padding: var(--space-5) var(--space-4) var(--space-7); }
.label {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--size-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-muted);
}
h1 {
  margin: var(--space-3) 0 var(--space-4);
  font-family: var(--font-display);
  font-variation-settings: "opsz" 144;
  font-weight: 600;
  font-size: var(--size-display);
  line-height: 1.1;
  letter-spacing: -0.01em;
  color: var(--text);
}
.lede { margin: 0 0 var(--space-6); color: var(--text-muted); max-width: 34rem; }
.lede strong { color: var(--text); font-weight: 600; }
.layout { display: grid; gap: var(--space-6); }
.scopes { list-style: none; counter-reset: scope; margin: var(--space-3) 0 var(--space-5); padding: 0; }
.scopes li {
  counter-increment: scope;
  display: grid;
  grid-template-columns: var(--space-6) 1fr;
  align-items: baseline;
  padding: var(--space-3) 0;
  border-top: 1px solid var(--line);
}
.scopes li:last-child { border-bottom: 1px solid var(--line); }
.scopes li::before {
  content: counter(scope);
  font-family: var(--font-display);
  font-weight: 600;
  font-size: var(--size-display);
  line-height: 1;
  color: var(--color-brass);
}
.fine { margin: 0; color: var(--text-muted); font-size: 0.9em; max-width: 34rem; }
.field { margin: 0 0 var(--space-5); }
.field label {
  display: block;
  margin-bottom: var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--size-mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.field input {
  display: block;
  width: 100%;
  min-height: calc(var(--tap) + var(--space-2));
  padding: 0 var(--space-4);
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: var(--radius-button);
  font: inherit;
}
.field input[aria-invalid="true"] { border: 2px solid var(--color-copper); }
.field input:focus-visible, button:focus-visible { outline: 3px solid var(--color-brass); outline-offset: 2px; }
.error {
  margin: var(--space-2) 0 0;
  padding-left: var(--space-3);
  border-left: 3px solid var(--color-copper);
  color: var(--text);
}
.actions { display: grid; gap: var(--space-2); margin-bottom: var(--space-5); }
button { font: inherit; cursor: pointer; }
.primary {
  min-height: calc(var(--tap) + var(--space-2));
  padding: 0 var(--space-5);
  background: var(--color-brass);
  color: var(--color-soot);
  border: 0;
  border-radius: var(--radius-button);
  font-weight: 600;
  transition: background var(--motion-fast), transform var(--motion-fast);
}
.primary:hover { background: var(--color-kraft); }
.primary:active { transform: translateY(1px); }
.quiet {
  min-height: var(--tap);
  padding: 0 var(--space-3);
  background: none;
  color: var(--text-muted);
  border: 0;
  text-decoration: underline;
  text-underline-offset: 0.25em;
  transition: color var(--motion-fast);
}
.quiet:hover { color: var(--text); }
@media (min-width: 56rem) {
  .page { padding-top: var(--space-7); }
  h1 { font-size: var(--size-display-wide); }
  .layout { grid-template-columns: minmax(0, 5fr) minmax(0, 4fr); gap: var(--space-8); align-items: start; }
  .panel { padding-left: var(--space-7); border-left: 1px solid var(--line); }
  .actions { grid-template-columns: 1fr auto; align-items: center; }
}
@media (prefers-reduced-motion: reduce) {
  .primary, .quiet { transition: none; }
}
`;

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS_HREF}">
<style>${STYLES}</style>
</head>
<body>
<div class="bar" aria-hidden="true"></div>
<main class="page">
${body}
</main>
</body>
</html>
`;
}

export interface ConsentView {
  readonly client: RegisteredClient;
  readonly scopes: readonly ScopeName[];
  /** Validated request parameters echoed back as hidden inputs, in this order. */
  readonly hidden: Readonly<Record<string, string>>;
  readonly email: string;
  readonly errors: { readonly email?: string; readonly password?: string };
}

function field(
  id: "email" | "password",
  label: string,
  type: "email" | "password",
  autocomplete: string,
  value: string,
  error: string | undefined,
): string {
  const describedBy = error === undefined ? "" : ` aria-describedby="${id}-error" aria-invalid="true"`;
  const message =
    error === undefined ? "" : `\n    <p class="error" id="${id}-error" role="alert">${escapeHtml(error)}</p>`;
  const valueAttr = value === "" ? "" : ` value="${escapeHtml(value)}"`;
  return `  <div class="field">
    <label for="${id}">${label}</label>
    <input id="${id}" name="${id}" type="${type}" autocomplete="${autocomplete}" required${valueAttr}${describedBy}>${message}
  </div>`;
}

export function renderConsentPage(view: ConsentView): string {
  const hiddenInputs = Object.entries(view.hidden)
    .map(([name, value]) => `  <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join("\n");
  const scopeItems = view.scopes.map((scope) => `    <li>${escapeHtml(SCOPE_COPY[scope])}</li>`).join("\n");
  return shell(
    "Link Hearth to Alexa",
    `<p class="label">Account linking</p>
<h1>Link Hearth to Alexa</h1>
<p class="lede"><strong>${escapeHtml(view.client.name)}</strong> is asking to connect to your Hearth account. Sign in to approve.</p>
<div class="layout">
  <section aria-labelledby="scopes-label">
    <p class="label" id="scopes-label">This link lets Alexa</p>
    <ol class="scopes">
${scopeItems}
    </ol>
    <p class="fine">Hearth never stores health data or details about children.</p>
  </section>
  <form class="panel" method="post" action="/authorize">
${hiddenInputs}
${field("email", "Email", "email", "username", view.email, view.errors.email)}
${field("password", "Password", "password", "current-password", "", view.errors.password)}
    <div class="actions">
      <button class="primary" type="submit" name="decision" value="approve">Link account</button>
      <button class="quiet" type="submit" name="decision" value="deny" formnovalidate>Cancel</button>
    </div>
  </form>
</div>`,
  );
}

const FATAL_COPY: Readonly<Record<FatalReason, string>> = {
  unknown_client:
    "Hearth does not recognise the app that sent you here, so nothing was linked. Close this tab and start again from Alexa.",
  redirect_mismatch:
    "The return address in this request is not registered for that app, so Hearth will not send you there. Nothing was linked. Close this tab and start again from Alexa.",
};

export function renderErrorPage(reason: FatalReason): string {
  return shell(
    "Hearth cannot link this request",
    `<p class="label">Request rejected</p>
<h1>This link request cannot continue</h1>
<p class="lede">${escapeHtml(FATAL_COPY[reason])}</p>`,
  );
}
