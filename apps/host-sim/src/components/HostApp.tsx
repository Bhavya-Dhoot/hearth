"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DeviceMobile, Monitor, Television, Waveform, X } from "@phosphor-icons/react";
import type { DeviceClass } from "@hearth/contracts";
import { REPLAYS } from "@hearth/host-sim-core";
import { DEVICES, DEVICE_ORDER, defaultDeviceFor, isDeviceClass } from "@/lib/devices";
import { describeMode } from "@/lib/orchestrator-client";
import { useHostSession, type ReplayId } from "@/lib/session";
import { Composer } from "./Composer";
import { DeviceFrame } from "./DeviceFrame";
import { Inspector } from "./Inspector";
import { Screen } from "./Screen";
import { VoiceStage } from "./VoiceStage";
import styles from "./HostApp.module.css";

const DEVICE_ICON: Record<DeviceClass, typeof Monitor> = {
  "echo-show-8": Monitor,
  "echo-show-15": Television,
  phone: DeviceMobile,
  "voice-only": Waveform,
};

const INSPECTOR_KEY = "hearth.inspector";

export function HostApp() {
  const session = useHostSession("echo-show-8");
  const { device, setDevice } = session;
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const booted = useRef(false);

  // First paint is the server's guess; the URL and the viewport decide on the client.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const p = new URLSearchParams(window.location.search);
    const wanted = p.get("device");
    const replayId = p.get("replay");
    if (isDeviceClass(wanted)) setDevice(wanted);
    else if (replayId && replayId in REPLAYS) setDevice(REPLAYS[replayId as ReplayId].device);
    else setDevice(defaultDeviceFor(window.innerWidth));
    try {
      const saved = localStorage.getItem(INSPECTOR_KEY);
      if (saved) setInspectorOpen(saved === "open");
      else if (window.innerWidth < 900) setInspectorOpen(false);
    } catch {
      if (window.innerWidth < 900) setInspectorOpen(false);
    }
  }, [setDevice]);

  // ?replay=J1 plays that journey as soon as the account is linked.
  const replayStarted = useRef(false);
  const { link, startReplay } = session;
  useEffect(() => {
    if (replayStarted.current || link !== "linked") return;
    const id = new URLSearchParams(window.location.search).get("replay");
    if (id && id in REPLAYS) {
      replayStarted.current = true;
      void startReplay(id as ReplayId);
    }
  }, [link, startReplay]);

  const toggleInspector = () => {
    setInspectorOpen((o) => {
      try {
        localStorage.setItem(INSPECTOR_KEY, o ? "closed" : "open");
      } catch {
        /* storage blocked: the choice just does not persist */
      }
      return !o;
    });
  };

  const spec = DEVICES[device];
  const linked = link === "linked";
  const panelShowing = !linked || (!session.widget && session.conn.status === "error");
  const errorStrip = session.error && !panelShowing ? session.error : null;

  return (
    <div className={styles.shell} data-inspector={inspectorOpen ? "open" : "closed"}>
      <section className={styles.stage}>
        <header className={styles.top}>
          <div className={styles.brand}>
            <span className={styles.wordmark}>Hearth</span>
            <span className="label">Host simulator</span>
          </div>

          <div className={styles.devices} role="radiogroup" aria-label="Simulated device">
            {DEVICE_ORDER.map((d) => {
              const Icon = DEVICE_ICON[d];
              return (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={device === d}
                  className={styles.deviceBtn}
                  onClick={() => setDevice(d)}
                >
                  <Icon size={18} weight={device === d ? "fill" : "regular"} aria-hidden />
                  <span>{DEVICES[d].short}</span>
                </button>
              );
            })}
          </div>

          <div className={styles.chips}>
          <span className={styles.chip} data-mode={session.mode?.mode} title={session.mode?.fallbackReason}>
          <span className="label">orchestrator</span>
            <b>{describeMode(session.mode)}</b>
          </span>
          <span className={styles.chip} data-link={session.link}>
          <span className="label">account</span>
            <b>{linked ? "linked" : session.link === "unauthorized" ? "401" : session.link === "checking" ? "..." : "not linked"}</b>
          </span>
          </div>
        </header>

        <div className={styles.deviceArea} data-device={device}>
          {device === "voice-only" ? (
            <VoiceStage session={session} />
          ) : (
            <DeviceFrame device={device}>
              <Screen session={session} device={device} />
            </DeviceFrame>
          )}
        </div>

        <p className={styles.sim}>
          <span className="label">Simulated Alexa+ host</span>
          <span className="label">{spec.label}</span>
        </p>

        {errorStrip && (
          <div className={styles.strip} role="alert">
            <p>
              {errorStrip.message}
              {errorStrip.hint && <span> {errorStrip.hint}</span>}
            </p>
            <button type="button" onClick={session.dismissError} aria-label="Dismiss">
              <X size={14} weight="bold" />
            </button>
          </div>
        )}

        <Composer session={session} />

        <footer className={styles.foot}>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </footer>
      </section>

      <Inspector session={session} open={inspectorOpen} onToggle={toggleInspector} />
    </div>
  );
}
