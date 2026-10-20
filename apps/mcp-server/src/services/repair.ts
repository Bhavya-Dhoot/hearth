import {
  FindPartOutput as FindPartOutputSchema,
  RepairStepsOutput as RepairStepsOutputSchema,
  TriageOutput as TriageOutputSchema,
  type FindPartInput,
  type FindPartOutput,
  type RepairStepsInput,
  type RepairStepsOutput,
  type TriageInput,
  type TriageOutput,
} from "@hearth/contracts";
import { fail } from "../errors";
import { type Core, type Ctx, assetByCategory } from "./core";
import { capitalize, money, plain } from "./format";

/* ------------------------------------------------------------------ triage_issue */

export async function triageIssue(core: Core, ctx: Ctx, input: TriageInput): Promise<{ output: TriageOutput; text: string }> {
  const assets = await core.repo.listAssets(ctx.home.homeId);
  const raw = core.playbooks.triage(input, { assets });
  const parsed = TriageOutputSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`triage output violated contract: ${parsed.error.message}`);
  const output = parsed.data;
  return { output, text: triageSpeech(output) };
}

function triageSpeech(t: TriageOutput): string {
  if (t.safety.hardStop) return t.safety.message ?? "This is not safe to handle yourself. Please stop and call a professional.";
  const question = t.clarifyingQuestions[0];
  if (question) return question.text;
  if (t.escalate) {
    const why = t.escalateReason ? ` ${t.escalateReason}` : "";
    return `This one is best left to a pro.${why} I can put together a brief for them.`;
  }
  if (t.issueId) {
    const title = t.issueTitle ? t.issueTitle.toLowerCase() : "a repair I know";
    const asset = t.suspectedAsset ? ` on your ${t.suspectedAsset.label}` : "";
    return `That sounds like ${title}${asset}. Want me to walk you through it?`;
  }
  return "I'm not sure what that is yet. Can you tell me a bit more about what you see or hear?";
}

/* ------------------------------------------------------------------ get_repair_steps */

export async function getRepairSteps(core: Core, ctx: Ctx, input: RepairStepsInput): Promise<{ output: RepairStepsOutput; text: string }> {
  const assets = await core.repo.listAssets(ctx.home.homeId);
  let raw: RepairStepsOutput;
  try {
    raw = core.playbooks.getRepairStep(input.issueId, input.stepIndex, { assets, mcpBase: core.mcpBase });
  } catch (err) {
    if (err instanceof RangeError) throw fail("invalid_input", "That was the last step. If it's all done, tell me and I'll log it.");
    if (err instanceof Error && err.message === "unknown_playbook") throw fail("not_found", "I don't have a repair guide for that. Want me to put together a brief for a pro instead?");
    throw err;
  }
  const parsed = RepairStepsOutputSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`repair step output violated contract: ${parsed.error.message}`);
  const output = parsed.data;
  return { output, text: stepSpeech(output) };
}

function stepSpeech(s: RepairStepsOutput): string {
  const parts = [`Step ${s.stepIndex + 1} of ${s.stepCount}. ${s.instruction}`];
  if (s.caution) parts.push(`Careful: ${s.caution}`);
  if (s.addHint) parts.push(s.addHint);
  parts.push(s.isLast ? "That's the last step. Say done when you're finished." : "Say next when you're ready.");
  return plain(parts.join(" "));
}

/* ------------------------------------------------------------------ find_exact_part */

export async function findExactPart(core: Core, ctx: Ctx, input: FindPartInput): Promise<{ output: FindPartOutput; text: string }> {
  const assets = await core.repo.listAssets(ctx.home.homeId);

  let asset = input.assetId ? assets.find((a) => a.assetId === input.assetId) : undefined;
  if (input.assetId && !asset) throw fail("not_found", "I couldn't find that item in your home. Want me to show the closest matches?");

  if (!asset && input.issueId) {
    const playbook = core.playbooks.getPlaybook(input.issueId);
    const step = playbook?.steps.find((s) => s.partRole === input.partRole && s.partAssetCategory);
    asset = assetByCategory(assets, step?.partAssetCategory);
  }

  let raw: FindPartOutput;
  try {
    raw = core.parts.findExactParts({ partRole: input.partRole, ...(asset ? { asset } : {}) }, { mcpBase: core.mcpBase, now: core.now() });
  } catch (err) {
    if (err instanceof Error && err.message === "no_parts") throw fail("not_found", "I couldn't find that part. Want me to show the closest matches?");
    throw err;
  }
  const parsed = FindPartOutputSchema.safeParse({ ...raw, ...(raw.assetLabel === undefined && asset ? { assetLabel: asset.label } : {}) });
  if (!parsed.success) throw new Error(`parts output violated contract: ${parsed.error.message}`);
  const output = parsed.data;

  const first = output.items[0];
  const text = first
    ? plain(`The best match is ${first.name} for ${money(first.price)}. ${capitalize(first.fitReason.replace(/[.\s]+$/, ""))}. Say "the first one" to order it.`)
    : "I couldn't find that part.";
  return { output, text };
}
