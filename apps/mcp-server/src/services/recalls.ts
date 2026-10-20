import type { Asset, RecallRecord, RecallsOutput } from "@hearth/contracts";
import type { Core, Ctx } from "./core";
import { plain } from "./format";

export const RECALL_DATASET_LABEL = "Sample recall data for this demo. It is not live Consumer Product Safety Commission data.";

function modelMatches(pattern: string, model: string): boolean {
  try {
    return new RegExp(pattern, "i").test(model);
  } catch {
    return false;
  }
}

/** Recalls that apply to an asset: its seeded flag, or the same brand with a model that fits the recall pattern. */
export function matchingRecalls(asset: Asset, recalls: RecallRecord[]): RecallRecord[] {
  return recalls.filter((r) => {
    if (asset.recallIds.includes(r.recallId)) return true;
    if (!asset.brand || !asset.model) return false;
    return asset.brand.trim().toLowerCase() === r.brand.trim().toLowerCase() && modelMatches(r.modelPattern, asset.model);
  });
}

export async function checkRecalls(core: Core, ctx: Ctx): Promise<{ output: RecallsOutput; text: string }> {
  const assets = await core.repo.listAssets(ctx.home.homeId);
  const recalls = core.parts.listRecalls();
  const flagged: RecallsOutput["flagged"] = [];
  for (const asset of assets) {
    for (const recall of matchingRecalls(asset, recalls)) {
      flagged.push({
        assetId: asset.assetId,
        assetName: asset.label,
        brand: asset.brand ?? recall.brand,
        model: asset.model ?? "",
        recallId: recall.recallId,
        title: recall.title,
        hazard: recall.hazard,
        remedy: recall.remedy,
        isSample: recall.isSample,
      });
    }
  }
  const output: RecallsOutput = { checkedCount: assets.length, datasetLabel: RECALL_DATASET_LABEL, flagged };

  const first = flagged[0];
  const text = first
    ? plain(
        `Your ${first.assetName} matches a sample recall: ${first.title}. ${first.remedy[0] ? `First step: ${first.remedy[0]}` : ""} ` +
          `This list is sample data, not live recall data.`,
      ).replace(/\s{2,}/g, " ")
    : `I checked ${assets.length} items in your home against the sample recall list and found no matches. Remember it's sample data, not live recall data.`;
  return { output, text };
}
