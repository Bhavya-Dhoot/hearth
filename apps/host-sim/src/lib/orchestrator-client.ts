"use client";

import type { ConversationState, Orchestrator, OrchestratorDecision, ToolDef } from "@hearth/host-sim-core";

export type OrchestratorMode = "bedrock" | "ollama" | "rules";

export type ModeReport = {
  mode: OrchestratorMode;
  model?: string;
  /** the model runs on this machine (Ollama on loopback) */
  local?: boolean;
  /** Ollama reported the model resident in VRAM; undefined until a chat has run */
  gpu?: boolean;
  /** why a better provider did not answer this step */
  fallbackReason?: string;
  note?: string;
};

/** "ollama · qwen3:4b · local GPU", "bedrock · us.anthropic...", "rules" */
export function describeMode(m: ModeReport | null): string {
  if (!m) return "checking";
  const parts: string[] = [m.mode];
  if (m.model) parts.push(m.model);
  if (m.mode === "ollama") parts.push(m.local ? (m.gpu ? "local GPU" : "local") : "remote");
  return parts.join(" · ");
}

/** Ask the server which orchestrator would run. Does not call the model. */
export async function fetchMode(prefer?: string): Promise<ModeReport> {
  const res = await fetch(`/api/orchestrate${prefer ? `?prefer=${encodeURIComponent(prefer)}` : ""}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`/api/orchestrate answered ${res.status}`);
  return (await res.json()) as ModeReport;
}

/**
 * The browser-side face of the orchestrator contract. step() hands the conversation and the live tool list to
 * /api/orchestrate, which runs Bedrock Converse, a local Ollama model, or the rules orchestrator, and says which.
 */
export function createRemoteOrchestrator(onReport: (r: ModeReport) => void, getPrefer: () => string | undefined): Orchestrator {
  let mode: OrchestratorMode = "rules";
  return {
    get mode() {
      return mode;
    },
    async step(state: ConversationState, tools: ToolDef[]): Promise<OrchestratorDecision> {
      const res = await fetch("/api/orchestrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state, tools, prefer: getPrefer() }),
      });
      const json = (await res.json().catch(() => null)) as
        | (ModeReport & { decision?: OrchestratorDecision; memory?: ConversationState["memory"]; error?: string })
        | null;
      if (!res.ok || !json?.decision) {
        throw new Error(json?.error ?? `The orchestrator route answered ${res.status}.`);
      }
      mode = json.mode;
      // Rules runs server-side and updates its memory there; carry it into this turn's working state.
      if (json.memory) state.memory = json.memory;
      const { decision: _decision, memory: _memory, ...report } = json;
      onReport(report);
      return json.decision;
    },
  } as Orchestrator;
}
