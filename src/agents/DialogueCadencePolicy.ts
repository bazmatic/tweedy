import {
  AudienceValue,
  EditorialMove,
  EpistemicRole,
  KnowledgeSource,
  PodcastScript,
} from "../types";
import { SpeakerAgentToolName } from "./speaker-tools";
import { RoleAssignment } from "./SpeakerRolePolicy";
import { SpeakerRoleProfileResolver } from "./SpeakerRoleProfileResolver";

export enum CadenceRepairReason {
  ConsecutiveExpertExplanation = "consecutive_expert_explanation",
  ChallengeRequiresResponse = "challenge_requires_response",
  QuestionRequiresResponse = "question_requires_response",
  ResumeAfterBackchannel = "resume_after_backchannel",
}

export interface CadenceAssignment extends RoleAssignment {
  cadenceRepairReason?: CadenceRepairReason;
}

const SUBSTANTIVE_TOOLS = Object.freeze([
  SpeakerAgentToolName.SPEAK,
  SpeakerAgentToolName.SUMMARIZE,
  SpeakerAgentToolName.EXPLAIN,
]);

const BACKCHANNEL_TOOLS = Object.freeze([
  SpeakerAgentToolName.INTERJECT,
  SpeakerAgentToolName.FILLER_COMMENT,
]);

const RESUMABLE_TOOLS = Object.freeze([
  SpeakerAgentToolName.SPEAK,
  SpeakerAgentToolName.EXPLAIN,
]);

/** Prevents role enforcement from turning a two-speaker conversation into an expert monologue. */
export class DialogueCadencePolicy {
  constructor(
    private readonly roleProfileResolver = new SpeakerRoleProfileResolver()
  ) {}

  repairAssignment(
    script: PodcastScript,
    assignment: RoleAssignment
  ): CadenceAssignment {
    const lastSpeech = script.speeches.at(-1);
    const interruptedSpeech = script.speeches.at(-2);
    const isBackchannel =
      lastSpeech?.tool !== undefined &&
      BACKCHANNEL_TOOLS.includes(lastSpeech.tool);
    const isResumable =
      interruptedSpeech?.tool !== undefined &&
      RESUMABLE_TOOLS.includes(interruptedSpeech.tool) &&
      interruptedSpeech.speaker.id !== lastSpeech?.speaker.id;
    if (
      isBackchannel &&
      isResumable &&
      interruptedSpeech &&
      assignment.speaker.id !== interruptedSpeech.speaker.id
    ) {
      return {
        ...assignment,
        speaker: interruptedSpeech.speaker,
        direction: `${lastSpeech.speaker.name} just reacted briefly — you still have the floor. Continue the thought you were developing ("${interruptedSpeech.message.slice(-80)}") from where you left off, without restarting or re-summarising it. Then continue this goal: ${assignment.turnBrief.goal}`,
        turnBrief: {
          ...assignment.turnBrief,
          speakerId: interruptedSpeech.speaker.id,
          knowledgeSource: KnowledgeSource.Conversation,
        },
        repaired: true,
        cadenceRepairReason: CadenceRepairReason.ResumeAfterBackchannel,
      };
    }

    // A forced interjection (backchannel) can land between a question/
    // challenge and the Director's next call, shifting speeches.at(-1) away
    // from the turn these checks actually care about. Skip past a trailing
    // backchannel turn so it doesn't hide an unanswered question/challenge.
    const previousIndex = this.lastNonBackchannelIndex(script);
    const previousSpeech = previousIndex >= 0 ? script.speeches[previousIndex] : undefined;
    const challengedSpeech =
      previousIndex >= 1 ? script.speeches[previousIndex - 1] : undefined;
    if (
      previousSpeech?.tool === SpeakerAgentToolName.CHALLENGE &&
      challengedSpeech &&
      challengedSpeech.speaker.id !== previousSpeech.speaker.id &&
      assignment.speaker.id !== challengedSpeech.speaker.id
    ) {
      return {
        ...assignment,
        speaker: challengedSpeech.speaker,
        direction: `Respond directly to ${previousSpeech.speaker.name}'s challenge before moving the conversation on. Preserve your established position, acknowledge any fair nuance, and then continue this goal: ${assignment.turnBrief.goal}`,
        turnBrief: {
          ...assignment.turnBrief,
          speakerId: challengedSpeech.speaker.id,
          move: EditorialMove.React,
          cardIds: [],
          audienceValue: AudienceValue.Momentum,
          knowledgeSource: KnowledgeSource.Conversation,
        },
        repaired: true,
        cadenceRepairReason: CadenceRepairReason.ChallengeRequiresResponse,
      };
    }

    const repeatsQuestioner =
      previousSpeech?.tool === SpeakerAgentToolName.SHORT_QUESTION &&
      previousSpeech.speaker.id === assignment.speaker.id;
    if (repeatsQuestioner) {
      const respondent =
        script.speakers.find(
          (speaker) =>
            speaker.id !== previousSpeech.speaker.id &&
            this.roleProfileResolver.resolve(speaker).epistemicRole ===
              EpistemicRole.Expert
        ) ??
        script.speakers.find(
          (speaker) => speaker.id !== previousSpeech.speaker.id
        );

      if (respondent) {
        const respondentIsExpert =
          this.roleProfileResolver.resolve(respondent).epistemicRole ===
          EpistemicRole.Expert;
        return {
          ...assignment,
          speaker: respondent,
          direction: `Answer ${previousSpeech.speaker.name}'s question directly before moving the conversation on: "${previousSpeech.message}"`,
          turnBrief: {
            ...assignment.turnBrief,
            speakerId: respondent.id,
            goal: `Answer ${previousSpeech.speaker.name}'s question for the listener.`,
            move: respondentIsExpert
              ? EditorialMove.Explain
              : EditorialMove.React,
            cardIds: [],
            audienceValue: AudienceValue.Understanding,
            knowledgeSource: KnowledgeSource.Conversation,
          },
          repaired: true,
          cadenceRepairReason: CadenceRepairReason.QuestionRequiresResponse,
        };
      }
    }

    // Deliberately uses the raw last speech (not the backchannel-skipping
    // lookback above): a director resuming the same expert right after their
    // own backchannel reaction is one continuous turn, not a second
    // consecutive substantive turn, so it should not trigger this repair.
    const rawPreviousSpeech = script.speeches.at(-1);
    const assignedProfile = this.roleProfileResolver.resolve(
      assignment.speaker
    );
    const repeatsSubstantiveExpert =
      rawPreviousSpeech?.speaker.id === assignment.speaker.id &&
      assignedProfile.epistemicRole === EpistemicRole.Expert &&
      rawPreviousSpeech.tool !== undefined &&
      SUBSTANTIVE_TOOLS.includes(rawPreviousSpeech.tool);
    if (!repeatsSubstantiveExpert) return assignment;

    const audienceGuide = script.speakers.find(
      (speaker) =>
        speaker.id !== assignment.speaker.id &&
        this.roleProfileResolver.resolve(speaker).epistemicRole !==
          EpistemicRole.Expert
    );
    if (!audienceGuide) return assignment;

    return {
      ...assignment,
      speaker: audienceGuide,
      direction: `Ask ${assignment.speaker.name} one concise listener-centred question that opens the next part of this goal without stating the answer yourself: ${assignment.turnBrief.goal}`,
      turnBrief: {
        ...assignment.turnBrief,
        speakerId: audienceGuide.id,
        move: EditorialMove.Question,
        cardIds: [],
        audienceValue: AudienceValue.Momentum,
        knowledgeSource: KnowledgeSource.Conversation,
      },
      repaired: true,
      cadenceRepairReason: CadenceRepairReason.ConsecutiveExpertExplanation,
    };
  }

  private lastNonBackchannelIndex(script: PodcastScript): number {
    for (let i = script.speeches.length - 1; i >= 0; i--) {
      const tool = script.speeches[i].tool;
      if (tool !== undefined && BACKCHANNEL_TOOLS.includes(tool)) continue;
      return i;
    }
    return -1;
  }
}
