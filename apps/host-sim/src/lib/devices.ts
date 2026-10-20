import { DEVICE_CONTEXTS, type DeviceClass, type HostContext } from "@hearth/contracts";

export const DEVICE_ORDER: DeviceClass[] = ["echo-show-8", "echo-show-15", "phone", "voice-only"];

/**
 * Geometry of each simulated device, in the device's own CSS pixels. Everything on a device is drawn at
 * this size and the whole frame is scaled to fit the stage, so a Show 8 is genuinely 1280x800 inside.
 */
export type DeviceSpec = {
  label: string;
  short: string;
  /** the display, in device px */
  screen: { w: number; h: number };
  /** bezel thickness around the display, in device px */
  bezel: number;
  /** extra height below the bezel (stand, feet), device px */
  foot: number;
  /** space reserved for the widget iframe, device px */
  widget: { w: number; h: number };
  theme: "dark" | "light";
};

export const DEVICES: Record<DeviceClass, DeviceSpec> = {
  "echo-show-8": {
    label: "Echo Show 8",
    short: "Show 8",
    screen: { w: 1280, h: 800 },
    bezel: 44,
    foot: 36,
    widget: { w: 1280, h: 680 },
    theme: "dark",
  },
  "echo-show-15": {
    label: "Echo Show 15",
    short: "Show 15",
    screen: { w: 1920, h: 1080 },
    bezel: 14,
    foot: 0,
    widget: { w: 1184, h: 952 },
    theme: "dark",
  },
  phone: {
    label: "Phone",
    short: "Phone",
    screen: { w: 390, h: 844 },
    bezel: 12,
    foot: 0,
    widget: { w: 390, h: 520 },
    theme: "light",
  },
  "voice-only": {
    label: "Voice only",
    short: "Voice",
    screen: { w: 0, h: 0 },
    bezel: 0,
    foot: 0,
    widget: { w: 0, h: 0 },
    theme: "dark",
  },
};

/** The HostContext handed to a widget: the frozen reference context, with the real iframe viewport for this stage. */
export function hostContextFor(device: DeviceClass): HostContext {
  const base = DEVICE_CONTEXTS[device];
  const spec = DEVICES[device];
  if (!base.deviceCapabilities.screen) return base;
  return { ...base, maxWidth: spec.widget.w, maxHeight: spec.widget.h };
}

/** Where the replay/launcher puts people who have no preference: phones get the phone. */
export function defaultDeviceFor(viewportWidth: number): DeviceClass {
  return viewportWidth < 640 ? "phone" : "echo-show-8";
}

export function isDeviceClass(v: string | null | undefined): v is DeviceClass {
  return !!v && (DEVICE_ORDER as string[]).includes(v);
}
