import { Speech } from "../types";
import { SpeakerAgentToolName } from "../agents/speaker-tools";
import { IJudgmentProvider, noul } from "../providers/judgment-questions";
import { JudgmentRunner } from "./JudgmentRunner";
import { getJudgmentProvider, getJudgmentRunner } from "./judgment-runtime";
import { JudgmentDecision } from "./decide";

/** Maps judged naturalness to an interjection chance: 0.5 or below never interjects. */
export function calibrate(probability: number): number {
  return Math.max(0, (probability - 0.5) / 0.5);
}

/**
 * Judges how natural it would be for a co-host to jump in right after this
 * turn, returning the probability (0-1) that they would.
 */
export async function judgeInterjectionNaturalness(
  turnText: string,
  speakerName: string,
  provider: IJudgmentProvider
): Promise<JudgmentDecision<number>> {
  const result = await provider.judge(
    { turn: `${speakerName}: ${turnText}` },
    {
      cohost_would_jump_in: noul(
        "In a lively podcast conversation, would a co-host naturally jump in with a quick reaction right after `turn`?",
        {
          true: "A striking moment a co-host would react to: a surprising or vivid detail, a provocative claim, or a long run that invites a reaction",
          false: "Nothing to react to: a plain factual statement, routine background, or a question the co-host should properly answer instead",
        }
      ),
    }
  );
  if (result.status !== "ok") return result;
  return { status: "ok", value: result.answers.cohost_would_jump_in.probability };
}

export const INTERJECTION_LENGTH_THRESHOLD = 80;
export const INTERJECTION_CHANCE = 0.8;

export const LONG_FORM_TOOLS = [
  SpeakerAgentToolName.SPEAK,
  SpeakerAgentToolName.EXPLAIN,
];

type InterjectionCandidate = Pick<Speech, "tool" | "message" | "stopReason">;

/**
 * A speech cut off by the token limit is exactly the moment a co-host
 * jumping in sounds most natural, so it always forces an interjection
 * rather than going through the length-and-chance roll.
 */
export function shouldInterject(
  speech: InterjectionCandidate,
  speakerCount: number,
  roll: number
): boolean {
  if (speakerCount <= 1) return false;

  if (speech.stopReason === "max_tokens") return true;

  const ranLong =
    speech.tool !== undefined &&
    LONG_FORM_TOOLS.includes(speech.tool) &&
    speech.message.length > INTERJECTION_LENGTH_THRESHOLD;

  return ranLong && roll < INTERJECTION_CHANCE;
}

export const INTERJECTION_JUDGMENT = "interjection";

export interface InterjectionDeps {
  runner?: JudgmentRunner;
  provider?: IJudgmentProvider;
}

type InterjectionTurn = InterjectionCandidate & Pick<Speech, "speaker">;

/**
 * shouldInterject routed through the `interjection` judgment. The structural
 * rules stay deterministic (solo shows never interject; a truncated turn
 * always does). Otherwise TypeSafe judges how natural a co-host reaction
 * would be right now, and `roll` samples that probability — keeping the
 * variety the fixed 80% chance was there for, while replacing its
 * character-count threshold with a judgment of what was actually said.
 */
export async function decideInterjection(
  speech: InterjectionTurn,
  speakerCount: number,
  roll: number,
  deps: InterjectionDeps = {}
): Promise<boolean> {
  if (speakerCount <= 1) return false;
  if (speech.stopReason === "max_tokens") return true;

  const runner = deps.runner ?? getJudgmentRunner();
  return runner.run({
    judgment: INTERJECTION_JUDGMENT,
    current: async () => shouldInterject(speech, speakerCount, roll),
    typesafe: async () => {
      const result = await (deps.provider ?? getJudgmentProvider()).judge(
        { turn: `${speech.speaker.name}: ${speech.message}` },
        {
          cohost_would_jump_in: noul(
            "In a lively podcast conversation, would a co-host naturally jump in with a quick reaction right after `turn`?",
            {
              true: "A natural moment for a brief reaction: a surprising claim, a vivid detail, a long run, or a point that invites a response",
              false: "A reaction would feel forced: nothing notable to react to, or it is a question the co-host should properly answer instead",
            }
          ),
        }
      );
      if (result.status !== "ok") return result;
      const probability = result.answers.cohost_would_jump_in.probability;
      return { status: "ok", value: roll < probability, detail: { probability, roll } };
    },
    state: { turn: speech.message, tool: speech.tool },
  });
}
