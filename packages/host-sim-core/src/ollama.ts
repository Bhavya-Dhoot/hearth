import type { ToolCallResult, ToolDef } from "./client";
import { ALEXA_SYSTEM_PROMPT } from "./prompt";
import type { ConversationState } from "./state";

/** Ollama / OpenAI function-tool shape, derived live from tools/list. */
export interface OllamaTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
}

export function toOllamaTools(tools: ToolDef[]): OllamaTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description ?? t.title ?? t.name, parameters: t.inputSchema },
  }));
}

/** Keys that only matter to the screen; dropping them keeps a small model inside its 8k context. */
const SCREEN_ONLY = new Set(["image", "photos", "photoUrl", "annotation", "qrPayload", "shareUrl", "receiptUrl", "locationChip"]);
const DATA_CAP = 1500;

/**
 * The text a model sees for a tool result: the voice text (PRD 11.1) plus compact structured data. The voice
 * text never carries SKUs or ids, so without the data a model cannot order "the first one" (found in live E2E).
 */
export function resultText(result: ToolCallResult): string {
  const text = result.content
    .map((c) => c.text)
    .filter((t): t is string => typeof t === "string" && t !== "")
    .join("\n");
  if (!result.structuredContent) return text;
  const json = JSON.stringify(result.structuredContent, (k, v: unknown) => (SCREEN_ONLY.has(k) ? undefined : v));
  const data = json.length > DATA_CAP ? `${json.slice(0, DATA_CAP)}...` : json;
  return text !== "" ? `${text}\nDATA: ${data}` : data;
}

/** Conversation as chat messages: ALEXA_SYSTEM_PROMPT first, then each turn; a tool turn is a call plus its result. */
export function stateToChatMessages(state: ConversationState): OllamaChatMessage[] {
  const messages: OllamaChatMessage[] = [{ role: "system", content: ALEXA_SYSTEM_PROMPT }];
  for (const turn of state.turns) {
    if (turn.role === "user") {
      messages.push({ role: "user", content: turn.text });
    } else if (turn.role === "assistant") {
      messages.push({ role: "assistant", content: turn.text });
    } else {
      messages.push({ role: "assistant", content: "", tool_calls: [{ function: { name: turn.name, arguments: turn.args } }] });
      messages.push({ role: "tool", tool_name: turn.name, content: resultText(turn.result) });
    }
  }
  return messages;
}
