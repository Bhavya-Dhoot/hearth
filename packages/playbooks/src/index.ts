import type { PlaybooksApi } from "@hearth/contracts";

/** Stub frozen at G0. Lane A1 replaces the bodies; the exported shape must not change. */
const notBuilt = (): never => { throw new Error("not_built: @hearth/playbooks"); };

export const playbooks: PlaybooksApi = {
  listPlaybooks: notBuilt,
  getPlaybook: notBuilt,
  triage: notBuilt,
  getRepairStep: notBuilt,
  checkHardStop: notBuilt,
};
