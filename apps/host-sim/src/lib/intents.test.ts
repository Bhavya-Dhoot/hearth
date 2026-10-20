import { describe, expect, it } from "vitest";
import { parseVoiceIntent } from "./intents";

describe("parseVoiceIntent", () => {
  it("reads next", () => {
    expect(parseVoiceIntent("Next.")).toEqual({ kind: "next" });
    expect(parseVoiceIntent("okay, go on")).toEqual({ kind: "next" });
  });
  it("reads zero-based selections", () => {
    expect(parseVoiceIntent("the first one")).toEqual({ kind: "select_index", index: 0 });
    expect(parseVoiceIntent("order the third one")).toEqual({ kind: "select_index", index: 2 });
    expect(parseVoiceIntent("number two")).toEqual({ kind: "select_index", index: 1 });
  });
  it("reads yes and no", () => {
    expect(parseVoiceIntent("Yes.")).toEqual({ kind: "confirm" });
    expect(parseVoiceIntent("no, cancel that")).toEqual({ kind: "cancel" });
  });
  it("ignores everything else", () => {
    expect(parseVoiceIntent("There's water under the kitchen sink.")).toBeNull();
  });
});
