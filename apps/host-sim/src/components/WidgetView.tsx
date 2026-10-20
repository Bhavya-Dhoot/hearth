"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DeviceClass, WidgetAction } from "@hearth/contracts";
import { WidgetBridge } from "@hearth/host-sim-core";
import { hostContextFor } from "@/lib/devices";
import type { WidgetApi, WidgetState } from "@/lib/session";
import styles from "./WidgetView.module.css";

type Props = {
  widget: WidgetState;
  device: DeviceClass;
  onAction(a: WidgetAction): void;
  onError(message: string): void;
  register(api: WidgetApi | null): void;
  /**
   * fixed: the iframe is exactly the device viewport.
   * natural: phone. Height follows ui/resize with no cap; the screen scrolls.
   * scale: Show 8 fullscreen and the Show 15 tile. A widget taller than the screen is scaled down uniformly (origin top centre) so the
   * whole card shows; the bottom is never cropped.
   */
  sizing: "fixed" | "natural" | "scale";
};

/**
 * The MCP Apps renderer: a sandboxed iframe driven by WidgetBridge. A new widget document is mounted;
 * a new render of the same widget (step 2 after step 1) only re-sends props so the page does not flash.
 */
export function WidgetView({ widget, device, onAction, onError, register, sizing }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<WidgetBridge | null>(null);
  const mountedUri = useRef<string | null>(null);
  const mountedHtml = useRef<string | null>(null);
  const [reportedHeight, setReportedHeight] = useState<number | null>(null);
  const ctx = useMemo(() => hostContextFor(device), [device]);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  // Callbacks change identity every render; the bridge always calls the latest.
  const handlers = useRef({ onAction, onError });
  handlers.current = { onAction, onError };

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const b = new WidgetBridge(el, {
      onAction: (a) => handlers.current.onAction(a),
      onResize: (h) => setReportedHeight(h),
      onError: (m) => handlers.current.onError(m),
    });
    bridge.current = b;
    register({ voiceIntent: (i) => b.voiceIntent(i) });
    return () => {
      register(null);
      b.destroy();
      bridge.current = null;
      mountedUri.current = null;
      mountedHtml.current = null;
    };
  }, [register]);

  const uri = widget.meta.resourceUri;
  useEffect(() => {
    const b = bridge.current;
    if (!b) return;
    if (mountedUri.current === uri && mountedHtml.current === widget.html) {
      b.render(widget.meta.props);
    } else {
      mountedUri.current = uri;
      mountedHtml.current = widget.html;
      setReportedHeight(null);
      b.mount(widget.html, ctxRef.current, widget.meta.props);
    }
  }, [uri, widget.html, widget.meta.props, widget.seq]);

  useEffect(() => {
    bridge.current?.setContext(ctx);
  }, [ctx]);

  const avail = ctx.maxHeight;
  let style: React.CSSProperties;
  let scale = 1;
  if (sizing === "natural") {
    style = { inlineSize: ctx.maxWidth, blockSize: Math.max(reportedHeight ?? 240, 160) };
  } else if (sizing === "scale" && reportedHeight && reportedHeight > avail) {
    scale = avail / reportedHeight;
    style = { inlineSize: ctx.maxWidth, blockSize: reportedHeight, transform: `scale(${scale})`, transformOrigin: "top center" };
  } else {
    style = { inlineSize: ctx.maxWidth, blockSize: avail };
  }

  const frameEl = (
    <iframe
      ref={frame}
      className={styles.frame}
      style={style}
      title={`${widget.meta.widget.replace(/-/g, " ")} widget`}
      sandbox="allow-scripts"
      data-widget={widget.meta.widget}
      data-pattern={widget.meta.pattern}
      data-scale={scale < 1 ? scale.toFixed(3) : undefined}
    />
  );
  // The wrapper is always present so the iframe keeps its place in the tree when the device (and so the sizing)
  // changes mid-conversation; a remounted iframe would leave the bridge talking to a dead element.
  return (
    <div className={sizing === "scale" ? styles.clip : styles.plain} style={sizing === "scale" ? { inlineSize: ctx.maxWidth, blockSize: avail } : undefined}>
      {frameEl}
    </div>
  );
}
