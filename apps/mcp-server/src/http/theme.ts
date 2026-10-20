import tokens from "../../../../packages/design-tokens/tokens.json";

/** Workshop Editorial (PRD 10). Every colour, font and radius on a rendered page comes from tokens.json. */
export const color = tokens.color;
export const font = tokens.font;

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500..700&family=Instrument+Sans:wght@400..700&family=JetBrains+Mono:wght@400..600&display=swap";

export function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Theme = "light" | "dark";

function themeVars(theme: Theme): string {
  const t = tokens.themes[theme];
  const pick = (name: string): string => color[name as keyof typeof color];
  return `--bg:${pick(t.bg)};--surface:${pick(t.surface)};--text:${pick(t.text)};--muted:${pick(t.textMuted)};--line:${pick(t.line)};`;
}

const baseCss = (theme: Theme): string => `
:root{${Object.entries(color).map(([k, v]) => `--${k}:${v};`).join("")}${themeVars(theme)}
--font-display:${font.display};--font-body:${font.body};--font-mono:${font.mono};
--radius-card:${tokens.radius.card};--radius-chip:${tokens.radius.chip};--radius-button:${tokens.radius.button};}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-body);font-size:${tokens.size.phone.body};line-height:1.5}
main{max-width:720px;margin:0 auto;padding:${tokens.space["6"]} ${tokens.space["4"]} ${tokens.space["8"]}}
h1,h2{font-family:var(--font-display);font-weight:600;line-height:1.1;margin:0}
h1{font-size:${tokens.size.phone.display}}
h2{font-size:22px;margin-bottom:${tokens.space["3"]}}
a{color:inherit;text-underline-offset:3px}
.mono{font-family:var(--font-mono);font-size:${tokens.size.phone.mono};letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.mark{display:flex;align-items:center;gap:${tokens.space["2"]};margin-bottom:${tokens.space["5"]}}
.mark i{display:block;width:28px;height:4px;background:var(--brass)}
.row{display:flex;justify-content:space-between;gap:${tokens.space["4"]};padding:${tokens.space["3"]} 0;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:0}
.sr{position:absolute;left:-9999px}
@media (prefers-reduced-motion:no-preference){.stamp{animation:stamp ${tokens.motion.fast} both}}
@keyframes stamp{from{transform:rotate(-6deg) scale(1.25);opacity:0}to{transform:rotate(-6deg) scale(1);opacity:1}}
`;

export interface DocumentOptions {
  title: string;
  body: string;
  css?: string;
  theme?: Theme;
  /** Capability pages (receipts, briefs) must never be indexed. */
  noindex?: boolean;
  /** Overrides the page background, e.g. kraft paper. */
  background?: string;
}

export function renderDocument(opts: DocumentOptions): string {
  const theme = opts.theme ?? "light";
  const bg = opts.background ? `body{background:var(--${opts.background})}` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${opts.noindex ? '<meta name="robots" content="noindex,nofollow">\n<meta name="referrer" content="no-referrer">' : ""}
<title>${esc(opts.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS_HREF}">
<style>${baseCss(theme)}${bg}${opts.css ?? ""}</style>
</head>
<body>
<main>
<div class="mark"><i></i><span class="mono">Hearth</span></div>
${opts.body}
</main>
</body>
</html>`;
}
