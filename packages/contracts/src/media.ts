import type { Annotation } from "./db";

/**
 * Seed-house illustrations (clean line art, PRD 10.2). Drawn by the widgets lane in
 * packages/widgets/media/, served by mcp-server at `${mcpBase}/media/<file>`.
 * The drawing MUST place the annotated object at these normalised coordinates so the
 * hand-drawn annotation stroke lands on it. Canvas: 1200x900 (4:3) for photos, 600x600 for parts.
 */
export const HOME_MEDIA = {
  "kitchen-sink-shutoffs.svg": { alt: "Under your kitchen sink: two chrome angle-stop valves on the back wall, cold on the right", annotation: { x: 0.64, y: 0.62, r: 0.08 } },
  "kitchen-ptrap.svg": { alt: "Your kitchen sink P-trap, white PVC, with the slip-joint nut below the basket strainer", annotation: { x: 0.47, y: 0.55, r: 0.09 } },
  "main-shutoff-garage.svg": { alt: "Main water shut-off in your garage: red lever valve on the copper line, left of the electrical panel", annotation: { x: 0.27, y: 0.46, r: 0.08 } },
  "electrical-panel.svg": { alt: "Your electrical panel in the garage with labelled breakers; the kitchen circuit is third from the top on the right", annotation: { x: 0.62, y: 0.38, r: 0.07 } },
  "disposal-reset.svg": { alt: "Underside of your garbage disposal: red reset button and the hex socket in the centre", annotation: { x: 0.5, y: 0.74, r: 0.07 } },
  "furnace-filter-slot.svg": { alt: "Your furnace filter slot on the return side, 16 by 25 by 1 filter with the airflow arrow", annotation: { x: 0.46, y: 0.55, r: 0.11 } },
  "water-heater-label.svg": { alt: "Rating label on your Rheem 50-gallon electric water heater with model and serial", annotation: { x: 0.5, y: 0.34, r: 0.1 } },
  "dishwasher-filter.svg": { alt: "Bottom of your dishwasher tub with the cylindrical filter twisted out", annotation: { x: 0.5, y: 0.7, r: 0.09 } },
} as const satisfies Record<string, { alt: string; annotation: Annotation }>;
export type HomeMediaFile = keyof typeof HOME_MEDIA;

/** Generic fallback illustration for steps where the home graph has no photo. */
export const GENERIC_MEDIA = {
  "generic-shutoff.svg": "Generic angle-stop shut-off valve, turned clockwise to close",
  "generic-ptrap.svg": "Generic sink P-trap with slip-joint nuts",
  "generic-breaker.svg": "Generic breaker in the tripped middle position",
  "generic-toilet-tank.svg": "Inside a toilet tank: flapper, fill valve and chain",
} as const;

/** One illustration per part family; every catalogue SKU's image points at one of these. */
export const PART_MEDIA = [
  "part-slip-washer.svg",
  "part-supply-line.svg",
  "part-hvac-filter.svg",
  "part-fridge-filter.svg",
  "part-flapper.svg",
  "part-fill-valve.svg",
  "part-9v-battery.svg",
  "part-hex-wrench.svg",
  "part-plunger.svg",
  "part-dishwasher-filter.svg",
  "part-disposal-gasket.svg",
  "part-thermostat-battery.svg",
] as const;
export type PartMediaFile = (typeof PART_MEDIA)[number];

export const mediaUrl = (mcpBase: string, file: string) => `${mcpBase}/media/${file}`;
