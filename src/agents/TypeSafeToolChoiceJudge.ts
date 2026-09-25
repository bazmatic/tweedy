import { Speech } from "../types";
import { choice, IJudgmentProvider } from "../providers/judgment-questions";
import {
  JudgmentPrediction,
  JudgmentRunner,
  TypeSafeDecision,
} from "../services/JudgmentRunner";
import {
  getJudgmentProvider,
  getJudgmentRunner,
} from "../services/judgment-runtime";
import { SpeakerAgentToolName } from "./speaker-tools";

export const SPEAKER_TOOL_JUDGMENT = "speaker-tool";

/**
 * The Choice option the model sees for each tool: a descriptive name and a
 * short statement of what that kind of turn does. The tools' own
 * descriptions are generation instructions (length, fillers, punctuation),
 * not meanings, and names like "speak" say little on their own.
 */
const TOOL_OPTIONS: Record<SpeakerAgentToolName, { option: string; criterion: string }> = {
  [SpeakerAgentToolName.SPEAK]: {
    option: "make_one_short_point",
    criterion: "Make the next single point, fact, or conversational beat in a sentence or two",
  },
  [SpeakerAgentToolName.EXPLAIN]: {
    option: "explain_a_complex_step",
    criterion: "Explain one genuinely complex step that cannot be made clear in a short turn",
  },
  [SpeakerAgentToolName.INTERJECT]: {
    option: "react_in_a_few_words",
    criterion: "React spontaneously in a few words (surprise, interest, a quick check)",
  },
  [SpeakerAgentToolName.FILLER_COMMENT]: {
    option: "show_warm_listening",
    criterion: "Show warm, active listening with a one-to-three-word reaction",
  },
  [SpeakerAgentToolName.ONE_LINER]: {
    option: "land_one_sharp_sentence",
    criterion: "Land a single witty, insightful, or thought-provoking sentence",
  },
  [SpeakerAgentToolName.QUOTE]: {
    option: "quote_the_material",
    criterion: "Quote a short passage from the source material",
  },
  [SpeakerAgentToolName.SHORT_QUESTION]: {
    option: "ask_a_short_question",
    criterion: "Ask one short, genuine question that moves the discussion on",
  },
  [SpeakerAgentToolName.NEARLY_OUT_OF_TIME]: {
    option: "flag_running_out_of_time",
    criterion: "Flag that the episode is nearly out of time, answering anything still pending",
  },
  [SpeakerAgentToolName.CHALLENGE]: {
    option: "push_back_with_an_objection",
    criterion: "Push back on what was just said with a substantive objection",
  },
  [SpeakerAgentToolName.SUMMARIZE]: {
    option: "recap_several_points",
    criterion: "Recap several discussion points at once to catch up",
  },
  [SpeakerAgentToolName.CLOSING_STATEMENT]: {
    option: "close_the_episode",
    criterion: "Deliver the episode's closing statement and sign-off",
  },
  [SpeakerAgentToolName.COLD_OPEN]: {
    option: "open_the_episode_cold",
    criterion: "Open the episode with a short, vivid teaser before any introductions",
  },
  [SpeakerAgentToolName.PARAPHRASE]: {
    option: "restate_their_point_to_check_understanding",
    criterion: "Restate the previous speaker's point in simpler words to check understanding",
  },
  [SpeakerAgentToolName.AGREE]: {
    option: "agree_and_build_on_it",
    criterion: "Agree with the previous speaker and add a small point or example",
  },
  [SpeakerAgentToolName.TEASE]: {
    option: "hook_an_upcoming_point",
    criterion: "Hook an upcoming point with an intriguing line before giving its substance",
  },
  [SpeakerAgentToolName.INVITE]: {
    option: "nudge_the_cohost_to_continue",
    criterion: "Nudge the co-host to continue after their tease ('go on', 'how so?')",
  },
};

export interface ToolChoiceRequest {
  kind: "turn" | "interjection";
  /** Tools the response-mode policy allows for this turn. */
  allowedTools: SpeakerAgentToolName[];
  /** The last few spoken turns, oldest first. */
  recentSpeeches: Speech[];
  nextSpeaker: { name: string; personality: string; epistemicRole: string };
  directorGuidance?: string;
  turnGoal?: string;
}

/**
 * Predicts which allowed tool the next turn should use, through the
 * `speaker-tool.<kind>` judgment. In "on" mode the generation call can be
 * forced to the predicted tool; in shadow mode the model still chooses and
 * settle() compares its pick. A single allowed tool needs no prediction.
 */
export function predictSpeakerTool(
  request: ToolChoiceRequest,
  deps: { runner?: JudgmentRunner; provider?: IJudgmentProvider } = {}
): Promise<JudgmentPrediction<SpeakerAgentToolName>> {
  if (request.allowedTools.length <= 1) {
    return Promise.resolve({ settle: async () => {} });
  }
  const runner = deps.runner ?? getJudgmentRunner();
  return runner.predict({
    judgment: `${SPEAKER_TOOL_JUDGMENT}.${request.kind}`,
    typesafe: () =>
      chooseSpeakerToolWithTypeSafe(request, deps.provider ?? getJudgmentProvider()),
    state: { allowedTools: request.allowedTools, directorGuidance: request.directorGuidance },
  });
}

export async function chooseSpeakerToolWithTypeSafe(
  request: ToolChoiceRequest,
  provider: IJudgmentProvider
): Promise<TypeSafeDecision<SpeakerAgentToolName>> {
  const optionToTool = new Map(
    request.allowedTools.map((tool) => [TOOL_OPTIONS[tool].option, tool])
  );
  const result = await provider.judge(
    {
      recent_conversation: request.recentSpeeches.map(
        (speech) => `${speech.speaker.name}: ${speech.message}`
      ),
      next_speaker: {
        name: request.nextSpeaker.name,
        personality: request.nextSpeaker.personality,
        epistemic_role: request.nextSpeaker.epistemicRole,
      },
      ...(request.directorGuidance ? { director_guidance: request.directorGuidance } : {}),
      ...(request.turnGoal ? { turn_goal: request.turnGoal } : {}),
    },
    {
      kind_of_turn_to_take: choice(
        request.kind === "interjection"
          ? "`next_speaker` is about to interject on the last line of `recent_conversation`. What kind of interjection fits best?"
          : "What kind of turn should `next_speaker` take next in this podcast conversation, given `recent_conversation` and any `director_guidance` or `turn_goal`?",
        Object.fromEntries(
          request.allowedTools.map((tool) => [
            TOOL_OPTIONS[tool].option,
            TOOL_OPTIONS[tool].criterion,
          ])
        )
      ),
    }
  );
  if (result.status !== "ok") return result;

  const answer = result.answers.kind_of_turn_to_take;
  const tool = optionToTool.get(answer.choice);
  if (!tool) {
    return { status: "unavailable", reason: `unknown tool option "${answer.choice}"` };
  }
  return {
    status: "ok",
    value: tool,
    detail: {
      option: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
    },
  };
}
