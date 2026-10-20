import { s } from "./dom";

export interface AnnotationSpec {
  x: number;
  y: number;
  r: number;
}

/** Deterministic PRNG so the same photo always gets the same "hand" (stable screenshots, no flicker on re-render). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pt = readonly [number, number];
const f = (n: number): string => n.toFixed(1);

/** Catmull-Rom through the points, emitted as cubic Beziers. */
function smooth(points: Pt[]): string {
  const first = points[0];
  if (!first) return "";
  let d = `M${f(first[0])} ${f(first[1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)] ?? first;
    const p1 = points[i] ?? first;
    const p2 = points[i + 1] ?? p1;
    const p3 = points[Math.min(points.length - 1, i + 2)] ?? p2;
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/** A circle drawn by a person: it starts off the mark, overshoots where it began, and wobbles in radius. */
export function circlePath(cx: number, cy: number, radius: number, rand: () => number): string {
  const steps = 26;
  const sweep = Math.PI * 2 * 1.1;
  const start = -Math.PI * (0.55 + rand() * 0.25);
  const wobbleA = rand() * Math.PI * 2;
  const wobbleB = rand() * Math.PI * 2;
  const squash = 0.93 + rand() * 0.05;
  const tilt = (rand() - 0.5) * 0.35;
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = start + sweep * t;
    const rr = radius * (1 + 0.045 * Math.sin(2 * a + wobbleA) + 0.025 * Math.sin(3 * a + wobbleB) + 0.07 * t + (rand() - 0.5) * 0.02);
    const ex = Math.cos(a) * rr;
    const ey = Math.sin(a) * rr * squash;
    pts.push([cx + ex * Math.cos(tilt) - ey * Math.sin(tilt), cy + ex * Math.sin(tilt) + ey * Math.cos(tilt)]);
  }
  return smooth(pts);
}

/** A short flicked arrow that lands just outside the circle, plus its two-stroke head. */
export function arrowPath(cx: number, cy: number, radius: number, dirX: number, dirY: number, length: number, rand: () => number): string {
  const tipDist = radius * 1.18;
  const tip: Pt = [cx + dirX * tipDist, cy + dirY * tipDist];
  const tail: Pt = [cx + dirX * (tipDist + length), cy + dirY * (tipDist + length)];
  const bow = (rand() - 0.5) * length * 0.35 + length * 0.12;
  const ctrl: Pt = [(tip[0] + tail[0]) / 2 - dirY * bow, (tip[1] + tail[1]) / 2 + dirX * bow];
  // Heading at the tip, from the control point toward the tip.
  const hx = tip[0] - ctrl[0];
  const hy = tip[1] - ctrl[1];
  const hl = Math.hypot(hx, hy) || 1;
  const ux = hx / hl;
  const uy = hy / hl;
  const head = Math.max(length * 0.34, radius * 0.38);
  const spread = 0.5 + (rand() - 0.5) * 0.12;
  const wing = (sign: 1 | -1): Pt => {
    const ang = Math.atan2(-uy, -ux) + sign * spread;
    return [tip[0] + Math.cos(ang) * head, tip[1] + Math.sin(ang) * head * (0.95 + rand() * 0.1)];
  };
  const a = wing(1);
  const b = wing(-1);
  return `M${f(tail[0])} ${f(tail[1])}Q${f(ctrl[0])} ${f(ctrl[1])} ${f(tip[0])} ${f(tip[1])}M${f(a[0])} ${f(a[1])}L${f(tip[0])} ${f(tip[1])}L${f(b[0])} ${f(b[1])}`;
}

/**
 * Builds the annotation overlay for an image box. Coordinates are normalised over the box (contract: Annotation).
 * The viewBox is 1000 wide so the circle radius is `r` of the width; height follows the image ratio.
 */
export function buildAnnotation(spec: AnnotationSpec, ratio: number): SVGSVGElement {
  const w = 1000;
  const h = w / ratio;
  const cx = spec.x * w;
  const cy = spec.y * h;
  const radius = Math.max(spec.r * w, 28);
  const rand = mulberry32(Math.round(spec.x * 997 + spec.y * 619 + spec.r * 331));

  // The arrow arrives from the side with the most room: from the target toward the image centre.
  let dx = 0.5 - spec.x;
  let dy = (0.5 - spec.y) / ratio;
  if (Math.hypot(dx, dy) < 0.12) {
    dx = 1;
    dy = -1;
  }
  const dl = Math.hypot(dx, dy);
  const dirX = dx / dl;
  const dirY = dy / dl;
  const length = Math.max(radius * 1.25, 90);

  const circle = circlePath(cx, cy, radius, rand);
  const arrow = arrowPath(cx, cy, radius, dirX, dirY, length, rand);

  const path = (d: string, cls: string) => s("path", { d, class: cls, pathLength: "1", fill: "none" });
  return s(
    "svg",
    { class: "annotation", viewBox: `0 0 ${w} ${f(h)}`, preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" },
    path(circle, "annotation__halo annotation__circle"),
    path(arrow, "annotation__halo annotation__arrow"),
    path(circle, "annotation__stroke annotation__circle"),
    path(arrow, "annotation__stroke annotation__arrow"),
  );
}
