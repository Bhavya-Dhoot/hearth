import { GENERIC_MEDIA, mediaUrl } from "@hearth/contracts";
import type { Asset, Playbook, RepairStepsOutput, StepContext } from "@hearth/contracts";
import { chipNoun, chipPlace, renderTemplate } from "./template";

type StepImage = NonNullable<RepairStepsOutput["image"]>;

const findAsset = (assets: readonly Asset[], category: string | undefined): Asset | undefined =>
  category === undefined ? undefined : assets.find((asset) => asset.category === category);

/**
 * One personalised step of a playbook (PRD 7.4). The step shows the customer's own photo when the
 * home graph has one for `photoOf`; otherwise the generic illustration plus a hint on how to add it.
 * Throws Error("unknown_playbook") for an unknown id and RangeError for a bad step index.
 */
export function buildRepairStep(playbook: Playbook | undefined, stepIndex: number, ctx: StepContext): RepairStepsOutput {
  if (!playbook) throw new Error("unknown_playbook");
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= playbook.steps.length) {
    throw new RangeError(`stepIndex ${stepIndex} is out of range for ${playbook.id} (0..${playbook.steps.length - 1})`);
  }
  const step = playbook.steps[stepIndex]!;
  const pictured = findAsset(ctx.assets, step.photoOf);
  const scope = { asset: findAsset(ctx.assets, playbook.assetCategory), shutoff: pictured, year: new Date().getFullYear() };
  const render = (text: string): string => renderTemplate(text, scope);

  const photo = pictured?.photos[0];
  let image: StepImage | undefined;
  let locationChip: string | undefined;
  let addHint: string | undefined;
  if (pictured && photo) {
    image = {
      url: photo.url,
      alt: photo.alt,
      isUsersPhoto: true,
      ...(photo.annotation ? { annotation: photo.annotation } : {}),
    };
    locationChip = `YOUR ${chipNoun(pictured)} · ${chipPlace(pictured)}`;
  } else {
    if (step.fallbackImage !== undefined) {
      image = {
        url: mediaUrl(ctx.mcpBase, step.fallbackImage),
        alt: GENERIC_MEDIA[step.fallbackImage as keyof typeof GENERIC_MEDIA],
        isUsersPhoto: false,
      };
    }
    if (step.photoOf !== undefined) addHint = step.addHint;
  }

  const partAsset = step.partRole !== undefined ? findAsset(ctx.assets, step.partAssetCategory ?? playbook.assetCategory) : undefined;
  const isLast = stepIndex === playbook.steps.length - 1;

  return {
    issueId: playbook.id,
    issueTitle: playbook.title,
    stepIndex,
    stepCount: playbook.steps.length,
    instruction: render(step.instruction),
    ...(step.detail !== undefined ? { detail: render(step.detail) } : {}),
    ...(image ? { image } : {}),
    ...(locationChip !== undefined ? { locationChip } : {}),
    ...(step.caution !== undefined ? { caution: render(step.caution) } : {}),
    ...(step.tools !== undefined ? { tools: [...step.tools] } : {}),
    ...(step.partRole !== undefined && partAsset ? { partNeeded: { partRole: step.partRole, assetId: partAsset.assetId } } : {}),
    ...(addHint !== undefined ? { addHint } : {}),
    primaryAction: isLast ? "done" : "next",
    canSkip: step.canSkip,
    isLast,
  };
}
