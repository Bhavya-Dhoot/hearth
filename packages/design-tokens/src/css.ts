import tokens from "../tokens.json";

type Tokens = typeof tokens;
type Device = "echo-show-8" | "echo-show-15" | "phone";

const decl = (name: string, value: string) => `  --${name}: ${value};`;
const block = (selector: string, lines: string[]) => `${selector} {\n${lines.join("\n")}\n}`;

/** Device -> the size token group and spacing step that drive its type scale and layout rhythm. */
const DEVICES: ReadonlyArray<{ id: Device; size: keyof Tokens["size"]; tap: keyof Tokens["tapTarget"]; pad: string; gap: string }> = [
  { id: "echo-show-8", size: "show8", tap: "show", pad: "7", gap: "5" },
  { id: "echo-show-15", size: "show15", tap: "show", pad: "8", gap: "6" },
  { id: "phone", size: "phone", tap: "phone", pad: "4", gap: "3" },
];

function rootBlock(t: Tokens): string {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(t.color)) lines.push(decl(`color-${name}`, value));
  lines.push(decl("font-display", t.font.display), decl("font-body", t.font.body), decl("font-mono", t.font.mono));
  for (const [device, sizes] of Object.entries(t.size)) {
    for (const [role, value] of Object.entries(sizes)) lines.push(decl(`size-${device}-${role}`, value));
  }
  for (const [name, value] of Object.entries(t.radius)) lines.push(decl(`radius-${name}`, value));
  for (const [name, value] of Object.entries(t.space)) lines.push(decl(`space-${name}`, value));
  lines.push(decl("shadow-dark", t.shadow.dark), decl("shadow-light", t.shadow.light));
  for (const [name, value] of Object.entries(t.motion)) lines.push(decl(`motion-${name}`, value));
  lines.push(decl("tap-show", t.tapTarget.show), decl("tap-phone", t.tapTarget.phone));
  return block(":root", lines);
}

function themeBlock(name: "dark" | "light", t: Tokens): string {
  const theme = t.themes[name];
  const lines = [
    decl("bg", `var(--color-${theme.bg})`),
    decl("surface", `var(--color-${theme.surface})`),
    decl("text", `var(--color-${theme.text})`),
    decl("text-muted", `var(--color-${theme.textMuted})`),
    decl("line", `var(--color-${theme.line})`),
    // Derived steps so widgets never mix their own colours.
    decl("text-dim", "color-mix(in srgb, var(--text) 64%, transparent)"),
    decl("line-soft", "color-mix(in srgb, var(--line) 45%, transparent)"),
    decl("surface-raised", "color-mix(in srgb, var(--text) 6%, var(--surface))"),
    decl("shadow", `var(--shadow-${name})`),
  ];
  if (name === "dark") {
    lines.push(decl("brass-ink", "var(--color-brass)"), decl("copper-ink", "var(--color-copper)"), decl("verdigris-ink", "var(--color-verdigris)"));
  } else {
    // Brass, copper and verdigris fail text contrast on parchment; darken toward soot for ink uses only.
    lines.push(
      decl("brass-ink", "color-mix(in srgb, var(--color-brass) 62%, var(--color-soot))"),
      decl("copper-ink", "color-mix(in srgb, var(--color-copper) 82%, var(--color-soot))"),
      decl("verdigris-ink", "color-mix(in srgb, var(--color-verdigris) 78%, var(--color-soot))"),
    );
  }
  return block(`[data-theme="${name}"]`, lines);
}

function deviceBlock(d: (typeof DEVICES)[number]): string {
  const s = `--size-${d.size}`;
  return block(`[data-device="${d.id}"]`, [
    decl("fs-body", `var(${s}-body)`),
    decl("fs-display", `var(${s}-display)`),
    decl("fs-mono", `var(${s}-mono)`),
    decl("fs-small", "calc(var(--fs-body) * 0.875)"),
    decl("fs-title", "calc(var(--fs-body) * 1.3)"),
    decl("fs-lead", "calc(var(--fs-display) * 0.78)"),
    decl("fs-numeral", "calc(var(--fs-display) * 1.5)"),
    decl("fs-hero", "calc(var(--fs-display) * 2.6)"),
    decl("tap", `var(--tap-${d.tap})`),
    decl("pad", `var(--space-${d.pad})`),
    decl("gap", `var(--space-${d.gap})`),
  ]);
}

/** The full contents of dist/tokens.css. Pure: same input, same bytes. */
export function cssText(t: Tokens = tokens): string {
  return [
    "/* Generated from packages/design-tokens/tokens.json. Do not edit. */",
    rootBlock(t),
    themeBlock("dark", t),
    themeBlock("light", t),
    ...DEVICES.map(deviceBlock),
    "",
  ].join("\n\n");
}
