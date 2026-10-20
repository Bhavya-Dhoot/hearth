"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CaretDown,
  CaretRight,
  Copy,
  Pulse,
  SidebarSimple,
  Stop,
  Play,
  X,
} from "@phosphor-icons/react";
import { MCP_PROTOCOL_VERSION } from "@hearth/contracts";
import { REPLAYS, type TrafficEvent } from "@hearth/host-sim-core";
import { MCP_URL } from "@/lib/config";
import { describeMode } from "@/lib/orchestrator-client";
import type { HostSession, ReplayId } from "@/lib/session";
import styles from "./Inspector.module.css";

const REPLAY_IDS = Object.keys(REPLAYS) as ReplayId[];

/** latency tone: verdigris under 200 ms, brass under 500, copper from 500 (PRD 10.6) */
export const latencyTone = (ms: number) => (ms < 200 ? "fast" : ms < 500 ? "ok" : "slow");

const clock = (ts: number) => {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

function headline(e: TrafficEvent): { name: string; detail?: string } {
  const body = asRecord(e.body);
  const params = asRecord(body?.params);
  if (e.method === "tools/call") return { name: "tools/call", detail: e.toolName ?? (params?.name as string | undefined) };
  if (e.method === "resources/read") {
    const contents = asRecord(body?.result)?.contents;
    const uri = (params?.uri ?? asRecord(Array.isArray(contents) ? contents[0] : undefined)?.uri) as string | undefined;
    return { name: "resources/read", detail: uri?.replace("ui://hearth/", "") };
  }
  if (e.method) return { name: e.method };
  if (body?.error) return { name: "error" };
  return { name: "message" };
}

/** The 401 demo, as a shell command: no bearer, so the server answers 401 with no WWW-Authenticate header. */
const CURL_401 = `curl -i -X POST ${MCP_URL} \\
  -H 'content-type: application/json' \\
  -H 'accept: application/json, text/event-stream' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"${MCP_PROTOCOL_VERSION}","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'`;

function Row({ e }: { e: TrafficEvent }) {
  const [open, setOpen] = useState(false);
  const { name, detail } = headline(e);
  const out = e.dir === "out";
  const failed = e.status === 401 || (e.status !== undefined && e.status >= 400) || e.status === 0;
  const isCall = e.method === "tools/call" && !out && e.ms !== undefined && !failed;
  const json = useMemo(() => (open ? JSON.stringify(e.body, null, 2) : ""), [open, e.body]);
  return (
    <li className={styles.row} data-dir={e.dir} data-failed={failed || undefined}>
      <button type="button" className={styles.rowHead} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={styles.time}>{clock(e.ts)}</span>
        <span className={styles.arrow} aria-label={out ? "request" : "response"}>
          {out ? <ArrowRight size={13} weight="bold" /> : <ArrowLeft size={13} weight="bold" />}
        </span>
        <span className={styles.method}>
          <b>{name}</b>
          {detail && <em>{detail}</em>}
        </span>
        {failed && <span className={styles.status}>{e.status === 0 ? "NET" : e.status}</span>}
        {isCall ? (
          <span className={styles.badge} data-tone={latencyTone(e.ms!)} title="round trip including network">
            {e.ms} ms
          </span>
        ) : (
          !out && e.ms !== undefined && !failed && <span className={styles.ms}>{e.ms} ms</span>
        )}
        {open ? <CaretDown size={12} weight="bold" aria-hidden /> : <CaretRight size={12} weight="bold" aria-hidden />}
      </button>
      {open && <pre className={styles.json}>{json}</pre>}
    </li>
  );
}

function Fact({ k, children, tone }: { k: string; children: React.ReactNode; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className={styles.fact}>
      <dt className="label">{k}</dt>
      <dd data-tone={tone}>{children}</dd>
    </div>
  );
}

export function Inspector({ session, open, onToggle }: { session: HostSession; open: boolean; onToggle(): void }) {
  const listRef = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const [copied, setCopied] = useState(false);
  const { traffic, replay } = session;

  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [traffic.length, open]);

  const calls = traffic.filter((t) => t.dir === "in" && t.method === "tools/call" && t.status === 200).length;
  const auth =
    session.link === "linked" ? { text: "Linked", tone: "good" as const }
    : session.link === "unauthorized" ? { text: "401 refused", tone: "bad" as const }
    : session.link === "unlinked" ? { text: "Not linked", tone: "warn" as const }
    : { text: "Checking", tone: undefined };

  const copyCurl = async () => {
    try {
      await navigator.clipboard.writeText(CURL_401);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the command is shown in the title for manual copy */
    }
  };

  return (
    <aside className={styles.rail} data-open={open} aria-label="Protocol inspector">
      <button type="button" className={styles.handle} onClick={onToggle} aria-expanded={open}>
        <Pulse size={18} weight="bold" aria-hidden />
        <span className="label">Inspector</span>
        <span className={styles.count}>{traffic.length}</span>
        <SidebarSimple className={styles.handleIcon} size={18} weight="bold" aria-hidden />
        <span className="sr-only">{open ? "Collapse inspector" : "Expand inspector"}</span>
      </button>

      <div className={styles.panel}>
        <header className={styles.head}>
          <div className={styles.titleRow}>
            <h2>Inspector</h2>
            <span className="label">JSON-RPC over Streamable HTTP</span>
            <button type="button" className={styles.close} onClick={onToggle} aria-label="Collapse inspector">
              <X size={16} weight="bold" />
            </button>
          </div>

          <div className={styles.replay} role="group" aria-label="Replay a demo journey">
            <span className="label">Replay</span>
            <div className={styles.replayButtons}>
              {REPLAY_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={styles.replayBtn}
                  data-active={replay?.id === id && replay.state === "running" ? "true" : undefined}
                  disabled={session.link !== "linked"}
                  title={REPLAYS[id].title}
                  onClick={() => void session.startReplay(id)}
                >
                  {id}
                </button>
              ))}
              {replay?.state === "running" && (
                <button type="button" className={styles.stop} onClick={session.stopReplay}>
                  <Stop size={12} weight="fill" aria-hidden />
                  Stop
                </button>
              )}
            </div>
            {replay && (
              <p className={styles.replayLine} data-state={replay.state}>
                {replay.state === "running" && (
                  <>
                    <Play size={11} weight="fill" aria-hidden /> {replay.id} turn {replay.step} of {replay.total}
                  </>
                )}
                {replay.state === "done" &&
                  (replay.firstMismatch === -1
                    ? `${replay.id} complete: ${replay.seen.length} real tool calls, sequence matches.`
                    : `${replay.id} complete, but call ${replay.firstMismatch + 1} was ${replay.seen[replay.firstMismatch] ?? "missing"}; expected ${replay.expect[replay.firstMismatch] ?? "none"}.`)}
                {replay.state === "stopped" && `${replay.id} stopped at turn ${replay.step}.`}
                {replay.state === "failed" && `${replay.id} failed: ${replay.error}`}
              </p>
            )}
          </div>
        </header>

        <dl className={styles.facts}>
          <Fact k="Account" tone={auth.tone}>{auth.text}</Fact>
          <Fact k="Orchestrator">
            <span title={session.mode?.fallbackReason}>{describeMode(session.mode)}</span>
          </Fact>
          <Fact k="Protocol">{session.session.protocol ?? MCP_PROTOCOL_VERSION}</Fact>
          <Fact k="Session">{session.session.id ? <code title={session.session.id}>{session.session.id.slice(0, 13)}</code> : "none yet"}</Fact>
          <Fact k="Server">{session.session.server ?? new URL(MCP_URL).host}</Fact>
          <Fact k="Tools">{session.tools.length ? `${session.tools.length} listed, ${calls} called` : "not listed"}</Fact>
          <Fact k="Voice out">{session.voice === "polly" ? "Amazon Polly" : session.voice === "browser" ? "Browser voice" : "Not used yet"}</Fact>
          {session.claims?.sub && <Fact k="Subject"><code>{session.claims.sub}</code></Fact>}
        </dl>

        {session.mode?.fallbackReason && (
          <p className={styles.note} role="note">
            Fell back to rules: {session.mode.fallbackReason}
          </p>
        )}

        <div className={styles.tools}>
          <button type="button" onClick={copyCurl} title={CURL_401}>
            <Copy size={14} weight="bold" aria-hidden />
            {copied ? "Copied" : "Copy 401 curl"}
          </button>
          <button type="button" onClick={() => void session.probeUnauthorized()}>
            Send without a token
          </button>
          {session.link === "linked" && (
            <button type="button" onClick={() => void session.unlink()}>
              Unlink
            </button>
          )}
        </div>

        <div className={styles.streamHead}>
          <span className="label">Stream</span>
          {traffic.length > 0 && (
            <button type="button" className={styles.clear} onClick={session.clearTraffic}>
              Clear
            </button>
          )}
        </div>

        {traffic.length === 0 ? (
          <div className={styles.empty}>
            <p>No traffic yet. Once the account is linked, the host speaks MCP in this order:</p>
            <ol>
              <li>initialize</li>
              <li>tools/list</li>
              <li>tools/call</li>
              <li>resources/read ui://</li>
            </ol>
            <p>Each request and response lands here as it happens.</p>
          </div>
        ) : (
          <ol
            ref={listRef}
            className={styles.stream}
            onScroll={(ev) => {
              const el = ev.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
          >
            {traffic.map((e) => (
              <Row key={e.id} e={e} />
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
