import qrcode from "qrcode-generator";
import { s } from "./dom";

/** Draws a QR code as one SVG path (crisp modules, no canvas, no image request). */
export function qrSvg(payload: string, label: string): SVGSVGElement {
  const qr = qrcode(0, "M");
  qr.addData(payload);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let row = 0; row < n; row++) {
    let col = 0;
    while (col < n) {
      if (!qr.isDark(row, col)) {
        col++;
        continue;
      }
      let run = 1;
      while (col + run < n && qr.isDark(row, col + run)) run++;
      d += `M${col} ${row}h${run}v1h-${run}z`;
      col += run;
    }
  }
  const quiet = 2;
  return s(
    "svg",
    { class: "qr", viewBox: `${-quiet} ${-quiet} ${n + quiet * 2} ${n + quiet * 2}`, role: "img", "aria-label": label, "shape-rendering": "crispEdges" },
    s("path", { d, class: "qr__modules" }),
  );
}
