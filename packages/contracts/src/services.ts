import { z } from "zod";
import type { Asset } from "./db";
import type { FindPartOutput, RepairStepsOutput, SafetyCategory, TriageInput, TriageOutput } from "./tools";
import { SafetyCategory as SafetyCategorySchema } from "./tools";

/**
 * Service APIs between packages. packages/playbooks and packages/parts-catalog implement these
 * exactly; apps/mcp-server consumes them. Pure, synchronous, deterministic, in-memory.
 */

/* ------------------------------------------------------------ playbooks (Appendix D) */

export const PlaybookStep = z.object({
  instruction: z.string(),
  detail: z.string().optional(),
  caution: z.string().optional(),
  tools: z.array(z.string()).optional(),
  /** Asset category whose photo to show, e.g. "sink_shutoff", "ptrap", "main_shutoff". */
  photoOf: z.string().optional(),
  /** Generic illustration when the home lacks that asset/photo (GENERIC_MEDIA key). */
  fallbackImage: z.string().optional(),
  /** Text if the home lacks the asset: "Say 'add my shut-off valve' and I'll remember it." */
  addHint: z.string().optional(),
  /** Part role this step needs; asset is resolved by category. */
  partRole: z.string().optional(),
  partAssetCategory: z.string().optional(),
  canSkip: z.boolean().default(false),
});
export type PlaybookStep = z.infer<typeof PlaybookStep>;

export const PlaybookQuestion = z.object({
  id: z.string(),
  text: z.string(),
  options: z.array(z.string()).optional(),
  /** answer keyword (lower-case, synonyms allowed) -> playbook id, "escalate:<reason>" or "hardstop:<category>" */
  routes: z.record(z.string(), z.string()),
});
export type PlaybookQuestion = z.infer<typeof PlaybookQuestion>;

export const Playbook = z.object({
  id: z.string(),
  title: z.string(),
  symptoms: z.array(z.string()),
  /** Asset category this playbook is about (for suspectedAsset + pro brief). */
  assetCategory: z.string(),
  trade: z.enum(["plumber", "electrician", "hvac", "appliance", "gas_utility", "general"]),
  questions: z.array(PlaybookQuestion).max(2),
  steps: z.array(PlaybookStep),
  partRoles: z.array(z.string()),
  hardStops: z.array(z.object({ category: SafetyCategorySchema, keywords: z.array(z.string()) })),
  escalateIf: z.array(z.object({ keywords: z.array(z.string()), reason: z.string() })),
  estimatedMinutes: z.number().int(),
  tools: z.array(z.string()),
  /** Default days until the follow-up check after completion (e.g. "check it's still dry"). */
  followUpDays: z.number().int().optional(),
  followUpTitle: z.string().optional(),
});
export type Playbook = z.infer<typeof Playbook>;

export interface HardStopResult {
  hardStop: boolean;
  category?: SafetyCategory;
  /** Verbatim line the orchestrator must read. */
  message?: string;
}

export interface StepContext {
  assets: Asset[];
  /** e.g. http://localhost:4200 - used to build media URLs. */
  mcpBase: string;
}

/** Implemented by @hearth/playbooks. */
export interface PlaybooksApi {
  listPlaybooks(): Playbook[];
  getPlaybook(id: string): Playbook | undefined;
  /** Deterministic triage: synonyms table -> candidates -> <=2 questions -> leaf. Safety checked first. */
  triage(input: TriageInput, ctx: { assets: Asset[] }): TriageOutput;
  /** Throws RangeError if stepIndex is out of range, Error("unknown_playbook") if id unknown. */
  getRepairStep(issueId: string, stepIndex: number, ctx: StepContext): RepairStepsOutput;
  /** Deterministic hard-stop rules over free text (gas, panel work, structural, flooding, sewage, minors). */
  checkHardStop(text: string): HardStopResult;
}

/* ------------------------------------------------------------ parts catalogue */

export const CatalogItem = z.object({
  sku: z.string(),
  name: z.string(),
  partRole: z.string(),
  price: z.number(),
  image: z.string(),          // PART_MEDIA file name; server turns into absolute URL
  /** Attribute constraints for exact fit, e.g. { trapSize: "1-1/2", joint: "slip" } */
  fits: z.record(z.string(), z.union([z.string(), z.number()])),
  /** Looser constraints that still make it COMPATIBLE. */
  compatible: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  brand: z.string(),
  shipDays: z.number().int(),
});
export type CatalogItem = z.infer<typeof CatalogItem>;

export const RecallRecord = z.object({
  recallId: z.string(),
  brand: z.string(),
  modelPattern: z.string(),   // regex source
  title: z.string(),
  hazard: z.string(),
  remedy: z.array(z.string()),
  isSample: z.literal(true),
});
export type RecallRecord = z.infer<typeof RecallRecord>;

/** Implemented by @hearth/parts-catalog. */
export interface PartsApi {
  listCatalog(): CatalogItem[];
  getSku(sku: string): CatalogItem | undefined;
  /**
   * Exact-fit first, then compatible; 3..5 items; fitReason names the asset attribute
   * and install year ("fits your 1½″ slip-joint P-trap, installed 2019").
   * Throws Error("no_parts") if nothing matches the role.
   */
  findExactParts(q: { partRole: string; asset?: Asset }, ctx: { mcpBase: string; now: Date }): FindPartOutput;
  listRecalls(): RecallRecord[];
}
