import { GENERIC_MEDIA, HOME_MEDIA, mediaUrl, type HardStopResult, type Playbook, type PlaybooksApi, type RepairStepsOutput, type TriageOutput } from "@hearth/contracts";

const PTRAP: Playbook = {
  id: "leak-under-sink-ptrap",
  title: "Leak under the sink: P-trap",
  symptoms: ["water under the sink", "dripping pipe"],
  assetCategory: "ptrap",
  trade: "plumber",
  questions: [],
  steps: [
    { instruction: "Turn the cold shut-off valve clockwise until it stops.", photoOf: "sink_shutoff", fallbackImage: "generic-shutoff.svg", addHint: "Say 'add my shut-off valve' and I'll remember it.", canSkip: false },
    { instruction: "Put a bucket under the trap and loosen the slip nuts by hand.", caution: "Water left in the trap will spill.", tools: ["bucket"], canSkip: false },
    { instruction: "Replace the washer, then reseat the trap and tighten the nuts.", partRole: "ptrap_washer", partAssetCategory: "ptrap", canSkip: false },
  ],
  partRoles: ["ptrap_washer"],
  hardStops: [],
  escalateIf: [],
  estimatedMinutes: 20,
  tools: ["bucket"],
  followUpDays: 7,
  followUpTitle: "Check the P-trap is still dry",
};

const DISPOSAL: Playbook = {
  id: "disposal-leak-body",
  title: "Leak from the disposal body",
  symptoms: ["disposal leaking"],
  assetCategory: "disposal",
  trade: "plumber",
  questions: [],
  steps: [{ instruction: "Turn off the disposal and the water, then call a plumber.", canSkip: false }],
  partRoles: [],
  hardStops: [],
  escalateIf: [{ keywords: ["disposal"], reason: "The seal inside the disposal has failed." }],
  estimatedMinutes: 5,
  tools: [],
};

const PLAYBOOKS = [PTRAP, DISPOSAL];

const hardStop = (text: string): HardStopResult =>
  /gas|rotten egg/i.test(text)
    ? { hardStop: true, category: "gas", message: "Stop. If you smell gas, leave the house and call your gas company from outside. I won't give steps for this." }
    : { hardStop: false };

/** A scripted stand-in for @hearth/playbooks that honours the PlaybooksApi contract. */
export const fakePlaybooks: PlaybooksApi = {
  listPlaybooks: () => PLAYBOOKS,
  getPlaybook: (id) => PLAYBOOKS.find((p) => p.id === id),
  checkHardStop: hardStop,

  triage(input, ctx): TriageOutput {
    const stop = hardStop(input.symptomText);
    if (stop.hardStop) {
      return { issueId: null, confidence: 1, clarifyingQuestions: [], safety: { hardStop: true, ...(stop.message ? { message: stop.message } : {}), ...(stop.category ? { category: stop.category } : {}) }, escalate: false, trade: "gas_utility" };
    }
    const text = input.symptomText.toLowerCase();
    if (text.includes("disposal")) {
      const asset = ctx.assets.find((a) => a.category === "disposal");
      return {
        issueId: DISPOSAL.id,
        issueTitle: DISPOSAL.title,
        confidence: 0.9,
        clarifyingQuestions: [],
        safety: { hardStop: false },
        escalate: true,
        escalateReason: "The seal inside the disposal has failed.",
        trade: "plumber",
        ...(asset ? { suspectedAsset: { assetId: asset.assetId, label: asset.label } } : {}),
      };
    }
    if (text.includes("sink") || text.includes("under")) {
      if (!input.answers?.source) {
        return {
          issueId: null,
          confidence: 0.4,
          clarifyingQuestions: [{ id: "source", text: "Is it dripping from the pipes, or pooling from the dishwasher side?", options: ["pipes", "dishwasher side"] }],
          safety: { hardStop: false },
          escalate: false,
        };
      }
      const asset = ctx.assets.find((a) => a.category === "ptrap");
      return {
        issueId: PTRAP.id,
        issueTitle: PTRAP.title,
        confidence: 0.86,
        clarifyingQuestions: [],
        safety: { hardStop: false },
        escalate: false,
        ...(asset ? { suspectedAsset: { assetId: asset.assetId, label: asset.label } } : {}),
      };
    }
    return { issueId: null, confidence: 0.1, clarifyingQuestions: [], safety: { hardStop: false }, escalate: false };
  },

  getRepairStep(issueId, stepIndex, ctx): RepairStepsOutput {
    const playbook = PLAYBOOKS.find((p) => p.id === issueId);
    if (!playbook) throw new Error("unknown_playbook");
    const step = playbook.steps[stepIndex];
    if (!step) throw new RangeError(`step ${stepIndex} out of range`);
    const shutoff = ctx.assets.find((a) => a.category === "sink_shutoff");
    const part = step.partRole ? ctx.assets.find((a) => a.category === step.partAssetCategory) : undefined;
    const users = step.photoOf === "sink_shutoff" && shutoff;
    const file = "kitchen-sink-shutoffs.svg" as const;
    const generic = "generic-shutoff.svg" as const;
    return {
      issueId: playbook.id,
      issueTitle: playbook.title,
      stepIndex,
      stepCount: playbook.steps.length,
      instruction: step.instruction,
      ...(step.photoOf
        ? {
            image: users
              ? { url: mediaUrl(ctx.mcpBase, file), alt: HOME_MEDIA[file].alt, isUsersPhoto: true, annotation: HOME_MEDIA[file].annotation }
              : { url: mediaUrl(ctx.mcpBase, generic), alt: GENERIC_MEDIA[generic], isUsersPhoto: false },
          }
        : {}),
      ...(users ? { locationChip: "YOUR VALVE · KITCHEN" } : {}),
      ...(step.caution ? { caution: step.caution } : {}),
      ...(step.tools ? { tools: step.tools } : {}),
      ...(step.partRole && part ? { partNeeded: { partRole: step.partRole, assetId: part.assetId } } : {}),
      ...(step.addHint && !shutoff ? { addHint: step.addHint } : {}),
      primaryAction: stepIndex === playbook.steps.length - 1 ? "done" : "next",
      canSkip: step.canSkip,
      isLast: stepIndex === playbook.steps.length - 1,
    };
  },
};
