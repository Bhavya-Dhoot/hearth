import { HOME_MEDIA, PART_MEDIA, mediaUrl, type WidgetName, type WidgetPropsOf } from "@hearth/contracts";

/** Where seed-house illustrations are served from (apps/mcp-server, PRD ports). */
const MCP_BASE = "http://localhost:4200";
const home = (file: keyof typeof HOME_MEDIA) => mediaUrl(MCP_BASE, file);
const part = (file: (typeof PART_MEDIA)[number]) => mediaUrl(MCP_BASE, file);

const stepCard: WidgetPropsOf<"step-card"> = {
  issueId: "leak-under-sink-ptrap",
  issueTitle: "Leak under the kitchen sink",
  stepIndex: 1,
  stepCount: 6,
  instruction: "Turn both shut-off valves clockwise until they stop.",
  detail: "The cold valve is on the right. Keep turning past the first resistance, then open the faucet to bleed off the pressure.",
  image: {
    url: home("kitchen-sink-shutoffs.svg"),
    alt: HOME_MEDIA["kitchen-sink-shutoffs.svg"].alt,
    isUsersPhoto: true,
    annotation: HOME_MEDIA["kitchen-sink-shutoffs.svg"].annotation,
  },
  locationChip: "YOUR VALVE · KITCHEN",
  caution: "Hand pressure only. If a valve will not turn, stop and shut off the main in your garage instead.",
  tools: ["Bucket", "Old towel"],
  primaryAction: "next",
  canSkip: false,
  isLast: false,
};

/** A second state: the last step, with a skip-less finish and a hint to teach Hearth a missing asset. */
const stepCardFinal: WidgetPropsOf<"step-card"> = {
  issueId: "leak-under-sink-ptrap",
  issueTitle: "Leak under the kitchen sink",
  stepIndex: 5,
  stepCount: 6,
  instruction: "Open the valves, run the tap, and check the trap is dry.",
  detail: "Wipe the joints with a paper towel. If the towel stays dry after two minutes of running water, you are finished.",
  image: {
    url: home("kitchen-ptrap.svg"),
    alt: HOME_MEDIA["kitchen-ptrap.svg"].alt,
    isUsersPhoto: false,
    annotation: HOME_MEDIA["kitchen-ptrap.svg"].annotation,
  },
  tools: ["Paper towel"],
  addHint: "Say: add my water heater to Hearth.",
  primaryAction: "done",
  canSkip: false,
  isLast: true,
};

const partsCarousel: WidgetPropsOf<"parts-carousel"> = {
  title: "Slip-joint washers for your kitchen trap",
  partRole: "ptrap_washer",
  assetLabel: "Kitchen sink P-trap, 1-1/2 inch slip-joint",
  items: [
    {
      sku: "HR-PT-150-WSH",
      name: "Slip-joint washer, 1-1/2 in, 4 pack",
      price: 4.29,
      currency: "USD",
      image: part("part-slip-washer.svg"),
      fitReason: "Fits your 1-1/2 inch slip-joint trap, installed in 2019.",
      confidence: 0.98,
      etaDate: "2026-10-23",
      badge: "EXACT FIT",
    },
    {
      sku: "HR-PT-150-NYL",
      name: "Tapered nylon washer, 1-1/2 in, 6 pack",
      price: 5.49,
      currency: "USD",
      image: part("part-slip-washer.svg"),
      fitReason: "Same 1-1/2 inch size. Harder wearing, but stiffer to seat by hand.",
      confidence: 0.86,
      etaDate: "2026-10-23",
      badge: "COMPATIBLE",
    },
    {
      sku: "HR-PT-150-KIT",
      name: "Trap rebuild kit, nuts and washers, 1-1/2 in",
      price: 11.79,
      currency: "USD",
      image: part("part-slip-washer.svg"),
      fitReason: "Replaces both slip nuts as well. Useful if the threads are cracked.",
      confidence: 0.81,
      etaDate: "2026-10-24",
      badge: "COMPATIBLE",
    },
  ],
  selectedIndex: 0,
};

const checkout: WidgetPropsOf<"checkout-card"> = {
  state: "checkout",
  sessionId: "cs_8f3a21",
  lineItems: [{ sku: "HR-PT-150-WSH", name: "Slip-joint washer, 1-1/2 in, 4 pack", qty: 1, unitPrice: 4.29 }],
  totals: { subtotal: 4.29, tax: 0.35, shipping: 0, total: 4.64, currency: "USD" },
  etaDate: "2026-10-23",
  paymentDisplay: "Visa ending 4417",
  commitmentText:
    "I'll order one pack of slip-joint washers for 4 dollars and 64 cents, free shipping, arriving Friday, October 23, on your Visa ending 4417.",
};

const confirmation: WidgetPropsOf<"checkout-card"> = {
  state: "confirmation",
  orderId: "ord_7c41e9",
  orderNumber: "HRT-48127",
  summary: "1 pack of slip-joint washers, 1-1/2 in (HR-PT-150-WSH)",
  etaDate: "2026-10-23",
  receiptUrl: "http://localhost:4200/receipts/ord_7c41e9",
  chargedAmount: 4.64,
  supportEmail: "support@hearth.example",
  emailStatus: "written_to_outbox",
  paymentMode: "simulated",
  nextSuggestion: "When the washers arrive, I'll remind you to check that the trap is still dry.",
};

const weekend: WidgetPropsOf<"weekend-list"> = {
  weekendLabel: "Sat Oct 24 and Sun Oct 25",
  tasks: [
    {
      id: "task_furnace_filter",
      title: "Replace the furnace filter",
      why: "Your 16x25x1 filter is 94 days old. The label says 90.",
      dueState: "overdue",
      minutes: 10,
      assetName: "Carrier furnace",
      action: { type: "reorder", sku: "HR-FF-16251-M11" },
    },
    {
      id: "task_dishwasher_recall",
      title: "Read the dishwasher recall notice",
      why: "Your Bosch SHEM63W55N matches a sample recall. The remedy is free.",
      dueState: "due",
      minutes: 15,
      assetName: "Bosch dishwasher",
    },
    {
      id: "task_trap_dry",
      title: "Check the kitchen trap is still dry",
      why: "You replaced the washer 6 days ago. Run the tap and wipe the joints.",
      dueState: "soon",
      minutes: 5,
      assetName: "Kitchen sink trap",
    },
    {
      id: "task_smoke_batteries",
      title: "Swap the smoke detector batteries",
      why: "The last change was 11 months ago. Yearly is the rule.",
      dueState: "soon",
      minutes: 20,
      assetName: "Smoke detectors",
      action: { type: "reorder", sku: "HR-9V-4PK" },
    },
    {
      id: "task_gutters",
      title: "Clear the gutters",
      why: "Leaves are down in Austin. Clear them before the next hard rain.",
      dueState: "seasonal",
      minutes: 45,
      assetName: "Gutters",
    },
  ],
};

const proBrief: WidgetPropsOf<"pro-brief-card"> = {
  briefId: "pb_5c19e2",
  headline: "Garbage disposal leaking from the unit body",
  trade: "plumber",
  asset: { brand: "InSinkErator", model: "Badger 5", ageYears: 9 },
  symptom: "Water pools under the disposal itself while it runs. The pipes and the trap above it are dry.",
  timeline: [
    { ts: "Mon Oct 19, 7:40 AM", text: "Damp cabinet floor under the sink." },
    { ts: "Mon Oct 19, 6:15 PM", text: "Replaced the trap washer. Trap stayed dry." },
    { ts: "Tue Oct 20, 8:05 AM", text: "Leak returned. Source is the disposal housing seam." },
  ],
  attempted: ["Re-seated the P-trap slip joints", "Replaced the 1-1/2 inch slip-joint washer", "Ran the disposal over a dry bucket to find the source"],
  accessNotes: "Under the kitchen sink, left cabinet door. Shut-off valves on the back wall. Main water shut-off is in the garage, left of the electrical panel.",
  photos: [home("disposal-reset.svg"), home("kitchen-sink-shutoffs.svg"), home("main-shutoff-garage.svg")],
  shareUrl: "http://localhost:4200/brief/pb_5c19e2",
  qrPayload: "http://localhost:4200/brief/pb_5c19e2",
  handoffLine: "This one is past a DIY fix. Want me to find a plumber?",
};

const homeCard: WidgetPropsOf<"home-card"> = {
  homeId: "home_okafor",
  name: "The Okafor House",
  city: "Austin",
  state: "TX",
  yearBuilt: 2004,
  assetCount: 12,
  inventoryByType: { appliance: 5, hvac: 2, shutoff: 2, fixture: 1, panel: 1, consumable: 1 },
  keyLocations: [
    { assetId: "asset_main_shutoff", label: "Main water shut-off", location: "Garage, left of the panel", photoUrl: home("main-shutoff-garage.svg") },
    { assetId: "asset_sink_shutoffs", label: "Kitchen sink shut-offs", location: "Under the kitchen sink, back wall", photoUrl: home("kitchen-sink-shutoffs.svg") },
    { assetId: "asset_panel", label: "Electrical panel", location: "Garage", photoUrl: home("electrical-panel.svg") },
    { assetId: "asset_water_heater", label: "Rheem 50 gal water heater", location: "Garage", photoUrl: home("water-heater-label.svg") },
  ],
  recentEvents: [
    { ts: "2026-10-21T08:12:00-05:00", type: "added_asset", summary: "Added the Rheem water heater label and serial." },
    { ts: "2026-10-15T18:40:00-05:00", type: "repair", summary: "Replaced the kitchen trap slip-joint washer." },
    { ts: "2026-07-19T10:05:00-05:00", type: "maintenance", summary: "Changed the furnace filter, 16x25x1 MERV 11." },
  ],
  openIssues: [{ issueRecordId: "iss_disposal_seam", title: "Disposal leaking from the body", status: "escalated" }],
  highlight: { assetId: "asset_water_heater", label: "Rheem 50 gal water heater", created: true },
};

const timeline: WidgetPropsOf<"timeline-list"> = {
  title: "Everything we know about the disposal",
  events: [
    { eventId: "evt_0612", ts: "2026-10-20T08:05:00-05:00", type: "escalation", summary: "Leak traced to the disposal housing seam. Sent to a plumber.", assetName: "InSinkErator Badger 5" },
    { eventId: "evt_0611", ts: "2026-10-15T18:40:00-05:00", type: "repair", summary: "Replaced the kitchen trap slip-joint washer. Trap stayed dry.", assetName: "Kitchen sink trap", cost: 4.64 },
    { eventId: "evt_0610", ts: "2026-10-15T18:22:00-05:00", type: "order", summary: "Ordered HR-PT-150-WSH, slip-joint washers, 4 pack.", assetName: "Kitchen sink trap", cost: 4.64 },
    { eventId: "evt_0377", ts: "2025-03-08T16:30:00-06:00", type: "repair", summary: "Disposal jammed. Cleared it with the hex key and pressed reset.", assetName: "InSinkErator Badger 5" },
    { eventId: "evt_0102", ts: "2021-06-14T11:00:00-05:00", type: "added_asset", summary: "Dishwasher installed next to the disposal.", assetName: "Bosch dishwasher", cost: 189 },
  ],
};

const recalls: WidgetPropsOf<"recall-card"> = {
  checkedCount: 12,
  datasetLabel: "Sample recall dataset for the Hearth demo, not live CPSC data",
  flagged: [
    {
      assetId: "asset_dishwasher",
      assetName: "Dishwasher",
      brand: "Bosch",
      model: "SHEM63W55N",
      recallId: "SAMPLE-2026-0417",
      title: "Heating element can overheat during the dry cycle",
      hazard: "A failed thermal fuse can leave the heater on, which may scorch the tub and nearby cabinets.",
      remedy: [
        "Stop using the heated dry cycle.",
        "Find the serial plate inside the door frame and note the E-number.",
        "Request the free thermal fuse kit from the maker, then book the free visit.",
      ],
      isSample: true,
    },
  ],
};

const recallsEmpty: WidgetPropsOf<"recall-card"> = {
  checkedCount: 12,
  datasetLabel: "Sample recall dataset for the Hearth demo, not live CPSC data",
  flagged: [],
};

/** One valid props object per widget (the checkout card shows the checkout state). */
export const WIDGET_SAMPLES: { [W in WidgetName]: WidgetPropsOf<W> } = {
  "step-card": stepCard,
  "parts-carousel": partsCarousel,
  "checkout-card": checkout,
  "weekend-list": weekend,
  "pro-brief-card": proBrief,
  "home-card": homeCard,
  "timeline-list": timeline,
  "recall-card": recalls,
};

/** Extra states for widgets that render more than one view. */
export const WIDGET_SAMPLES_EXTRA = {
  "checkout-card": { checkout, confirmation },
  "step-card": { final: stepCardFinal },
  "recall-card": { empty: recallsEmpty },
} as const;
