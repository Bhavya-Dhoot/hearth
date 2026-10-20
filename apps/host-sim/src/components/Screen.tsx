"use client";

import { useCallback } from "react";
import type { DeviceClass } from "@hearth/contracts";
import { DEVICES } from "@/lib/devices";
import type { HostSession, WidgetApi } from "@/lib/session";
import { LightBar } from "./LightBar";
import { CheckCircle, ShieldCheck } from "@phosphor-icons/react";
import { LinkPanel, OfflinePanel, Suggestions } from "./panels";
import { WidgetView } from "./WidgetView";
import styles from "./Screen.module.css";

type ScreenDevice = Exclude<DeviceClass, "voice-only">;

const PHASE_WORD: Record<HostSession["phase"], string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

/** What Alexa shows before she has said anything this session. */
function idleLine(s: HostSession): string {
  if (s.link === "unlinked" || s.link === "unauthorized") return "Hearth needs to be linked before it can help.";
  if (s.link === "checking" || s.conn.status === "connecting") return "Connecting to Hearth.";
  if (s.conn.status === "error") return "I can't reach Hearth right now.";
  return "Hearth is ready. Ask about your house.";
}

/** Suggestions are for a blank screen only: never beside a widget, a caption, a running replay or a turn in flight. */
function conversationIdle(s: HostSession): boolean {
  return !s.widget && !s.heard && !s.alexa && !s.interim && s.phase === "idle" && s.replay?.state !== "running";
}

export function Screen({ session, device }: { session: HostSession; device: ScreenDevice }) {
  const spec = DEVICES[device];
  const linked = session.link === "linked";
  const needsLink = session.link === "unlinked" || session.link === "unauthorized";
  const offline = linked && !session.widget && session.conn.status === "error";
  const showWidget = linked && !!session.widget;
  const settled = !showWidget && !needsLink && !offline ? session.settled : null;
  const widgetApi = session.widgetApi;
  const register = useCallback(
    (api: WidgetApi | null) => {
      widgetApi.current = api;
    },
    [widgetApi],
  );

  const line = session.phase === "thinking" && showWidget ? "One moment." : session.alexa || idleLine(session);
  const replay = session.replay;

  let main: React.ReactNode;
  if (needsLink) main = <LinkPanel session={session} />;
  else if (offline) main = <OfflinePanel session={session} />;
  else if (showWidget && session.widget) {
    main = (
      <WidgetView
        widget={session.widget}
        device={device}
        sizing={device === "phone" ? "natural" : "scale"}
        onAction={session.onWidgetAction}
        onError={session.setWidgetError}
        register={register}
      />
    );
  } else if (linked && settled) {
    const Icon = settled.label === "SAFETY STOP" ? ShieldCheck : CheckCircle;
    main = (
      <div className={styles.settled} role="status">
        <Icon size={40} weight="regular" aria-hidden />
        <span className="label">{settled.label}</span>
        <p className={styles.settledText}>{settled.text}</p>
      </div>
    );
  } else if (linked && conversationIdle(session)) main = <Suggestions session={session} compact={device === "phone"} />;
  else main = null;

  return (
    <div
      className={styles.screen}
      data-device={device}
      data-theme={spec.theme}
      data-widget={showWidget && !needsLink ? "true" : "false"}
      data-settled={linked && settled ? "true" : "false"}
      style={{ inlineSize: spec.screen.w, blockSize: spec.screen.h }}
      onPointerDown={() => session.cancelSpeech()}
    >
      <header className={styles.voice}>
        <div className={styles.status}>
          <span className="label">Alexa+</span>
          <span className="label" data-phase={session.phase} aria-live="polite">
            {PHASE_WORD[session.phase]}
          </span>
          {replay && (
            <span className="label" data-replay={replay.state}>
              Replay {replay.id} {replay.step}/{replay.total}
            </span>
          )}
        </div>
        <div className={styles.lines}>
          {session.phase === "listening" && session.interim ? (
            <p className={styles.heard}>{session.interim}</p>
          ) : (
            session.heard && (
              <p className={styles.heard} data-kind={session.heard.kind}>
                {session.heard.text}
              </p>
            )
          )}
          <p className={styles.alexa}>{line}</p>
        </div>
      </header>
      <main className={styles.main}>{main}</main>
      <LightBar phase={session.phase} />
    </div>
  );
}
