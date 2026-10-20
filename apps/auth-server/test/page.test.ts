import tokens from "../../../packages/design-tokens/tokens.json";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorizeQuery, makePkce, startServer, type TestServer } from "./helpers";

let server: TestServer;
let html: string;
beforeAll(async () => {
  server = await startServer();
  html = await (await fetch(`${server.issuer}/authorize?${authorizeQuery(makePkce())}`)).text();
});
afterAll(async () => {
  await server.close();
});

/** WCAG 2.x contrast ratio between two #rrggbb colours. */
function contrast(foreground: string, background: string): number {
  const luminance = (hex: string): number => {
    const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
    const [r = 0, g = 0, b = 0] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light = 0, dark = 0] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

describe("sign-in and consent page", () => {
  it("uses the required copy and plain-language scopes", () => {
    expect(html).toContain("<h1>Link Hearth to Alexa</h1>");
    expect(html).toContain("See what Hearth remembers about your home");
    expect(html).toContain("Remember new things in your home");
    expect(html).toContain("Place orders you confirm out loud");
    expect(html).toContain("Link account");
    expect(html).toContain("Cancel");
    expect(html).toContain("Hearth never stores health data or details about children.");
    expect(html).toContain("fonts.googleapis.com/css2?family=Fraunces");
    expect(html).toContain("Instrument+Sans");
    expect(html).toContain("JetBrains+Mono");
  });

  it("takes every colour from tokens.json and declares each hex exactly once", () => {
    const hexes = html.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect([...hexes].sort()).toEqual(Object.values(tokens.color).sort());
    expect(html).not.toMatch(/rgba?\(|hsla?\(|gradient|backdrop-filter/i);
  });

  it("has no emoji, em dash or en dash in the document", () => {
    expect(html).not.toContain(String.fromCharCode(0x2013));
    expect(html).not.toContain(String.fromCharCode(0x2014));
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("puts labels above inputs and keeps the approval as the first submit button", () => {
    expect(html).toMatch(/<label for="email">Email<\/label>\s*<input id="email"/);
    expect(html).toMatch(/<label for="password">Password<\/label>\s*<input id="password"/);
    expect(html.indexOf('value="approve"')).toBeLessThan(html.indexOf('value="deny"'));
    expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1"');
  });

  it("sizes tap targets from the 44px token", () => {
    expect(tokens.tapTarget.phone).toBe("44px");
    expect(html).toContain("--tap: 44px;");
    expect(html).toContain("min-height: var(--tap)");
  });

  it("forbids framing and limits form targets", async () => {
    const response = await fetch(`${server.issuer}/authorize?${authorizeQuery(makePkce())}`);
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self' http://localhost:3000");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("lists only the requested scopes", async () => {
    const page = await (
      await fetch(`${server.issuer}/authorize?${authorizeQuery(makePkce(), { scope: "home:read" })}`)
    ).text();
    expect(page).toContain("See what Hearth remembers about your home");
    expect(page).not.toContain("Place orders you confirm out loud");
  });

  it("escapes request values echoed into the page", async () => {
    const page = await (
      await fetch(`${server.issuer}/authorize?${authorizeQuery(makePkce(), { state: '"><script>x</script>' })}`)
    ).text();
    expect(page).not.toContain("<script>x</script>");
    expect(page).toContain("&quot;&gt;&lt;script&gt;");
  });
});

describe("palette contrast (WCAG AA)", () => {
  const c = tokens.color;
  it.each([
    ["parchment text on soot", c.parchment, c.soot, 4.5],
    ["linen text on soot", c.linen, c.soot, 4.5],
    ["soot text on brass button", c.soot, c.brass, 4.5],
    ["soot text on kraft button hover", c.soot, c.kraft, 4.5],
    ["brass numerals and focus ring on soot", c.brass, c.soot, 3],
    ["copper error marker on soot", c.copper, c.soot, 3],
    ["graphite field border on soot", c.graphite, c.soot, 3],
  ])("%s", (_name, foreground, background, minimum) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(minimum);
  });
});
