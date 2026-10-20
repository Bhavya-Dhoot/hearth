import { z } from "zod";
import { WidgetAction } from "./widgets";

/**
 * C4 - Host bridge protocol (postMessage between host and sandboxed widget iframe).
 * Re-exported by packages/host-sim-core/src/bridge.ts.
 *
 * Sequence (PRD 9.1):
 *   widget -> host  { type: "ui/ready" }
 *   host   -> widget { type: "ui/hostContext", payload }
 *   host   -> widget { type: "ui/render", props }
 *   widget -> host  { type: "ui/resize", height }          (after every layout)
 *   widget -> host  { type: "ui/action", action }          (user tap)
 *   host   -> widget { type: "ui/voice-intent", intent }   (voice "next"/"the first one" mirrored on screen)
 * hostContext may be re-sent at any time (theme / size change); the widget re-lays-out and re-posts resize.
 */

export const DeviceClass = z.enum(["echo-show-8", "echo-show-15", "phone", "voice-only"]);
export type DeviceClass = z.infer<typeof DeviceClass>;

export const HostContext = z.object({
  deviceClass: DeviceClass,
  maxWidth: z.number(),
  maxHeight: z.number(),
  isMobile: z.boolean(),
  platform: z.literal("alexa-plus-host-sim"),
  displayMode: z.enum(["fullscreen", "tile", "inline"]),
  safeAreaInsets: z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() }),
  deviceCapabilities: z.object({ touch: z.boolean(), camera: z.boolean(), voice: z.boolean(), screen: z.boolean() }),
  theme: z.enum(["dark", "light"]),
});
export type HostContext = z.infer<typeof HostContext>;

/** Reference contexts for the four simulated devices (PRD 9.1, 10.6). */
export const DEVICE_CONTEXTS: Record<DeviceClass, HostContext> = {
  "echo-show-8": {
    deviceClass: "echo-show-8", maxWidth: 1280, maxHeight: 800, isMobile: false, platform: "alexa-plus-host-sim",
    displayMode: "fullscreen", safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    deviceCapabilities: { touch: true, camera: true, voice: true, screen: true }, theme: "dark",
  },
  "echo-show-15": {
    deviceClass: "echo-show-15", maxWidth: 1920, maxHeight: 1080, isMobile: false, platform: "alexa-plus-host-sim",
    displayMode: "tile", safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    deviceCapabilities: { touch: true, camera: true, voice: true, screen: true }, theme: "dark",
  },
  phone: {
    deviceClass: "phone", maxWidth: 390, maxHeight: 844, isMobile: true, platform: "alexa-plus-host-sim",
    displayMode: "inline", safeAreaInsets: { top: 47, right: 0, bottom: 34, left: 0 },
    deviceCapabilities: { touch: true, camera: true, voice: true, screen: true }, theme: "light",
  },
  "voice-only": {
    deviceClass: "voice-only", maxWidth: 0, maxHeight: 0, isMobile: false, platform: "alexa-plus-host-sim",
    displayMode: "inline", safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    deviceCapabilities: { touch: false, camera: false, voice: true, screen: false }, theme: "dark",
  },
};

export const VoiceIntent = z.object({
  kind: z.enum(["next", "select_index", "confirm", "cancel", "listening", "idle"]),
  index: z.number().int().optional(),
});
export type VoiceIntent = z.infer<typeof VoiceIntent>;

export const HostToWidget = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ui/hostContext"), payload: HostContext }),
  z.object({ type: z.literal("ui/render"), props: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("ui/voice-intent"), intent: VoiceIntent }),
]);
export type HostToWidget = z.infer<typeof HostToWidget>;

export const WidgetToHost = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ui/ready") }),
  z.object({ type: z.literal("ui/resize"), height: z.number() }),
  z.object({ type: z.literal("ui/action"), action: WidgetAction }),
  z.object({ type: z.literal("ui/error"), message: z.string() }),
]);
export type WidgetToHost = z.infer<typeof WidgetToHost>;
