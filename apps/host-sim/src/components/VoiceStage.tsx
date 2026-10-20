"use client";

import { useEffect, useRef } from "react";
import type { HostSession } from "@/lib/session";
import { LightBar } from "./LightBar";
import { Fit } from "./DeviceFrame";
import { LinkPanel, OfflinePanel } from "./panels";
import styles from "./VoiceStage.module.css";

const W = 1280;
const H = 640;

/** Voice-only: no glass at all. A speaker puck, and the transcript of what is said and what the tools returned. */
export function VoiceStage({ session }: { session: HostSession }) {
  const log = useRef<HTMLOListElement>(null);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [session.lines.length, session.interim, session.phase]);

  const needsLink = session.link === "unlinked" || session.link === "unauthorized";
  const offline = session.link === "linked" && session.conn.status === "error";
  const empty = session.lines.length === 0 && !session.interim;

  return (
    <Fit w={W} h={H}>
      <div className={styles.stage} data-device="echo-show-8" data-theme="dark" style={{ inlineSize: W, blockSize: H }}>
        <div className={styles.puckCol}>
          <div className={styles.puck} onPointerDown={() => session.cancelSpeech()}>
            <LightBar phase={session.phase} variant="ring" />
            <span className={styles.dots} aria-hidden>
              <i />
              <i />
              <i />
              <i />
            </span>
          </div>
          <span className="label">{session.phase === "idle" ? "Waiting" : session.phase}</span>
        </div>
        <div className={styles.transcript}>
          {needsLink ? (
            <LinkPanel session={session} />
          ) : offline ? (
            <OfflinePanel session={session} />
          ) : (
            <>
              <span className="label">Transcript · no screen on this device</span>
              <ol ref={log} className={styles.log} aria-live="polite">
                {empty && (
                  <li className={styles.hint}>
                    Hold the microphone and say what is wrong, or type it below. Everything Alexa says appears here, because there is no
                    screen to show it on.
                  </li>
                )}
                {session.lines.map((l) => (
                  <li key={l.id} data-role={l.role}>
                    <span className="label">{l.role === "alexa" ? "Alexa+" : l.role === "tap" ? "Tap" : "You"}</span>
                    <p>{l.text}</p>
                  </li>
                ))}
                {session.interim && (
                  <li data-role="user" data-live>
                    <span className="label">You</span>
                    <p>{session.interim}</p>
                  </li>
                )}
                {session.phase === "thinking" && (
                  <li data-role="alexa" data-live>
                    <span className="label">Alexa+</span>
                    <p className={styles.thinking}>One moment.</p>
                  </li>
                )}
              </ol>
            </>
          )}
        </div>
      </div>
    </Fit>
  );
}
