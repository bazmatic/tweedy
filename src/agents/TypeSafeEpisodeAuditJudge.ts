import { Speech } from "../types";
import {
  choice,
  ChoiceQuestion,
  IJudgmentProvider,
} from "../providers/judgment-questions";
import { JudgmentRunner, TypeSafeDecision } from "../services/JudgmentRunner";
import {
  getJudgmentProvider,
  getJudgmentRunner,
} from "../services/judgment-runtime";
import { EpisodeAuditInput } from "./editorial-schemas";

export const EPISODE_AUDIT_JUDGMENT = "episode-audit";
export const DEFAULT_EPISODE_AUDIT_THRESHOLD = 0.5;

type AuditIssue = EpisodeAuditInput["issues"][number];
type AuditCategory = AuditIssue["category"];

interface DefectSpec {
  category: AuditCategory;
  criterion: string;
  /** Reason fragment (≤12 words) handed to the repair rewrite. */
  reason: string;
  /** Offered only for the episode's final turn. */
  finalTurnOnly?: boolean;
}

/**
 * Local defects a single-turn rewrite can repair. Duration language and
 * malformed speech stay with the deterministic checks.
 */
const DEFECTS: Record<string, DefectSpec> = {
  missing_context_listeners_need: {
    category: "listener_context",
    criterion:
      "The turn relies on a person, term, or event a listener has not yet heard introduced, so they cannot follow it",
    reason: "Relies on context listeners have not heard yet",
  },
  consequence_before_its_setup: {
    category: "dependency_order",
    criterion:
      "The turn states a consequence or payoff before the setup it depends on has been spoken",
    reason: "States a consequence before its setup",
  },
  repeats_earlier_content: {
    category: "substantial_repetition",
    criterion:
      "The turn substantially repeats what an earlier turn already said, without adding anything",
    reason: "Substantially repeats an earlier turn",
  },
  speaker_acts_against_their_role: {
    category: "speaker_role",
    criterion:
      "The speaker acts against their role, e.g. the expert feigns ignorance or the host lectures with specialist facts",
    reason: "Speaker acts against their established role",
  },
  breaks_flow_with_neighbouring_turns: {
    category: "continuity",
    criterion:
      "The turn ignores or contradicts the turn right before it, or leaves the next turn with nothing to respond to",
    reason: "Breaks continuity with the neighbouring turns",
  },
  closing_misstates_the_episode: {
    category: "closing_accuracy",
    criterion:
      "This closing turn summarises the episode inaccurately or claims something was covered that was not",
    reason: "Closing summary misstates what the episode covered",
    finalTurnOnly: true,
  },
  no_local_defect: {
    category: "listener_context",
    criterion: "None of the above: the turn works where it is",
    reason: "",
  },
};

const NO_DEFECT = "no_local_defect";

export interface EpisodeAuditRequest {
  speeches: Speech[];
  maxIssues: number;
  /** Today's whole-transcript LLM audit. */
  current: () => Promise<AuditIssue[]>;
}

export interface EpisodeAuditDeps {
  runner?: JudgmentRunner;
  provider?: IJudgmentProvider;
  threshold?: number;
}

/**
 * Audits a finished episode through the `episode-audit` judgment: one Choice
 * per turn over the repairable defect categories (or no_local_defect), all in
 * one request over the full transcript, instead of a free-form scan.
 */
export function auditEpisodeTurns(
  request: EpisodeAuditRequest,
  deps: EpisodeAuditDeps = {}
): Promise<AuditIssue[]> {
  const runner = deps.runner ?? getJudgmentRunner();
  return runner.run({
    judgment: EPISODE_AUDIT_JUDGMENT,
    current: request.current,
    typesafe: () =>
      auditEpisodeTurnsWithTypeSafe(
        request,
        deps.provider ?? getJudgmentProvider(),
        deps.threshold ?? DEFAULT_EPISODE_AUDIT_THRESHOLD
      ),
    state: { turns: request.speeches.length },
    // Agreement on which turns need repair; categories often overlap.
    agrees: (current, typesafe) => sameTurns(current, typesafe),
  });
}

export async function auditEpisodeTurnsWithTypeSafe(
  request: EpisodeAuditRequest,
  provider: IJudgmentProvider,
  threshold: number
): Promise<TypeSafeDecision<AuditIssue[]>> {
  const { speeches } = request;
  if (speeches.length === 0) return { status: "ok", value: [] };

  const questions: Record<string, ChoiceQuestion> = {};
  speeches.forEach((_speech, index) => {
    const isFinal = index === speeches.length - 1;
    const options = Object.entries(DEFECTS).filter(
      ([, spec]) => !spec.finalTurnOnly || isFinal
    );
    questions[`most_serious_defect_in_turn_${index}`] = choice(
      `Listening only to \`transcript\` in order, what is the most serious local defect in \`transcript[${index}]\` — ` +
        "one that rewriting that single turn would repair? Do not count a planned topic that was simply never raised.",
      Object.fromEntries(options.map(([option, spec]) => [option, spec.criterion]))
    );
  });

  const result = await provider.judge(
    {
      transcript: speeches.map((speech) => ({
        speaker: speech.speaker.name,
        text: speech.message,
      })),
    },
    questions
  );
  if (result.status !== "ok") return result;

  const flagged: (AuditIssue & { probability: number; index: number })[] = [];
  const perTurn: Record<string, string> = {};
  speeches.forEach((speech, index) => {
    const answer = result.answers[`most_serious_defect_in_turn_${index}`];
    if (answer.type !== "choice") return;
    const probability = answer.probabilities[answer.choice] ?? answer.confidence;
    perTurn[speech.id] = `${answer.choice} (${probability.toFixed(2)})`;
    if (answer.choice === NO_DEFECT || probability < threshold) return;
    const spec = DEFECTS[answer.choice];
    flagged.push({
      speechId: speech.id,
      category: spec.category,
      reason: spec.reason,
      probability,
      index,
    });
  });

  // Most confident first; ties go to the earliest turn, which the prompt
  // audit is also told to prefer.
  flagged.sort((a, b) => b.probability - a.probability || a.index - b.index);
  return {
    status: "ok",
    value: flagged
      .slice(0, request.maxIssues)
      .map(({ speechId, category, reason }) => ({ speechId, category, reason })),
    detail: { perTurn },
  };
}

function sameTurns(a: AuditIssue[], b: AuditIssue[]): boolean {
  const ids = (issues: AuditIssue[]) =>
    [...new Set(issues.map((issue) => issue.speechId))].sort().join(",");
  return ids(a) === ids(b);
}
