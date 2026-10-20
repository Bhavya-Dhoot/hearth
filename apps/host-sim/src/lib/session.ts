"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeviceClass, UiMeta, VoiceIntent, WidgetAction } from "@hearth/contracts";
import {
  McpHostClient,
  REPLAYS,
  UnauthorizedError,
  actionToUtterance,
  parseTapUtterance,
  createInitialState,
  runTurn,
  type ConversationState,
  type ToolDef,
  type TrafficEvent,
} from "@hearth/host-sim-core";
import { clearTokens, currentAccessToken, describeToken, ensureFreshToken, loadTokens, startLink, AuthServerUnreachable } from "./auth";
import { CLIENT_NAME, MCP_URL } from "./config";
import { parseVoiceIntent } from "./intents";
import { createRemoteOrchestrator, fetchMode, type ModeReport } from "./orchestrator-client";
import { Speaker, listen, sttSupported, type Listener, type VoiceEngine } from "./speech";

/* ------------------------------------------------------------------------------------------------
 * One hook owns the whole simulated host: the MCP client, the conversation, speech, the widget and
 * the traffic. Components below it are plain views.
 * ---------------------------------------------------------------------------------------------- */

export type Heard = { text: string; kind: "say" | "action"; seq: number };

const TAP_LABEL: Record<string, string> = {
  next_step: "Tapped Next",
  done: "Tapped Done",
  skip_step: "Tapped Skip",
  select_part: "Tapped a part",
  confirm_checkout: "Tapped Confirm",
  cancel_checkout: "Tapped Cancel",
  reorder: "Tapped Reorder",
  find_pro: "Tapped Find a pro",
  open_event: "Tapped an event",
};

/** What the customer sees as their own caption: spoken words as spoken, taps and photos as plain actions. */
function describeUtterance(text: string): Omit<Heard, "seq"> {
  const tap = parseTapUtterance(text);
  if (tap) return { text: TAP_LABEL[tap.name] ?? `Tapped ${tap.name}`, kind: "action" };
  if (text.startsWith("[photo]")) return { text: "Sent a photo of the label", kind: "action" };
  return { text, kind: "say" };
}

export type WidgetApi = { voiceIntent(i: VoiceIntent): void };
export type Phase = "idle" | "listening" | "thinking" | "speaking";
export type LinkState = "checking" | "unlinked" | "linked" | "unauthorized";
export type Source = "voice" | "text" | "tap";
export type ReplayId = keyof typeof REPLAYS;

export type Line = { id: number; role: "user" | "alexa" | "tap"; text: string };
export type ScreenError = { kind: "network" | "auth" | "orchestrator" | "widget" | "speech"; message: string; hint?: string };
export type WidgetState = { meta: UiMeta; html: string; seq: number };
export type ReplayStatus = {
  id: ReplayId;
  title: string;
  step: number;
  total: number;
  state: "running" | "done" | "stopped" | "failed";
  /** tool names in the order the real server was called */
  seen: string[];
  /** the sequence the replay must produce */
  expect: string[];
  /** index of the first call that differs from `expect`, or -1 when the sequences match exactly */
  firstMismatch: number;
  error?: string;
};

const MAX_TRAFFIC = 500;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const isUnauthorized = (e: unknown) =>
  e instanceof UnauthorizedError || (e instanceof Error && (e.name === "UnauthorizedError" || /\b401\b/.test(e.message)));

function describeFailure(e: unknown): ScreenError {
  if (e instanceof AuthServerUnreachable) {
    return { kind: "network", message: e.message, hint: "Start it with: pnpm --filter @hearth/auth-server dev" };
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof TypeError || /failed to fetch|networkerror|load failed|ECONNREFUSED/i.test(msg)) {
    return { kind: "network", message: `Cannot reach Hearth at ${MCP_URL}.`, hint: "Start it with: pnpm --filter @hearth/mcp-server dev" };
  }
  return { kind: "orchestrator", message: msg };
}

export function useHostSession(initialDevice: DeviceClass) {
  const [device, setDeviceState] = useState<DeviceClass>(initialDevice);
  const [link, setLink] = useState<LinkState>("checking");
  const [conn, setConn] = useState<{ status: "idle" | "connecting" | "ready" | "error" }>({ status: "idle" });
  const [session, setSession] = useState<{ id?: string; protocol?: string; server?: string }>({});
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [traffic, setTraffic] = useState<TrafficEvent[]>([]);
  const [mode, setMode] = useState<ModeReport | null>(null);
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [interim, setInterim] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [alexa, setAlexa] = useState("");
  const [heard, setHeard] = useState<Heard | null>(null);
  const [widget, setWidget] = useState<WidgetState | null>(null);
  const [error, setError] = useState<ScreenError | null>(null);
  const [replay, setReplay] = useState<ReplayStatus | null>(null);
  const [muted, setMuted] = useState(false);
  const [voice, setVoice] = useState<VoiceEngine>("none");
  const [sttAvailable, setSttAvailable] = useState(false);
  const [claims, setClaims] = useState<ReturnType<typeof describeToken>>(null);

  const clientRef = useRef<McpHostClient | null>(null);
  const connectingRef = useRef<Promise<McpHostClient> | null>(null);
  const toolsRef = useRef<ToolDef[]>([]);
  const stateRef = useRef<ConversationState>(createInitialState(initialDevice));
  const busyRef = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  const listenerRef = useRef<Listener | null>(null);
  const lineId = useRef(0);
  const heardSeq = useRef(0);
  const widgetSeq = useRef(0);
  const mutedRef = useRef(false);
  const replayToken = useRef<{ cancelled: boolean } | null>(null);
  const seenTools = useRef<string[]>([]);
  const lastFailed = useRef<{ text: string; source: Source } | null>(null);
  /** the mounted WidgetBridge registers itself here so voice can be mirrored on the glass */
  const widgetApi = useRef<WidgetApi | null>(null);

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const speaker = useMemo(
    () =>
      new Speaker((speaking, engine) => {
        setVoice(engine);
        if (speaking) setPhase("speaking");
        else if (phaseRef.current === "speaking") setPhase("idle");
      }),
    [setPhase],
  );

  const preferRef = useRef<string | undefined>(undefined);
  const orchestrator = useMemo(() => createRemoteOrchestrator(setMode, () => preferRef.current), []);

  const pushTraffic = useCallback((e: TrafficEvent) => {
    setTraffic((prev) => (prev.length >= MAX_TRAFFIC ? [...prev.slice(prev.length - MAX_TRAFFIC + 1), e] : [...prev, e]));
  }, []);

  const addLine = useCallback((role: Line["role"], text: string) => {
    setLines((prev) => [...prev.slice(-40), { id: ++lineId.current, role, text }]);
  }, []);

  /* ------------------------------------------------------------ account link */

  const refreshLink = useCallback(() => {
    const t = loadTokens();
    setClaims(describeToken(t));
    setLink(t ? "linked" : "unlinked");
  }, []);

  useEffect(() => {
    refreshLink();
    setSttAvailable(sttSupported());
    const p = new URLSearchParams(window.location.search);
    const asked = p.get("orchestrator") ?? undefined;
    // Replays default to the rules orchestrator so they reproduce; &orchestrator=ollama|bedrock opts in.
    preferRef.current = p.get("replay") ? (asked ?? "rules") : asked;
    fetchMode(preferRef.current).then(setMode).catch(() => setMode(null));
  }, [refreshLink]);

  const beginLink = useCallback(async () => {
    setError(null);
    try {
      await startLink(window.location.pathname + window.location.search);
    } catch (e) {
      setError(describeFailure(e));
    }
  }, []);

  const unlink = useCallback(async () => {
    const c = clientRef.current;
    clientRef.current = null;
    clearTokens();
    setClaims(null);
    setLink("unlinked");
    setConn({ status: "idle" });
    setSession({});
    setTools([]);
    toolsRef.current = [];
    setWidget(null);
    await c?.close().catch(() => undefined);
  }, []);

  const failAuth = useCallback(() => {
    clearTokens();
    clientRef.current = null;
    setClaims(null);
    setLink("unauthorized");
    setConn({ status: "error" });
    setWidget(null);
    setError({
      kind: "auth",
      message: "Hearth refused the access token (HTTP 401).",
      hint: "Link your account again. The 401 is in the inspector.",
    });
  }, []);

  /* ------------------------------------------------------------ MCP connection */

  const connect = useCallback(async (): Promise<McpHostClient> => {
    if (clientRef.current) return clientRef.current;
    if (connectingRef.current) return connectingRef.current;
    const attempt = (async () => {
      setConn({ status: "connecting" });
      const client = new McpHostClient({ url: MCP_URL, getToken: currentAccessToken, onTraffic: pushTraffic, clientName: CLIENT_NAME });
      try {
        const info = await client.connect();
        const list = await client.listTools();
        clientRef.current = client;
        toolsRef.current = list;
        setTools(list);
        setSession({ id: client.sessionId ?? info.sessionId, protocol: info.protocolVersion, server: `${info.serverInfo.name} ${info.serverInfo.version}` });
        setConn({ status: "ready" });
        setError((prev) => (prev && (prev.kind === "network" || prev.kind === "auth") ? null : prev));
        return client;
      } catch (e) {
        await client.close().catch(() => undefined);
        if (isUnauthorized(e)) failAuth();
        else {
          setConn({ status: "error" });
          setError(describeFailure(e));
        }
        throw e;
      }
    })();
    connectingRef.current = attempt;
    try {
      return await attempt;
    } finally {
      connectingRef.current = null;
    }
  }, [failAuth, pushTraffic]);

  useEffect(() => {
    if (link === "linked" && !clientRef.current) connect().catch(() => undefined);
  }, [link, connect]);

  useEffect(() => {
    const bye = () => void clientRef.current?.close();
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, []);

  /* ------------------------------------------------------------ a turn */

  const showWidget = useCallback(async (client: McpHostClient, meta: UiMeta) => {
    try {
      const res = await client.readResource(meta.resourceUri);
      setWidget({ meta, html: res.html, seq: ++widgetSeq.current });
    } catch (e) {
      if (isUnauthorized(e)) throw e;
      setError({ kind: "widget", message: `Could not load ${meta.resourceUri}.`, hint: e instanceof Error ? e.message : undefined });
    }
  }, []);

  const say = useCallback(
    (text: string): Promise<void> => {
      if (!text || mutedRef.current) return Promise.resolve();
      return speaker.speak(text);
    },
    [speaker],
  );

  const submit = useCallback(
    async (text: string, source: Source): Promise<{ ok: boolean; spoken: Promise<void> }> => {
      const none = Promise.resolve();
      const clean = text.trim();
      if (!clean) return { ok: false, spoken: none };
      if (busyRef.current) return { ok: false, spoken: none };
      busyRef.current = true;
      speaker.cancel(); // barge-in: a new turn always cuts the old one off
      lastFailed.current = { text: clean, source };
      setError((prev) => (prev?.kind === "speech" ? null : prev));
      const shown = describeUtterance(clean);
      setHeard({ ...shown, seq: ++heardSeq.current });
      addLine(source === "tap" ? "tap" : "user", shown.text);
      setPhase("thinking");

      const intent = source === "tap" ? null : parseVoiceIntent(clean);
      if (intent) widgetApi.current?.voiceIntent(intent);

      try {
        await ensureFreshToken();
        if (!currentAccessToken()) throw new UnauthorizedError("No access token");
        const client = await connect();
        const result = await runTurn({
          client,
          orchestrator,
          state: stateRef.current,
          userText: clean,
          source,
          tools: toolsRef.current,
          maxToolCalls: 4,
        });
        stateRef.current = result.state;
        for (const c of result.toolCalls) seenTools.current.push(c.name);
        if (result.ui) await showWidget(client, result.ui);
        setAlexa(result.say);
        if (result.say) addLine("alexa", result.say);
        lastFailed.current = null;
        setPhase("idle");
        busyRef.current = false;
        return { ok: true, spoken: say(result.say) };
      } catch (e) {
        if (isUnauthorized(e)) failAuth();
        else setError(describeFailure(e));
        setPhase("idle");
        busyRef.current = false;
        return { ok: false, spoken: none };
      }
    },
    [addLine, connect, failAuth, orchestrator, say, setPhase, showWidget, speaker],
  );

  const onWidgetAction = useCallback(
    (a: WidgetAction) => {
      speaker.cancel();
      void submit(actionToUtterance(a), "tap");
    },
    [speaker, submit],
  );

  const retry = useCallback(async () => {
    setError(null);
    if (link === "unauthorized" || link === "unlinked") return;
    try {
      await connect();
      const f = lastFailed.current;
      if (f) void submit(f.text, f.source);
    } catch {
      /* connect() already surfaced the failure */
    }
  }, [connect, link, submit]);

  /* ------------------------------------------------------------ listening */

  const startListening = useCallback(() => {
    speaker.cancel();
    if (listenerRef.current || busyRef.current) return;
    if (!sttSupported()) {
      setError({
        kind: "speech",
        message: "This browser has no speech recognition.",
        hint: "Chrome and Edge do. Use the text box here, or try the replay.",
      });
      return;
    }
    setError((prev) => (prev?.kind === "speech" ? null : prev));
    let delivered = false;
    const l = listen({
      onStart: () => {
        setPhase("listening");
        widgetApi.current?.voiceIntent({ kind: "listening" });
      },
      onSpeech: () => speaker.cancel(),
      onInterim: setInterim,
      onFinal: (t) => {
        delivered = true;
        setInterim("");
        void submit(t, "voice");
      },
      onEnd: () => {
        listenerRef.current = null;
        setInterim("");
        if (phaseRef.current === "listening") setPhase("idle");
        widgetApi.current?.voiceIntent({ kind: "idle" });
        if (!delivered) {
          /* silence: nothing to send */
        }
      },
      onError: (code, message) => {
        if (code === "no-speech") return;
        setError({ kind: "speech", message, hint: "You can type instead." });
      },
    });
    listenerRef.current = l;
  }, [setPhase, speaker, submit]);

  const stopListening = useCallback(() => listenerRef.current?.stop(), []);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
    if (mutedRef.current) speaker.cancel();
  }, [speaker]);

  /* ------------------------------------------------------------ device, reset, replay */

  const setDevice = useCallback(
    (d: DeviceClass) => {
      speaker.cancel();
      stateRef.current = { ...stateRef.current, device: d };
      setDeviceState(d);
    },
    [speaker],
  );

  const resetConversation = useCallback(
    async (d: DeviceClass) => {
      speaker.cancel();
      listenerRef.current?.abort();
      const c = clientRef.current;
      clientRef.current = null;
      await c?.close().catch(() => undefined);
      stateRef.current = createInitialState(d);
      seenTools.current = [];
      setDeviceState(d);
      setTraffic([]);
      setLines([]);
      setAlexa("");
      setHeard(null);
      setWidget(null);
      setError(null);
      setSession({});
      setTools([]);
      toolsRef.current = [];
      setConn({ status: "idle" });
      setPhase("idle");
    },
    [setPhase, speaker],
  );

  const stopReplay = useCallback(() => {
    if (replayToken.current) replayToken.current.cancelled = true;
    setReplay((r) => (r && r.state === "running" ? { ...r, state: "stopped" } : r));
  }, []);

  const startReplay = useCallback(
    async (id: ReplayId) => {
      const script = REPLAYS[id];
      if (!script) return;
      if (replayToken.current) replayToken.current.cancelled = true;
      const token = { cancelled: false };
      replayToken.current = token;
      busyRef.current = false;
      const asked = new URLSearchParams(window.location.search).get("orchestrator") ?? undefined;
      preferRef.current = asked ?? "rules";
      try {
        const u = new URL(window.location.href);
        u.searchParams.set("replay", id);
        window.history.replaceState(null, "", u);
      } catch {
        /* the address bar is cosmetic */
      }
      await resetConversation(script.device);
      if (token.cancelled) return;
      const base: ReplayStatus = { id, title: script.title, step: 0, total: script.turns.length, state: "running", seen: [], expect: script.expectTools, firstMismatch: -1 };
      setReplay(base);
      try {
        await connect();
        for (let i = 0; i < script.turns.length; i++) {
          const turn = script.turns[i]!;
          if (token.cancelled) return;
          await sleep(Math.max(300, turn.pauseMs));
          if (token.cancelled) return;
          const r = await submit(turn.text, turn.source);
          if (!r.ok) throw new Error(`Turn ${i + 1} did not complete.`);
          setReplay((cur) => (cur ? { ...cur, step: i + 1 } : cur));
          // dwell long enough to read the answer, and for the voice to finish if there is one
          const reading = sleep(Math.min(5200, 900 + turn.text.length * 24));
          await Promise.all([r.spoken, reading]);
        }
        const seen = [...seenTools.current];
        let firstMismatch = -1;
        for (let i = 0; i < Math.max(seen.length, script.expectTools.length); i++) {
          if (seen[i] !== script.expectTools[i]) {
            firstMismatch = i;
            break;
          }
        }
        setReplay((cur) => (cur ? { ...cur, state: "done", seen, firstMismatch } : cur));
      } catch (e) {
        setReplay((cur) => (cur ? { ...cur, state: "failed", error: e instanceof Error ? e.message : String(e) } : cur));
      }
    },
    [connect, resetConversation, submit],
  );

  /** Send an unauthenticated initialize: the 401 demo. The recorded request/response appear in the inspector. */
  const probeUnauthorized = useCallback(async () => {
    const c = new McpHostClient({ url: MCP_URL, getToken: () => null, onTraffic: pushTraffic, clientName: CLIENT_NAME });
    try {
      await c.connect();
    } catch {
      /* the 401 is the point */
    } finally {
      await c.close().catch(() => undefined);
    }
  }, [pushTraffic]);

  const clearTraffic = useCallback(() => setTraffic([]), []);

  return {
    device,
    setDevice,
    link,
    claims,
    beginLink,
    unlink,
    conn,
    session,
    tools,
    traffic,
    clearTraffic,
    mode,
    phase,
    interim,
    lines,
    alexa,
    heard,
    widget,
    error,
    dismissError: () => setError(null),
    retry,
    submit,
    onWidgetAction,
    widgetApi,
    startListening,
    stopListening,
    cancelSpeech: () => speaker.cancel(),
    muted,
    toggleMute,
    voice,
    sttAvailable,
    replay,
    startReplay,
    stopReplay,
    probeUnauthorized,
    setWidgetError: (message: string) => setError({ kind: "widget", message }),
  };
}

export type HostSession = ReturnType<typeof useHostSession>;
