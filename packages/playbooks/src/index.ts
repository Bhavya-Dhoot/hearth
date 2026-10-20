import type { Playbook, PlaybooksApi } from "@hearth/contracts";
import { loadPlaybooks } from "./loader";
import { checkHardStop } from "./safety";
import { buildRepairStep } from "./steps";
import { createTriage } from "./triage";

/**
 * The twelve repair playbooks (Appendix D), loaded and validated once at import. A malformed
 * playbook throws here, so a bad edit fails the first test or server start instead of a customer.
 */
const PLAYBOOKS: readonly Playbook[] = loadPlaybooks(new URL("../data/", import.meta.url));
const BY_ID = new Map(PLAYBOOKS.map((playbook) => [playbook.id, playbook]));
const engine = createTriage(PLAYBOOKS);

export const playbooks: PlaybooksApi = {
  listPlaybooks: () => [...PLAYBOOKS],
  getPlaybook: (id) => BY_ID.get(id),
  triage: (input, ctx) => engine.triage(input, ctx),
  getRepairStep: (issueId, stepIndex, ctx) => buildRepairStep(BY_ID.get(issueId), stepIndex, ctx),
  checkHardStop,
};

export { SAFETY_MESSAGES } from "./safety";
