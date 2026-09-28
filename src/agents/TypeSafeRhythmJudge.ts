import { Speech } from "../types";
import { choice, IJudgmentProvider } from "../providers/judgment-questions";
import { decide, JudgmentDecision } from "../services/decide";
import { getJudgmentProvider } from "../services/judgment-runtime";
// ConversationRhythmPolicy imports this module, so its exports are only read
// inside functions (by then both modules have loaded), never at load time.
import {
  RECENT_TURNS_ALL_BRIEF_REACTIONS,
  RECENT_TURNS_INFORMATION_HEAVY,
  RhythmRecommendation,
} from "./ConversationRhythmPolicy";

export const CONVERSATION_RHYTHM_JUDGMENT = "conversation-rhythm";

const CRITERIA = {
  recent_turns_were_all_brief_reactions:
    "Every turn in `recent_turns` is only a brief reaction, filler, or quick question; none adds real substance",
  recent_turns_were_information_heavy:
    "Most of `recent_turns` deliver dense information or explanation back to back, with little reaction, question, or breathing room",
  recent_rhythm_is_varied:
    "`recent_turns` already mix substance with reactions or questions; neither pattern above applies",
};

type RhythmOption = keyof typeof CRITERIA;

export interface RhythmRequest {
  /** The last two or three turns, oldest first. */
  recentSpeeches: Speech[];
}

export function judgeRhythm(
  request: RhythmRequest,
  deps: { provider?: IJudgmentProvider } = {}
): Promise<RhythmRecommendation | undefined> {
  return decide({
    judgment: CONVERSATION_RHYTHM_JUDGMENT,
    ask: () =>
      judgeRhythmWithTypeSafe(request, deps.provider ?? getJudgmentProvider()),
    fallback: undefined,
    state: { recentTurns: toLines(request.recentSpeeches) },
  });
}

export async function judgeRhythmWithTypeSafe(
  request: RhythmRequest,
  provider: IJudgmentProvider
): Promise<JudgmentDecision<RhythmRecommendation | undefined>> {
  const result = await provider.judge(
    { recent_turns: toLines(request.recentSpeeches) },
    {
      recent_conversation_rhythm: choice(
        "Judging by what was actually said, what is the rhythm of `recent_turns` in this podcast conversation?",
        CRITERIA
      ),
    }
  );
  if (result.status !== "ok") return result;

  const answer = result.answers.recent_conversation_rhythm;
  const recommendations: Record<RhythmOption, RhythmRecommendation | undefined> = {
    recent_turns_were_all_brief_reactions: RECENT_TURNS_ALL_BRIEF_REACTIONS,
    recent_turns_were_information_heavy: RECENT_TURNS_INFORMATION_HEAVY,
    recent_rhythm_is_varied: undefined,
  };
  return {
    status: "ok",
    value: recommendations[answer.choice],
    detail: {
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
    },
  };
}

function toLines(speeches: Speech[]): string[] {
  return speeches.map((speech) => `${speech.speaker.name}: ${speech.message}`);
}
