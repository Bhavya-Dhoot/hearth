"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { DeviceClass } from "@hearth/contracts";
import { DEVICES } from "@/lib/devices";
import styles from "./DeviceFrame.module.css";

/**
 * CSS-drawn hardware. Each frame is laid out at the device's true pixel size and scaled as a whole to fit the
 * stage, so a Show 8 has a real 1280 x 800 screen inside a real-proportioned bezel.
 */

type Hardware = Exclude<DeviceClass, "voice-only">;

export function frameSize(d: Hardware) {
  const s = DEVICES[d];
  return { w: s.screen.w + s.bezel * 2, h: s.screen.h + s.bezel * 2 + s.foot };
}

export function Fit({ w, h, children }: { w: number; h: number; children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setK(Math.max(0.05, Math.min(r.width / w, r.height / h, 1)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h]);
  return (
    <div ref={host} className={styles.fitHost}>
      {k > 0 && (
        <div className={styles.fitBox} style={{ inlineSize: w * k, blockSize: h * k }}>
          <div className={styles.fitInner} style={{ inlineSize: w, blockSize: h, transform: `scale(${k})` }}>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

export function DeviceFrame({ device, children }: { device: Hardware; children: ReactNode }) {
  const s = DEVICES[device];
  const { w, h } = frameSize(device);
  return (
    <Fit w={w} h={h}>
      <div
        className={styles.frame}
        data-hardware={device}
        style={{ inlineSize: w, blockSize: h, ["--bz" as string]: `${s.bezel}px`, ["--foot" as string]: `${s.foot}px` }}
      >
        <div className={styles.body}>
          <span className={styles.camera} aria-hidden />
          <div className={styles.glass}>{children}</div>
          {device === "phone" && <span className={styles.island} aria-hidden />}
        </div>
        {device === "echo-show-8" && <span className={styles.foot} aria-hidden />}
      </div>
    </Fit>
  );
}
