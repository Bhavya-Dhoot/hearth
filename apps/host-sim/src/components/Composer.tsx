"use client";

import { useRef, useState } from "react";
import { Microphone, PaperPlaneRight, SpeakerHigh, SpeakerSlash, Waveform } from "@phosphor-icons/react";
import type { HostSession } from "@/lib/session";
import styles from "./Composer.module.css";

/**
 * Three ways in, one pipeline: hold the mic (push-to-talk), tap "Alexa" (the wake-word stand-in, which listens
 * until you stop talking), or type. Pressing any of them while Alexa is speaking cuts her off (barge-in).
 */
export function Composer({ session }: { session: HostSession }) {
  const [text, setText] = useState("");
  const holding = useRef(false);
  const linked = session.link === "linked";
  const replaying = session.replay?.state === "running";
  const disabled = !linked || replaying;
  const busy = session.phase === "thinking";
  const listening = session.phase === "listening";

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || disabled || busy) return;
    session.cancelSpeech();
    setText("");
    void session.submit(t, "text");
  };

  const pressDown = () => {
    if (disabled || holding.current) return;
    holding.current = true;
    session.startListening();
  };
  const pressUp = () => {
    if (!holding.current) return;
    holding.current = false;
    session.stopListening();
  };

  let hint = "Hold the mic and speak, tap Alexa to listen, or type.";
  if (!linked) hint = "Link your Hearth account to talk to it.";
  else if (replaying) hint = "A replay is running. Stop it from the inspector to take over.";
  else if (!session.sttAvailable) hint = "This browser has no speech recognition (Chrome and Edge do). Typing works.";
  else if (listening) hint = session.interim ? session.interim : "Listening. Release to send.";
  else if (busy) hint = "Thinking.";

  return (
    <form className={styles.composer} onSubmit={send} aria-label="Talk to Alexa">
      <div className={styles.row}>
        <button
          type="button"
          className={styles.mic}
          data-live={listening || undefined}
          disabled={disabled || !session.sttAvailable}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            pressDown();
          }}
          onPointerUp={pressUp}
          onPointerCancel={pressUp}
          onKeyDown={(e) => {
            if ((e.key === " " || e.key === "Enter") && !e.repeat) {
              e.preventDefault();
              pressDown();
            }
          }}
          onKeyUp={(e) => {
            if (e.key === " " || e.key === "Enter") pressUp();
          }}
          aria-label="Hold to talk"
          aria-pressed={listening}
        >
          <Microphone size={22} weight="bold" aria-hidden />
          <span>Hold to talk</span>
        </button>
        <button
          type="button"
          className={styles.wake}
          disabled={disabled || !session.sttAvailable}
          onClick={() => (listening ? session.stopListening() : session.startListening())}
        >
          <Waveform size={20} weight="bold" aria-hidden />
          Alexa
        </button>
        <input
          className={styles.input}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => session.cancelSpeech()}
          placeholder="or type what you would say"
          aria-label="Type what you would say"
          disabled={disabled}
          autoComplete="off"
        />
        <button type="submit" className={styles.send} disabled={disabled || busy || !text.trim()} aria-label="Send">
          <PaperPlaneRight size={20} weight="bold" aria-hidden />
        </button>
        <button
          type="button"
          className={styles.mute}
          onClick={session.toggleMute}
          aria-pressed={session.muted}
          aria-label={session.muted ? "Turn Alexa's voice on" : "Mute Alexa's voice"}
        >
          {session.muted ? <SpeakerSlash size={20} weight="bold" aria-hidden /> : <SpeakerHigh size={20} weight="bold" aria-hidden />}
        </button>
      </div>
      <p className={styles.hint} data-live={listening || undefined} aria-live="polite">
        {hint}
      </p>
    </form>
  );
}
