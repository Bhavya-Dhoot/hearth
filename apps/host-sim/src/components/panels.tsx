"use client";

import { ArrowClockwise, LinkSimple, ShieldCheck } from "@phosphor-icons/react";
import { AUTH_ISSUER, MCP_URL } from "@/lib/config";
import type { HostSession } from "@/lib/session";
import styles from "./panels.module.css";

/** The utterances the seed home can answer; numbered so they can be spoken ("the second one"). */
export const SUGGESTIONS = [
  "There's water under the kitchen sink.",
  "What should I do around the house this weekend?",
  "Did we ever fix the disposal?",
  "Is anything in my house recalled?",
] as const;

export function Suggestions({ session, compact }: { session: HostSession; compact?: boolean }) {
  const busy = session.phase === "thinking" || session.conn.status === "connecting" || session.replay?.state === "running";
  return (
    <section className={styles.suggest} data-compact={compact || undefined} aria-label="Things to ask">
      <h2 className="label">Try asking</h2>
      <ol>
        {SUGGESTIONS.map((s, i) => (
          <li key={s}>
            <button type="button" disabled={busy} onClick={() => void session.submit(s, "text")}>
              <span className={styles.numeral} aria-hidden>
                {i + 1}
              </span>
              <span className={styles.utterance}>{s}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

const SCOPE_ROWS = [
  ["home:read", "See your home profile, history and plans."],
  ["home:write", "Add equipment and log repairs."],
  ["orders:write", "Create orders. Finishing one needs your yes."],
] as const;

export function LinkPanel({ session }: { session: HostSession }) {
  const refused = session.link === "unauthorized";
  const err = session.error?.kind === "network" ? session.error : null;
  return (
    <section className={styles.link} aria-label="Account linking">
      <span className="label">{refused ? "HTTP 401" : "Account linking"}</span>
      <h2>{refused ? "Hearth did not accept that link." : "Link your Hearth account"}</h2>
      <p className={styles.lede}>
        {refused
          ? "The server refused the access token, so nothing was sent. Link again to continue."
          : "Hearth is an Alexa+ add-on. Linking lets it read your home's records and place an order only after you say yes."}
      </p>
      {!err && (
        <ul className={styles.scopes}>
          {SCOPE_ROWS.map(([scope, what]) => (
            <li key={scope}>
              <code>{scope}</code>
              <span>{what}</span>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={() => void session.beginLink()}>
          <LinkSimple weight="bold" aria-hidden />
          Link Hearth account
        </button>
        <span className="label">OAuth 2.1 · PKCE S256</span>
      </div>
      {err && (
        <p className={styles.problem} role="alert">
          {err.message}
          {err.hint && <code>{err.hint}</code>}
        </p>
      )}
      {!err && (
        <p className={styles.fine}>
          <ShieldCheck weight="bold" aria-hidden />
          On a real Echo this step happens in the Alexa app on your phone. Sign-in is served by {new URL(AUTH_ISSUER).host}.
        </p>
      )}
    </section>
  );
}

export function OfflinePanel({ session }: { session: HostSession }) {
  const err = session.error;
  return (
    <section className={styles.link} aria-label="Connection problem">
      <span className="label">Connection</span>
      <h2>Hearth is not answering.</h2>
      <p className={styles.lede}>{err?.message ?? `No reply from ${MCP_URL}.`}</p>
      {err?.hint && (
        <p className={styles.problem}>
          <code>{err.hint}</code>
        </p>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={() => void session.retry()}>
          <ArrowClockwise weight="bold" aria-hidden />
          Try again
        </button>
      </div>
    </section>
  );
}
