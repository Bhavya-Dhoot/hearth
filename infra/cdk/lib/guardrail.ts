import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type * as bedrock from "aws-cdk-lib/aws-bedrock";

/**
 * Hearth's spoken refusal. One message is shared by every denied topic, so it names the
 * category of risk without repeating the user's request.
 */
export const BLOCKED_MESSAGE =
  "I can't help with that one here. If it's gas, an electrical panel, structural damage or sewage, " +
  "it needs a licensed pro, and I can put together a brief for them from what I know about your home.";

export type GuardrailConfig = Pick<
  bedrock.CfnGuardrailProps,
  | "blockedInputMessaging"
  | "blockedOutputsMessaging"
  | "description"
  | "topicPolicyConfig"
  | "contentPolicyConfig"
  | "wordPolicyConfig"
  | "sensitiveInformationPolicyConfig"
>;

const deny = (name: string, definition: string, examples: string[]) => ({
  name,
  type: "DENY",
  definition,
  examples,
  inputAction: "BLOCK",
  outputAction: "BLOCK",
  inputEnabled: true,
  outputEnabled: true,
});

/** Built-in default, used when packages/playbooks/safety/bedrock-guardrail.json does not exist. */
export const DEFAULT_GUARDRAIL: GuardrailConfig = {
  description: "Hearth hard stops: jobs that must go to a licensed professional, and content about children.",
  blockedInputMessaging: BLOCKED_MESSAGE,
  blockedOutputsMessaging: BLOCKED_MESSAGE,
  topicPolicyConfig: {
    topicsConfig: [
      deny(
        "Gas line work",
        "Instructions for installing, repairing, relighting or modifying gas lines, gas valves or gas appliances, or for tracking down a gas leak.",
        ["How do I fix a gas leak behind my stove?", "Can I move my gas line myself?"],
      ),
      deny(
        "Electrical panel work",
        "Instructions for opening or working inside an electrical panel or breaker box, replacing breakers, or rewiring circuits, beyond resetting a tripped breaker.",
        ["How do I swap a breaker in my panel?", "Walk me through rewiring this circuit."],
      ),
      deny(
        "Structural repair",
        "Instructions for repairing or altering load-bearing walls, beams, joists, foundations or roof framing.",
        ["Can I cut out this load-bearing wall?", "How do I fix a sagging floor joist?"],
      ),
      deny(
        "Sewage handling",
        "Instructions for handling raw sewage, sewer line backups, septic systems or contaminated wastewater.",
        ["How do I clear a sewer main backup myself?", "How do I clean up sewage in my basement?"],
      ),
      deny(
        "Content about children",
        "Requests to collect, store or discuss personal details about children, such as their names, ages, schools or photos.",
        ["Add my kid's name and school to my home profile.", "Remember my daughter's age and bedroom."],
      ),
    ],
  },
};

export interface LoadedGuardrail {
  readonly config: GuardrailConfig;
  readonly source: "file" | "default";
  /** Short content hash; used in the logical id of the immutable guardrail version. */
  readonly hash: string;
}

export const GUARDRAIL_FILE = ["packages", "playbooks", "safety", "bedrock-guardrail.json"] as const;

/**
 * Loads the safety agent's policy if it exists at synth time. The file uses the CloudFormation
 * property shape of AWS::Bedrock::Guardrail (camelCase), minus name/tags which are owned here.
 * Anything missing falls back to the defaults, so a partial file cannot produce an unsafe guardrail.
 */
export function loadGuardrail(repoRoot: string): LoadedGuardrail {
  const file = join(repoRoot, ...GUARDRAIL_FILE);
  let config: GuardrailConfig = DEFAULT_GUARDRAIL;
  let source: LoadedGuardrail["source"] = "default";
  if (existsSync(file)) {
    const loaded = JSON.parse(readFileSync(file, "utf8")) as Partial<GuardrailConfig>;
    config = {
      ...DEFAULT_GUARDRAIL,
      ...loaded,
      blockedInputMessaging: loaded.blockedInputMessaging ?? BLOCKED_MESSAGE,
      blockedOutputsMessaging: loaded.blockedOutputsMessaging ?? loaded.blockedInputMessaging ?? BLOCKED_MESSAGE,
    };
    source = "file";
  }
  const hash = createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 8);
  return { config, source, hash };
}
