import type { Asset, Home, HomeEvent, Task } from "@hearth/contracts";
import type { MemoryRepo } from "./memoryRepo";

/** Fixed clock for every test: Wednesday 2026-10-21, 10:00 in Austin. */
export const NOW = new Date("2026-10-21T15:00:00.000Z");
export const OKAFOR = "usr_okafor";
export const OTHER_USER = "usr_other";

const HOME: Home = {
  userId: OKAFOR,
  homeId: "home_okafor",
  name: "The Okafor House",
  city: "Austin",
  state: "TX",
  yearBuilt: 2004,
  climateZone: "2A",
  timezone: "America/Chicago",
  baths: 2,
  heatingFuel: "gas",
};

const OTHER_HOME: Home = { ...HOME, userId: OTHER_USER, homeId: "home_other", name: "The Other House" };

const stamp = "2026-01-01T12:00:00.000Z";

function asset(base: Omit<Asset, "homeId" | "photos" | "attributes" | "consumables" | "recallIds" | "createdAt" | "updatedAt"> & Partial<Asset>): Asset {
  return { homeId: "home_okafor", photos: [], attributes: {}, consumables: [], recallIds: [], createdAt: stamp, updatedAt: stamp, ...base };
}

export function assets(mcpBase: string): Asset[] {
  const media = (file: string, alt: string) => ({ url: `${mcpBase}/media/${file}`, alt });
  return [
    asset({
      assetId: "asset_ptrap_kitchen",
      type: "fixture",
      category: "ptrap",
      label: "kitchen sink P-trap",
      installDate: "2019-01-01",
      location: { room: "Kitchen", note: "under the sink" },
      attributes: { trapSize: "1-1/2", joint: "slip", material: "PVC" },
      photos: [media("kitchen-ptrap.svg", "Kitchen sink P-trap")],
    }),
    asset({
      assetId: "asset_disposal_kitchen",
      type: "appliance",
      category: "disposal",
      label: "garbage disposal",
      brand: "InSinkErator",
      model: "Badger 5",
      installDate: "2017-01-01",
      location: { room: "Kitchen", note: "under the sink" },
      photos: [media("disposal-reset.svg", "Underside of the disposal")],
    }),
    asset({
      assetId: "asset_dishwasher_kitchen",
      type: "appliance",
      category: "dishwasher",
      label: "dishwasher",
      brand: "Bosch",
      model: "SHEM63W55N",
      installDate: "2021-01-01",
      location: { room: "Kitchen" },
      recallIds: ["RC-SAMPLE-DW-001"],
    }),
    asset({
      assetId: "asset_fridge_kitchen",
      type: "appliance",
      category: "refrigerator",
      label: "refrigerator",
      brand: "Samsung",
      model: "RF28R7351SR",
      installDate: "2020-01-01",
      location: { room: "Kitchen" },
      consumables: [{ sku: "HR-FRG-UKF8001", label: "Refrigerator water filter UKF8001", intervalDays: 180, lastReplaced: "2026-02-10" }],
    }),
    asset({
      assetId: "asset_furnace_hall",
      type: "hvac",
      category: "furnace",
      label: "furnace",
      brand: "Carrier",
      model: "59SC2",
      installDate: "2016-01-01",
      location: { room: "Hall closet" },
      attributes: { filterSize: "16x25x1", merv: 11, fuel: "gas" },
      consumables: [{ sku: "HR-FLT-16251", label: "Furnace filter 16×25×1 MERV 11", intervalDays: 90, lastReplaced: "2026-07-19" }],
      photos: [media("furnace-filter-slot.svg", "Furnace filter slot")],
    }),
    asset({ assetId: "asset_ac_outside", type: "hvac", category: "ac_condenser", label: "AC condenser", brand: "Carrier", model: "24ACC636", installDate: "2016-01-01", location: { room: "Outside", note: "north side" } }),
    asset({
      assetId: "asset_water_heater_garage",
      type: "appliance",
      category: "water_heater",
      label: "water heater",
      brand: "Rheem",
      model: "XE50M06ST45U1",
      installDate: "2018-01-01",
      location: { room: "Garage" },
      photos: [media("water-heater-label.svg", "Water heater label")],
    }),
    asset({
      assetId: "asset_main_shutoff_garage",
      type: "shutoff",
      category: "main_shutoff",
      label: "main water shut-off",
      location: { room: "Garage", note: "left of the panel" },
      photos: [media("main-shutoff-garage.svg", "Main shut-off")],
    }),
    asset({
      assetId: "asset_sink_shutoff_kitchen",
      type: "shutoff",
      category: "sink_shutoff",
      label: "kitchen sink shut-offs",
      location: { room: "Kitchen", note: "under the sink, back wall" },
      photos: [media("kitchen-sink-shutoffs.svg", "Kitchen shut-offs")],
    }),
    asset({
      assetId: "asset_panel_garage",
      type: "panel",
      category: "electrical_panel",
      label: "electrical panel",
      location: { room: "Garage" },
      photos: [media("electrical-panel.svg", "Electrical panel")],
    }),
    asset({ assetId: "asset_washer_laundry", type: "appliance", category: "washing_machine", label: "washing machine", brand: "LG", model: "WM3600HWA", installDate: "2020-01-01", location: { room: "Laundry" } }),
    asset({
      assetId: "asset_smoke_hall",
      type: "appliance",
      category: "smoke_detector",
      label: "smoke detectors",
      location: { room: "Hallway" },
      consumables: [{ sku: "HR-9V-BATT", label: "9V smoke detector batteries", intervalDays: 365, lastReplaced: "2026-01-05" }],
    }),
  ];
}

const event = (e: Omit<HomeEvent, "homeId" | "photos"> & Partial<HomeEvent>): HomeEvent => ({ homeId: "home_okafor", photos: [], ...e });

export const EVENTS: HomeEvent[] = [
  event({ eventId: "evt_ptrap_washer", ts: "2026-10-15T16:00:00.000Z", type: "repair", assetId: "asset_ptrap_kitchen", summary: "Replaced the P-trap slip washer. It stayed dry after a full run.", cost: 4.64 }),
  event({ eventId: "evt_filter_jul", ts: "2026-07-19T14:00:00.000Z", type: "maintenance", assetId: "asset_furnace_hall", summary: "Changed the furnace filter." }),
  event({ eventId: "evt_disposal_reset", ts: "2025-03-02T18:00:00.000Z", type: "repair", assetId: "asset_disposal_kitchen", summary: "Reset the garbage disposal after a jam." }),
  event({ eventId: "evt_filter_apr", ts: "2026-04-20T14:00:00.000Z", type: "maintenance", assetId: "asset_furnace_hall", summary: "Changed the furnace filter." }),
  event({ eventId: "evt_dw_install", ts: "2021-06-11T15:00:00.000Z", type: "added_asset", assetId: "asset_dishwasher_kitchen", summary: "Dishwasher installed." }),
  event({ eventId: "evt_fridge_filter", ts: "2026-02-10T15:00:00.000Z", type: "maintenance", assetId: "asset_fridge_kitchen", summary: "Replaced the refrigerator water filter." }),
];

export const TASKS: Task[] = [
  { homeId: "home_okafor", taskId: "task_followup_ptrap", dueDate: "2026-10-22", assetId: "asset_ptrap_kitchen", kind: "follow_up", title: "Check the P-trap is still dry", priority: 2, done: false },
  { homeId: "home_okafor", taskId: "task_filter_furnace", dueDate: "2026-10-17", assetId: "asset_furnace_hall", kind: "consumable", title: "Replace furnace filter", priority: 2, reorderSku: "HR-FLT-16251", done: false },
];

export async function seedOkafor(repo: MemoryRepo, mcpBase: string): Promise<void> {
  await repo.putHome(HOME);
  await repo.putHome(OTHER_HOME);
  for (const a of assets(mcpBase)) await repo.putAsset(a);
  for (const e of EVENTS) await repo.putEvent(e);
  for (const t of TASKS) await repo.putTask(t);
}
