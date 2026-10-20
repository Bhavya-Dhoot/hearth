import type {
  Asset,
  ClarifyingQuestion,
  HardStopResult,
  Playbook,
  PlaybookQuestion,
  SafetyCategory,
  TriageInput,
  TriageOutput,
} from "@hearth/contracts";
import { exprWeight, matchesAny, matchesAnyNormalised, normalise, routeKeyMatches } from "./match";
import { HARD_STOP_TRADE } from "./safety/rules";
import { checkHardStop, hardStopFor } from "./safety";
import { renderTemplate } from "./template";

/**
 * Deterministic triage (PRD 7.4, Appendix D):
 *   hard-stop check -> symptoms score every playbook -> if one clearly leads, that is the leaf
 *   -> otherwise at most two questions (routed by keyword) -> leaf, escalation or hard stop.
 * Nothing here calls a model; the same input always gives the same output.
 */

/** A runner-up scoring at least this share of the leader's score makes the symptom ambiguous. */
const AMBIGUITY_RATIO = 0.6;
/** Confidence when the customer's own answer picked the playbook. */
const ROUTED_CONFIDENCE = 0.86;
/** Confidence while a question is still open. */
const ASKING_CONFIDENCE = 0.45;
/** Confidence when several playbooks tie and none has a question to separate them. */
const UNRESOLVED_CONFIDENCE = 0.55;

/** The engine's own opening question, used only when no playbook matches the symptom. */
const DESCRIBE_QUESTION: PlaybookQuestion = {
  id: "describe",
  text: "What are you seeing or hearing, and where in the house is it?",
  routes: {},
};

interface Candidate {
  readonly playbook: Playbook;
  readonly score: number;
}

export interface TriageEngine {
  triage(input: TriageInput, ctx: { assets: Asset[] }): TriageOutput;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

const decisiveConfidence = (score: number): number => round2(Math.min(0.94, 0.72 + 0.04 * score));

function questionView(question: PlaybookQuestion): ClarifyingQuestion {
  return question.options
    ? { id: question.id, text: question.text, options: [...question.options] }
    : { id: question.id, text: question.text };
}

function questionOutput(question: PlaybookQuestion, confidence: number): TriageOutput {
  return {
    issueId: null,
    confidence,
    clarifyingQuestions: [questionView(question)],
    safety: { hardStop: false },
    escalate: false,
  };
}

function hardStopOutput(stop: HardStopResult): TriageOutput {
  const key = stop.category ?? "minors";
  return {
    issueId: null,
    confidence: 1,
    clarifyingQuestions: [],
    safety: {
      hardStop: true,
      ...(stop.message !== undefined ? { message: stop.message } : {}),
      ...(stop.category !== undefined ? { category: stop.category } : {}),
    },
    escalate: true,
    escalateReason: stop.category ? `Safety hard stop: ${stop.category}.` : "Safety hard stop: a child is involved.",
    trade: HARD_STOP_TRADE[key],
  };
}

function giveUpOutput(): TriageOutput {
  return {
    issueId: null,
    confidence: 0,
    clarifyingQuestions: [],
    safety: { hardStop: false },
    escalate: true,
    escalateReason: "I couldn't match that to one of the repairs I can walk you through, so a pro should take a look.",
    trade: "general",
  };
}

export function createTriage(playbooks: readonly Playbook[]): TriageEngine {
  const byId = new Map(playbooks.map((p) => [p.id, p]));

  const rank = (normalisedSymptom: string): Candidate[] =>
    playbooks
      .map((playbook) => ({
        playbook,
        score: playbook.symptoms.reduce(
          (sum, symptom) => (matchesAnyNormalised(normalisedSymptom, [symptom], true) ? sum + exprWeight(symptom) : sum),
          0,
        ),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score);

  const findAsset = (assets: readonly Asset[], playbook: Playbook, suspectedAssetId: string | undefined): Asset | undefined =>
    (suspectedAssetId !== undefined ? assets.find((a) => a.assetId === suspectedAssetId) : undefined) ??
    assets.find((a) => a.category === playbook.assetCategory);

  function leaf(playbook: Playbook, confidence: number, fullText: string, input: TriageInput, assets: readonly Asset[]): TriageOutput {
    for (const stop of playbook.hardStops) {
      if (matchesAny(fullText, stop.keywords)) return hardStopOutput(hardStopFor(stop.category));
    }
    const asset = findAsset(assets, playbook, input.suspectedAssetId);
    const suspectedAsset = asset ? { suspectedAsset: { assetId: asset.assetId, label: asset.label } } : {};
    const base = {
      issueId: playbook.id,
      issueTitle: playbook.title,
      confidence,
      clarifyingQuestions: [],
      safety: { hardStop: false },
      ...suspectedAsset,
    };
    const rule = playbook.escalateIf.find((r) => r.keywords.includes("*") || matchesAny(fullText, r.keywords));
    if (!rule) return { ...base, escalate: false };
    return {
      ...base,
      escalate: true,
      escalateReason: renderTemplate(rule.reason, { asset, shutoff: undefined, year: new Date().getFullYear() }),
      trade: playbook.trade,
    };
  }

  function escalation(playbook: Playbook, reason: string, assets: readonly Asset[], input: TriageInput): TriageOutput {
    const asset = findAsset(assets, playbook, input.suspectedAssetId);
    return {
      issueId: playbook.id,
      issueTitle: playbook.title,
      confidence: ROUTED_CONFIDENCE,
      clarifyingQuestions: [],
      safety: { hardStop: false },
      escalate: true,
      escalateReason: renderTemplate(reason, { asset, shutoff: undefined, year: new Date().getFullYear() }),
      trade: playbook.trade,
      ...(asset ? { suspectedAsset: { assetId: asset.assetId, label: asset.label } } : {}),
    };
  }

  function resolveQuestion(
    owner: Playbook,
    question: PlaybookQuestion,
    input: TriageInput,
    fullText: string,
    assets: readonly Asset[],
  ): TriageOutput {
    const answer = input.answers?.[question.id];
    if (answer === undefined) return questionOutput(question, ASKING_CONFIDENCE);
    const normalisedAnswer = normalise(answer);
    const matched = Object.entries(question.routes).find(([key]) => routeKeyMatches(normalisedAnswer, key));
    // An answer that matches no route is treated as unanswered: ask again.
    if (!matched) return questionOutput(question, ASKING_CONFIDENCE);
    const destination = matched[1];

    if (destination.startsWith("question:")) {
      const next = owner.questions.find((q) => q.id === destination.slice("question:".length))!;
      return resolveQuestion(owner, next, input, fullText, assets);
    }
    if (destination.startsWith("escalate:")) return escalation(owner, destination.slice("escalate:".length).trim(), assets, input);
    if (destination.startsWith("hardstop:")) return hardStopOutput(hardStopFor(destination.slice("hardstop:".length) as SafetyCategory));
    return leaf(byId.get(destination)!, ROUTED_CONFIDENCE, fullText, input, assets);
  }

  return {
    triage(input, ctx) {
      const answers = input.answers ?? {};
      const fullText = [input.symptomText, ...Object.values(answers)].join(" ");

      const stop = checkHardStop(fullText);
      if (stop.hardStop) return hardStopOutput(stop);

      const described = answers[DESCRIBE_QUESTION.id];
      const ranked = rank(normalise(described === undefined ? input.symptomText : `${input.symptomText} ${described}`));
      if (ranked.length === 0) return described === undefined ? questionOutput(DESCRIBE_QUESTION, 0.1) : giveUpOutput();

      const top = ranked[0]!;
      const contested = ranked.filter((c) => c.score >= top.score * AMBIGUITY_RATIO);
      if (contested.length === 1) return leaf(top.playbook, decisiveConfidence(top.score), fullText, input, ctx.assets);

      const asker = contested.find((c) => c.playbook.questions.length > 0);
      if (!asker) return leaf(top.playbook, UNRESOLVED_CONFIDENCE, fullText, input, ctx.assets);
      return resolveQuestion(asker.playbook, asker.playbook.questions[0]!, input, fullText, ctx.assets);
    },
  };
}
