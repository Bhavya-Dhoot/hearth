/** Wording for fit reasons and carousel titles. Pure string helpers, no catalogue access. */

/** What the part is, as the customer would say it, and the carousel heading for its role. */
export const ROLE_COPY: Readonly<Record<string, { title: string; noun: string }>> = {
  ptrap_washer: { title: "Slip-joint washers", noun: "P-trap" },
  supply_line: { title: "Braided supply lines", noun: "shut-off valves" },
  disposal_hex_wrench: { title: "Disposal wrenches", noun: "garbage disposal hex socket" },
  toilet_flapper: { title: "Toilet flappers", noun: "toilet flapper" },
  toilet_fill_valve: { title: "Toilet fill valves", noun: "toilet fill valve" },
  furnace_filter: { title: "Furnace filters", noun: "furnace filter slot" },
  fridge_filter: { title: "Refrigerator water filters", noun: "fridge water filter" },
  "9v_battery": { title: "9-volt batteries", noun: "smoke detector battery" },
  thermostat_battery: { title: "Thermostat batteries", noun: "thermostat battery" },
  dishwasher_filter: { title: "Dishwasher filters", noun: "dishwasher filter" },
  plunger: { title: "Toilet plungers", noun: "toilet" },
  disposal_gasket: { title: "Disposal gaskets", noun: "garbage disposal" },
};

/** What to call an attribute when telling the customer to double-check it. */
const ATTRIBUTE_LABEL: Readonly<Record<string, string>> = {
  trapSize: "trap size",
  hexSize: "socket size",
  flapperSize: "flapper size",
  filterSize: "filter size",
  merv: "MERV rating",
  filterModel: "filter model",
  filterStyle: "filter style",
  batteryType: "battery type",
  thermostatBattery: "battery size",
  valveOutlet: "valve outlet",
  mount: "mount type",
  joint: "joint type",
};

const FRACTIONS: Readonly<Record<string, string>> = {
  "1/2": "½",
  "1/4": "¼",
  "3/4": "¾",
  "1/8": "⅛",
  "3/8": "⅜",
  "5/8": "⅝",
  "7/8": "⅞",
};

/** "1-1/2" becomes "1½″"; sizes without a vulgar fraction keep their slash form. */
export function prettyInches(value: string): string {
  const mixed = /^(\d+)-(\d+\/\d+)$/.exec(value);
  if (mixed) return `${mixed[1]}${FRACTIONS[mixed[2]!] ?? ` ${mixed[2]}`}″`;
  return `${FRACTIONS[value] ?? value}″`;
}

/** One attribute value as the customer would hear it: "1½″", "slip-joint", "MERV 11". */
export function describeValue(key: string, value: string | number | boolean): string {
  const text = String(value);
  switch (key) {
    case "trapSize":
    case "hexSize":
    case "flapperSize":
      return prettyInches(text);
    case "joint":
      return `${text}-joint`;
    case "filterSize":
      return text.replaceAll("x", "×");
    case "merv":
      return `MERV ${text}`;
    case "filterStyle":
      return `${text}-style`;
    case "mount":
      return `${text} mount`;
    default:
      return text;
  }
}

export function attributeLabel(key: string): string {
  return ATTRIBUTE_LABEL[key] ?? key;
}

export function roleCopy(partRole: string): { title: string; noun: string } {
  return ROLE_COPY[partRole] ?? { title: partRole.replaceAll("_", " "), noun: partRole.replaceAll("_", " ") };
}

/** "a and b" / "a, b and c". */
export function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
