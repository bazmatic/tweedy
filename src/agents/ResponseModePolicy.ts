import {
  EditorialMove,
  EpistemicRole,
  Speaker,
  Speech,
  TurnBrief,
} from "../types";
import {
  INTERVIEWER_TOOLS,
  SHORT_REACTION_TOOLS,
  SOLO_TOOLS,
  SpeakerAgentToolName,
} from "./speaker-tools";
import { SpeakerRoleProfileResolver } from "./SpeakerRoleProfileResolver";

export enum ConversationalObligation {
  AnswerChallenge = "answer_challenge",
  AnswerQuestion = "answer_question",
  ExecuteBrief = "execute_brief",
}

export interface ResponseModeContext {
  speaker: Speaker;
  speeches: Speech[];
  isSolo: boolean;
  isFinalTurn: boolean;
  forceNearlyOutOfTime: boolean;
  requestSummary: boolean;
  forceColdOpen?: boolean;
  turnBrief?: TurnBrief;
}

const QUESTION_MARK = "?";

const MOVES_THAT_MUST_NOT_BECOME_SUMMARIES = Object.freeze([
  EditorialMove.Question,
  EditorialMove.React,
]);

const EXPERT_DEFAULT_TOOLS = Object.freeze([
  SpeakerAgentToolName.SPEAK,
  SpeakerAgentToolName.EXPLAIN,
  SpeakerAgentToolName.QUOTE,
  SpeakerAgentToolName.CHALLENGE,
  SpeakerAgentToolName.ONE_LINER,
]);

const EXPERT_ANSWER_TOOLS = Object.freeze([
  SpeakerAgentToolName.SPEAK,
  SpeakerAgentToolName.EXPLAIN,
  SpeakerAgentToolName.QUOTE,
]);

const SUBSTANTIVE_TOOLS = Object.freeze([
  SpeakerAgentToolName.SPEAK,
  SpeakerAgentToolName.ONE_LINER,
]);

const SUBSTANTIVE_TOOLS_WITH_PARAPHRASE = Object.freeze([
  ...SUBSTANTIVE_TOOLS,
  SpeakerAgentToolName.PARAPHRASE,
]);

const CHALLENGE_TOOLS = Object.freeze([
  SpeakerAgentToolName.CHALLENGE,
  SpeakerAgentToolName.SPEAK,
]);

const CHALLENGE_RESPONSE_TOOLS = Object.freeze([
  SpeakerAgentToolName.SPEAK,
  SpeakerAgentToolName.CHALLENGE,
]);

const MOVE_TO_TOOLS: Readonly<
  Partial<Record<EditorialMove, readonly SpeakerAgentToolName[]>>
> = Object.freeze({
  [EditorialMove.Explain]: SUBSTANTIVE_TOOLS,
  [EditorialMove.Illustrate]: SUBSTANTIVE_TOOLS,
  [EditorialMove.TellStory]: SUBSTANTIVE_TOOLS,
  [EditorialMove.AddContext]: SUBSTANTIVE_TOOLS,
  [EditorialMove.Compare]: SUBSTANTIVE_TOOLS,
  [EditorialMove.Contrast]: SUBSTANTIVE_TOOLS,
  [EditorialMove.Connect]: SUBSTANTIVE_TOOLS,
  [EditorialMove.Reframe]: SUBSTANTIVE_TOOLS_WITH_PARAPHRASE,
  [EditorialMove.Humanise]: SUBSTANTIVE_TOOLS,
  [EditorialMove.FindMeaning]: SUBSTANTIVE_TOOLS,
  [EditorialMove.Transition]: SUBSTANTIVE_TOOLS,
  [EditorialMove.Question]: Object.freeze([
    SpeakerAgentToolName.SHORT_QUESTION,
  ]),
  [EditorialMove.Challenge]: CHALLENGE_TOOLS,
  [EditorialMove.React]: SHORT_REACTION_TOOLS,
  [EditorialMove.Summarise]: Object.freeze([
    SpeakerAgentToolName.SUMMARIZE,
  ]),
});

/** Chooses response tools from role and conversational obligation, not turn length. */
export class ResponseModePolicy {
  constructor(
    private readonly roleProfileResolver = new SpeakerRoleProfileResolver()
  ) {}

  selectTools(context: ResponseModeContext): SpeakerAgentToolName[] {
    if (context.forceColdOpen) {
      return [SpeakerAgentToolName.COLD_OPEN];
    }
    if (context.isFinalTurn) {
      return [SpeakerAgentToolName.CLOSING_STATEMENT];
    }
    if (context.forceNearlyOutOfTime) {
      return [SpeakerAgentToolName.NEARLY_OUT_OF_TIME];
    }
    const offersSummaryAlongsideBrief =
      context.requestSummary &&
      (!context.turnBrief ||
        !MOVES_THAT_MUST_NOT_BECOME_SUMMARIES.includes(context.turnBrief.move));

    if (context.isSolo) {
      return offersSummaryAlongsideBrief
        ? [SpeakerAgentToolName.SUMMARIZE, ...SOLO_TOOLS]
        : [...SOLO_TOOLS];
    }

    const profile = this.roleProfileResolver.resolve(context.speaker);
    let selected: SpeakerAgentToolName[];
    if (
      this.getObligation(context.speeches, context.speaker) ===
      ConversationalObligation.AnswerChallenge
    ) {
      selected = [...CHALLENGE_RESPONSE_TOOLS];
    } else if (
      profile.epistemicRole === EpistemicRole.Expert &&
      this.getObligation(context.speeches, context.speaker) ===
        ConversationalObligation.AnswerQuestion
    ) {
      selected = [...EXPERT_ANSWER_TOOLS];
    } else if (
      context.turnBrief &&
      MOVE_TO_TOOLS[context.turnBrief.move] !== undefined
    ) {
      selected = [...MOVE_TO_TOOLS[context.turnBrief.move]!];
      if (
        profile.epistemicRole === EpistemicRole.Expert &&
        selected.includes(SpeakerAgentToolName.SPEAK)
      ) {
        selected.unshift(SpeakerAgentToolName.EXPLAIN);
      }
    } else {
      selected =
        profile.epistemicRole === EpistemicRole.Expert
          ? [...EXPERT_DEFAULT_TOOLS]
          : [...INTERVIEWER_TOOLS];
    }

    if (
      offersSummaryAlongsideBrief &&
      !selected.includes(SpeakerAgentToolName.SUMMARIZE)
    ) {
      selected.unshift(SpeakerAgentToolName.SUMMARIZE);
    }
    return selected;
  }

  private getObligation(
    speeches: Speech[],
    speaker: Speaker
  ): ConversationalObligation {
    const previousSpeech = speeches.at(-1);
    if (
      previousSpeech?.tool === SpeakerAgentToolName.CHALLENGE &&
      previousSpeech.speaker.id !== speaker.id
    ) {
      return ConversationalObligation.AnswerChallenge;
    }
    if (
      previousSpeech?.tool === SpeakerAgentToolName.SHORT_QUESTION ||
      previousSpeech?.message.trim().endsWith(QUESTION_MARK)
    ) {
      return ConversationalObligation.AnswerQuestion;
    }
    return ConversationalObligation.ExecuteBrief;
  }
}
