import { Speech } from "../types";
import { IJudgmentProvider, noul } from "../providers/judgment-questions";
import { decide, JudgmentDecision } from "./decide";
import { getJudgmentProvider } from "./judgment-runtime";

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

export const INTERJECTION_JUDGMENT = "interjection";

export interface InterjectionDeps {
  provider?: IJudgmentProvider;
}

type InterjectionTurn = Pick<Speech, "tool" | "message" | "stopReason" | "speaker">;

/**
 * Whether a co-host should interject after this turn. The structural rules
 * stay deterministic and never call the provider: a solo show never
 * interjects, and a turn truncated by the token limit always does — that is
 * exactly the moment a co-host jumping in sounds most natural. Otherwise
 * TypeSafe judges how natural a co-host reaction would be right now, and
 * `roll` samples the calibrated chance.
 */
export async function decideInterjection(
  speech: InterjectionTurn,
  speakerCount: number,
  roll: number,
  deps: InterjectionDeps = {}
): Promise<boolean> {
  if (speakerCount <= 1) return false;
  if (speech.stopReason === "max_tokens") return true;

  return decide({
    judgment: INTERJECTION_JUDGMENT,
    ask: async () => {
      const d = await judgeInterjectionNaturalness(
        speech.message,
        speech.speaker.name,
        deps.provider ?? getJudgmentProvider()
      );
      return d.status === "ok"
        ? { status: "ok", value: roll < calibrate(d.value), detail: { probability: d.value, roll } }
        : d;
    },
    fallback: false,
    state: { turn: speech.message, tool: speech.tool },
  });
}
