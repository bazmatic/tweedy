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
  turnBrief?: TurnBrief;
}

const QUESTION_MARK = "?";

const EXPERT_DEFAULT_TOOLS = Object.freeze([
  SpeakerAgentToolName.SPEAK,
  SpeakerAgentToolName.QUOTE,
  SpeakerAgentToolName.CHALLENGE,
  SpeakerAgentToolName.ONE_LINER,
]);

const EXPERT_ANSWER_TOOLS = Object.freeze([
  SpeakerAgentToolName.SPEAK,
  SpeakerAgentToolName.QUOTE,
]);

const SUBSTANTIVE_TOOLS = Object.freeze([
  SpeakerAgentToolName.SPEAK,
  SpeakerAgentToolName.ONE_LINER,
]);

const CHALLENGE_TOOLS = Object.freeze([
  SpeakerAgentToolName.CHALLENGE,
  SpeakerAgentToolName.SPEAK,
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
  [EditorialMove.Reframe]: SUBSTANTIVE_TOOLS,
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
    if (context.isFinalTurn) {
      return [SpeakerAgentToolName.CLOSING_STATEMENT];
    }
    if (context.forceNearlyOutOfTime) {
      return [SpeakerAgentToolName.NEARLY_OUT_OF_TIME];
    }
    if (context.requestSummary) {
      return [SpeakerAgentToolName.SUMMARIZE];
    }
    if (context.isSolo) return [...SOLO_TOOLS];

    const profile = this.roleProfileResolver.resolve(context.speaker);
    if (
      profile.epistemicRole === EpistemicRole.Expert &&
      this.getObligation(context.speeches) ===
        ConversationalObligation.AnswerQuestion
    ) {
      return [...EXPERT_ANSWER_TOOLS];
    }

    if (context.turnBrief) {
      const tools = MOVE_TO_TOOLS[context.turnBrief.move];
      if (tools) return [...tools];
    }

    return profile.epistemicRole === EpistemicRole.Expert
      ? [...EXPERT_DEFAULT_TOOLS]
      : [...INTERVIEWER_TOOLS];
  }

  private getObligation(speeches: Speech[]): ConversationalObligation {
    const previousSpeech = speeches.at(-1);
    if (
      previousSpeech?.tool === SpeakerAgentToolName.SHORT_QUESTION ||
      previousSpeech?.message.trim().endsWith(QUESTION_MARK)
    ) {
      return ConversationalObligation.AnswerQuestion;
    }
    return ConversationalObligation.ExecuteBrief;
  }
}
