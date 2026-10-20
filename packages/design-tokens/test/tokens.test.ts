import { describe, expect, it } from "vitest";
import { cssText, tokens } from "../src/index";

describe("tokens.css", () => {
  const css = cssText();

  it("declares every colour, font, radius, space, motion and tap token", () => {
    for (const name of Object.keys(tokens.color)) expect(css).toContain(`--color-${name}:`);
    for (const name of ["display", "body", "mono"]) expect(css).toContain(`--font-${name}:`);
    for (const name of Object.keys(tokens.radius)) expect(css).toContain(`--radius-${name}:`);
    for (const name of Object.keys(tokens.space)) expect(css).toContain(`--space-${name}:`);
    for (const name of Object.keys(tokens.motion)) expect(css).toContain(`--motion-${name}:`);
    expect(css).toContain("--tap-show:");
    expect(css).toContain("--tap-phone:");
  });

  it("emits semantic theme variables for dark and light", () => {
    for (const theme of ["dark", "light"]) {
      const start = css.indexOf(`[data-theme="${theme}"]`);
      expect(start).toBeGreaterThan(-1);
      const body = css.slice(start, css.indexOf("}", start));
      for (const v of ["--bg:", "--surface:", "--text:", "--text-muted:", "--line:"]) expect(body).toContain(v);
    }
  });

  it("emits a type scale per device", () => {
    for (const device of ["echo-show-8", "echo-show-15", "phone"]) {
      const start = css.indexOf(`[data-device="${device}"]`);
      expect(start).toBeGreaterThan(-1);
      const body = css.slice(start, css.indexOf("}", start));
      for (const v of ["--fs-body:", "--fs-display:", "--fs-mono:"]) expect(body).toContain(v);
    }
  });
});
