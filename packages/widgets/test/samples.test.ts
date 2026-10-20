import { WidgetName, WidgetProps } from "@hearth/contracts";
import { describe, expect, it } from "vitest";
import { WIDGET_SAMPLES, WIDGET_SAMPLES_EXTRA } from "../src/index";

describe("widget samples", () => {
  it("has exactly one sample per widget", () => {
    expect(Object.keys(WIDGET_SAMPLES).sort()).toEqual([...WidgetName.options].sort());
  });

  for (const name of WidgetName.options) {
    it(`${name} sample validates against its contract schema`, () => {
      const result = WidgetProps[name].safeParse(WIDGET_SAMPLES[name]);
      expect(result.success, result.success ? "" : JSON.stringify(result.error.issues)).toBe(true);
    });
  }

  it("extra states validate too, and the checkout card has both states", () => {
    const extras = [
      ...Object.values(WIDGET_SAMPLES_EXTRA["checkout-card"]).map((p) => ["checkout-card", p] as const),
      ...Object.values(WIDGET_SAMPLES_EXTRA["step-card"]).map((p) => ["step-card", p] as const),
      ...Object.values(WIDGET_SAMPLES_EXTRA["recall-card"]).map((p) => ["recall-card", p] as const),
    ];
    for (const [name, props] of extras) {
      const result = WidgetProps[name].safeParse(props);
      expect(result.success, `${name}: ${result.success ? "" : JSON.stringify(result.error.issues)}`).toBe(true);
    }
    expect(WIDGET_SAMPLES_EXTRA["checkout-card"].checkout.state).toBe("checkout");
    expect(WIDGET_SAMPLES_EXTRA["checkout-card"].confirmation.state).toBe("confirmation");
  });

  it("uses the Okafor house facts from the PRD", () => {
    const text = JSON.stringify([WIDGET_SAMPLES, WIDGET_SAMPLES_EXTRA]);
    for (const fact of ["HR-PT-150-WSH", "4.29", "InSinkErator", "Badger 5", "16x25x1", "Bosch", "1-1/2", "http://localhost:4200/media/"]) expect(text).toContain(fact);
  });
});
