import { DiscussionPoint, IDirectorAgent, PodcastScript, Speaker } from '../types';
import { BaseAgent } from './BaseAgent';
import { MaterialSummarizerAgent } from './MaterialSummarizerAgent';
import { logger } from '../utils/logger';
import {
  CheckConversationCompleteInput,
  CreatePodcastPlanInput,
  SelectNextSpeakerInput,
  VerifyCoveredPointsInput,
  toCheckConversationCompleteTool,
  toCreatePodcastPlanTool,
  toSelectNextSpeakerTool,
  toVerifyCoveredPointsTool,
} from './director-tools';

const WORDS_PER_MINUTE = 150;
const MINUTES_PER_DISCUSSION_POINT = 2;

export class DirectorAgent extends BaseAgent implements IDirectorAgent {
  private script: PodcastScript;
  private podcastPlan: string = '';
  private maxTurns: number;
  private maxDuration: number;
  private turnsUsed = 0;
  private hasForcedTimeWarning = false;
  private points: DiscussionPoint[] = [];
  private materialSummarizer = new MaterialSummarizerAgent();

  constructor(
    script: PodcastScript,
    budget: { maxTurns: number; maxDuration: number }
  ) {
    super();
    this.script = script;
    this.maxTurns = budget.maxTurns;
    this.maxDuration = budget.maxDuration;
  }

  async createPodcastPlan(): Promise<string> {
    try {
      this.logAgentAction('Creating podcast plan');

      const summaries = await Promise.all(
        this.script.materials.map((material) =>
          this.materialSummarizer.summarize(material, {
            title: this.script.title,
            description: this.script.description,
          })
        )
      );
      const materialText = this.script.materials
        .map((material, index) => `${material.title}: ${summaries[index]}`)
        .join('\n\n');

      const durationMinutes = this.maxDuration / 60;
      const minDiscussionPoints = Math.max(
        3,
        Math.round(durationMinutes / MINUTES_PER_DISCUSSION_POINT)
      );

      const messages = [
        {
          role: 'user' as const,
          content: `You are a podcast director. Create a plan for a podcast episode with the following details:

Title: ${this.script.title}
Description: ${this.script.description}
Duration: Approximately ${Math.round(durationMinutes)} minutes, across up to ${this.maxTurns} speaking turns
Speakers: ${this.script.speakers.map(s => s.name).join(', ')}

Available materials:
${materialText}

Create a detailed plan for how the conversation should flow, including:
1. Opening segment
2. Main discussion points
3. Key topics to cover
4. Closing segment

Keep it engaging and natural, with clear direction for each speaker.

Also provide a separate list of at least ${minDiscussionPoints} concrete discussion points that must be covered during the episode (roughly one per ${MINUTES_PER_DISCUSSION_POINT} minutes of runtime) — short, discrete phrases rather than full sentences, since they'll be tracked individually as the conversation progresses.`
        }
      ];

      const tools = [toCreatePodcastPlanTool()];
      const { narrative, points } = await this.callModelForToolInput<CreatePodcastPlanInput>(
        messages,
        tools,
        2000
      );

      this.podcastPlan = narrative ?? '';
      this.points = (points ?? []).map((text, index) => ({
        id: `p${index + 1}`,
        text,
        covered: false,
      }));
      this.script.discussionPoints = this.points;

      logger.info(
        `Podcast plan created successfully with ${this.points.length} discussion points`
      );

      return this.podcastPlan;
    } catch (error) {
      logger.error('Failed to create podcast plan:', error);
      throw error;
    }
  }

  async chooseNextSpeaker(script: PodcastScript): Promise<{
    speaker: Speaker;
    direction: string;
    timeStatus: string;
    forceNearlyOutOfTime: boolean;
    requestSummary: boolean;
    isFinalTurn: boolean;
  }> {
    try {
      this.logAgentAction('Choosing next speaker');

      this.turnsUsed++;
      const progress = this.calculateProgress(script);
      // progress caps at 100 once estimated elapsed speech time reaches
      // maxDuration — treat that the same as hitting the turn ceiling so the
      // episode actually ends instead of dragging on until maxTurns (a
      // generous safety ceiling, not the real pacing signal).
      const isFinalTurn =
        this.turnsUsed >= this.maxTurns || progress >= 100;
      const wrapUpNote = this.getWrapUpNote(progress, isFinalTurn);
      const velocityBeforeThisTurn = this.calculateVelocity(script);
      const velocityNote = this.getVelocityNote(velocityBeforeThisTurn);
      const openPointsSection = this.getOpenPointsSection();

      // Force explicit "we're almost out of time" tool call.
      const forceNearlyOutOfTime = progress >= 85 && !isFinalTurn;
      if (forceNearlyOutOfTime) {
        this.hasForcedTimeWarning = true;
      }

      const history = this.getConversationHistory(script);
      const speakerDescriptions = script.speakers
        .map(
          (speaker) =>
            `- ${speaker.name} (id: ${speaker.id}, ${
              speaker.isExpert ? 'expert' : 'interviewer'
            }): ${speaker.personality}`
        )
        .join('\n');

      const messages = [
        {
          role: 'user' as const,
          content: `You are directing a podcast. Here's the current situation:

Podcast Plan: ${this.podcastPlan}

Progress: ${progress}% complete${openPointsSection}

Speakers:
${speakerDescriptions}

Conversation so far (each line tagged with the tool used to deliver it — "speak" is substantive content; "interject", "filler_comment", "one_liner", and "short_question" are brief reactions, not real answers or new points):
${history || '(nothing said yet — this is the opening of the episode)'}

Decide which speaker should talk next and give them clear direction on what they should talk about and how to make sure that the talking points all get covered in time and that the conversation flows smoothly. Don't mistake a brief reaction tag (interject/filler_comment/one_liner/short_question) for a substantive point — if the last speaker only reacted, direct the next speaker to actually answer or continue, not to react to the reaction. On the opening of the episode, this should usually be the interviewer. If the open discussion points list above shows points already addressed by recent turns, mark their ids in coveredPointIds — only mark a point covered if it was explicitly and substantively discussed with specific detail from the point's text, not merely a topically-adjacent mention (e.g. mentioning an oxygen tank explosion does NOT cover a point about a CO2 scrubber duct-tape hack).${this.getPacingNote(
            script
          )}${wrapUpNote}${velocityNote}`
        }
      ];

      const tools = [toSelectNextSpeakerTool(script.speakers)];
      const { speakerId, direction, coveredPointIds } =
        await this.callModelForToolInput<SelectNextSpeakerInput>(
          messages,
          tools,
          300
        );

      const confirmedPointIds = await this.verifyCoveredPoints(
        coveredPointIds,
        script
      );
      this.applyCoveredPoints(confirmedPointIds);
      const velocityAfterThisTurn = this.calculateVelocity(script);
      this.logVelocity(velocityAfterThisTurn);
      const requestSummary =
        velocityAfterThisTurn.paceStatus === 'behind' &&
        velocityAfterThisTurn.openCount >= 2;

      const speaker = script.speakers.find((s) => s.id === speakerId);
      if (!speaker) {
        logger.warn(
          `Director chose unknown speakerId "${speakerId}"; falling back to alternating speaker`
        );
        return {
          speaker: this.fallbackSpeaker(script),
          direction,
          timeStatus: wrapUpNote,
          forceNearlyOutOfTime,
          requestSummary,
          isFinalTurn,
        };
      }

      logger.debug(`Director chose ${speaker.name}: ${direction}`);
      return {
        speaker,
        direction,
        timeStatus: wrapUpNote,
        forceNearlyOutOfTime,
        requestSummary,
        isFinalTurn,
      };
    } catch (error) {
      logger.error('Failed to choose next speaker:', error);
      throw error;
    }
  }

  /**
   * True once all discussion points are covered AND the model judges the
   * recent speeches show the conversation has actually wrapped up naturally
   * (farewells, sense of closure) rather than just having hit point coverage
   * while still mid-thought. Skips the model call entirely unless every point
   * is covered, since that's a cheap, deterministic prerequisite.
   */
  async isConversationComplete(script: PodcastScript): Promise<boolean> {
    if (this.points.length === 0 || this.points.some((point) => !point.covered)) {
      return false;
    }

    const history = this.getConversationHistory(script);
    const messages = [
      {
        role: 'user' as const,
        content: `All discussion points for this podcast episode have been covered. Judge whether the conversation below has reached a natural, satisfying conclusion — farewells exchanged, an explicit sense of wrap-up or closure — versus the discussion merely having covered its required points while still feeling mid-thought or open-ended.

Recent speech(es):
${history || '(nothing said yet)'}

Return isComplete: true only if the conversation has genuinely wrapped up naturally.`,
      },
    ];

    try {
      const { isComplete } =
        await this.callModelForToolInput<CheckConversationCompleteInput>(
          messages,
          [toCheckConversationCompleteTool()],
          50
        );
      return isComplete;
    } catch (error) {
      logger.error(
        'Failed to judge conversation completeness; continuing production:',
        error
      );
      return false;
    }
  }

  /**
   * The director's coveredPointIds claim comes from the same call that chose
   * the next speaker, and can hallucinate coverage from a merely
   * topically-adjacent mention (e.g. an oxygen tank explosion "covering" a
   * CO2 scrubber duct-tape hack point). Re-check each claim in a dedicated
   * forced tool call against the actual, already-persisted recent speech
   * text before ever marking a point covered.
   */
  private async verifyCoveredPoints(
    coveredPointIds: string[] | undefined,
    script: PodcastScript
  ): Promise<string[] | undefined> {
    if (!coveredPointIds || coveredPointIds.length === 0) {
      return coveredPointIds;
    }

    const candidatePoints = this.points.filter(
      (point) => coveredPointIds.includes(point.id) && !point.covered
    );
    if (candidatePoints.length === 0) {
      return coveredPointIds;
    }

    const recentHistory = this.getConversationHistory(script);
    const pointsList = candidatePoints
      .map((point) => `- ${point.id}: ${point.text}`)
      .join('\n');

    const messages = [
      {
        role: 'user' as const,
        content: `The director claimed the following discussion points were covered by the most recent speech(es) below. Verify each one strictly against the actual text — a point only counts as covered if it was explicitly and substantively discussed with specific detail from the point's text, not merely a topically-adjacent mention. For example, if a point is "CO2 scrubber duct-tape hack" and the speech only mentions an oxygen tank explosion, that point is NOT covered.

Recent speech(es):
${recentHistory || '(nothing said yet)'}

Candidate points claimed as covered:
${pointsList}

Return only the ids of points that were genuinely, substantively covered.`,
      },
    ];

    try {
      const { confirmedPointIds } =
        await this.callModelForToolInput<VerifyCoveredPointsInput>(
          messages,
          [toVerifyCoveredPointsTool()],
          150
        );
      return confirmedPointIds;
    } catch (error) {
      logger.error(
        'Failed to verify covered points; treating claims as unconfirmed:',
        error
      );
      return [];
    }
  }

  private applyCoveredPoints(coveredPointIds?: string[]): void {
    if (!coveredPointIds || coveredPointIds.length === 0) {
      return;
    }
    for (const point of this.points) {
      if (coveredPointIds.includes(point.id) && !point.covered) {
        point.covered = true;
        point.coveredAtTurn = this.turnsUsed;
      }
    }
  }

  /**
   * Compares points-covered-per-minute against points-needed-per-minute to
   * finish the remaining open points within the remaining time budget.
   */
  private calculateVelocity(script: PodcastScript): {
    coveredCount: number;
    openCount: number;
    elapsedMinutes: number;
    remainingMinutes: number;
    paceStatus: 'ahead' | 'on-pace' | 'behind' | 'unknown';
  } {
    if (this.points.length === 0) {
      return {
        coveredCount: 0,
        openCount: 0,
        elapsedMinutes: 0,
        remainingMinutes: 0,
        paceStatus: 'unknown',
      };
    }

    const elapsedSeconds = this.estimateElapsedSeconds(script);
    const elapsedMinutes = elapsedSeconds / 60;
    const remainingMinutes = Math.max(
      (this.maxDuration - elapsedSeconds) / 60,
      0.1
    );
    const coveredCount = this.points.filter((point) => point.covered).length;
    const openCount = this.points.length - coveredCount;

    if (elapsedMinutes <= 0) {
      return {
        coveredCount,
        openCount,
        elapsedMinutes,
        remainingMinutes,
        paceStatus: 'unknown',
      };
    }

    const actualPace = coveredCount / Math.max(elapsedMinutes, 0.1);
    const neededPace = openCount / remainingMinutes;

    let paceStatus: 'ahead' | 'on-pace' | 'behind';
    if (actualPace < neededPace * 0.9) {
      paceStatus = 'behind';
    } else if (actualPace > neededPace * 1.25) {
      paceStatus = 'ahead';
    } else {
      paceStatus = 'on-pace';
    }

    return { coveredCount, openCount, elapsedMinutes, remainingMinutes, paceStatus };
  }

  private getVelocityNote(
    velocity: ReturnType<DirectorAgent['calculateVelocity']>
  ): string {
    if (velocity.paceStatus !== 'behind') {
      return '';
    }

    const openPoints = this.points.filter((point) => !point.covered);
    const openPointsList = openPoints
      .map((point) => `- ${point.id}: ${point.text}`)
      .join('\n');

    return ` The conversation is behind pace on discussion points — ${velocity.openCount} point(s) remain with about ${velocity.remainingMinutes.toFixed(
      1
    )} minutes left. Direct the next speaker to move faster and cover multiple remaining points concisely rather than dwelling on one:\n${openPointsList}`;
  }

  private getOpenPointsSection(): string {
    if (this.points.length === 0) {
      return '';
    }
    const openPoints = this.points.filter((point) => !point.covered);
    if (openPoints.length === 0) {
      return '\n\nAll discussion points have been covered.';
    }
    const list = openPoints
      .map((point) => `- ${point.id}: ${point.text}`)
      .join('\n');
    return `\n\nOpen discussion points (mark any addressed by the last speech(es) via coveredPointIds):\n${list}`;
  }

  private logVelocity(
    velocity: ReturnType<DirectorAgent['calculateVelocity']>
  ): void {
    if (this.points.length === 0) {
      return;
    }
    logger.info(
      `Discussion points: ${velocity.coveredCount}/${this.points.length} covered · ${velocity.elapsedMinutes.toFixed(
        1
      )}/${(this.maxDuration / 60).toFixed(1)} min elapsed · pace: ${velocity.paceStatus}`
    );
  }

  private fallbackSpeaker(script: PodcastScript): Speaker {
    const lastSpeaker = script.speeches[script.speeches.length - 1]?.speaker;
    const eligible = script.speakers.filter((s) => s.id !== lastSpeaker?.id);
    if (eligible.length === 0) {
      return script.speakers[0];
    }
    return eligible[Math.floor(Math.random() * eligible.length)];
  }

  /**
   * Progress toward the estimated spoken duration budget. maxTurns is a
   * separate hard safety ceiling (see getWrapUpNote/forceNearlyOutOfTime),
   * not a pacing signal, so it plays no part in this percentage.
   */
  private calculateProgress(script: PodcastScript): number {
    const durationProgress =
      this.maxDuration > 0
        ? this.estimateElapsedSeconds(script) / this.maxDuration
        : 0;
    return Math.min(100, Math.round(durationProgress * 100));
  }

  private estimateElapsedSeconds(script: PodcastScript): number {
    const totalWords = script.speeches.reduce(
      (sum, speech) =>
        sum + speech.message.trim().split(/\s+/).filter(Boolean).length,
      0
    );
    return (totalWords / WORDS_PER_MINUTE) * 60;
  }

  /**
   * Tells the director to start steering toward a close as the turn/duration
   * budget runs low, and to force a sign-off on the final turn.
   */
  private getWrapUpNote(progress: number, isFinalTurn: boolean): string {
    if (isFinalTurn) {
      return ' This is the final turn of the episode — direct this speaker to deliver a closing statement that wraps up the conversation and signs off naturally.';
    }

    if (progress >= 85) {
      return ' The episode is almost out of time — direct the speakers to wrap up remaining points and head toward a close within the next turn or two, rather than opening new topics.';
    }

    if (progress >= 65) {
      return ' The episode is well past the halfway point of its time budget — start steering the conversation toward wrapping up open topics instead of introducing new ones.';
    }

    return '';
  }

  /**
   * If recent turns have run long, tell the director to call for a short,
   * reactive turn instead of another explanation — keeps the back-and-forth alive.
   */
  private getPacingNote(script: PodcastScript): string {
    const recentSpeeches = script.speeches.slice(-3);
    if (recentSpeeches.length === 0) {
      return '';
    }

    const averageLength =
      recentSpeeches.reduce((sum, speech) => sum + speech.message.length, 0) /
      recentSpeeches.length;

    if (averageLength > 150) {
      return ' The last few turns have been long explanations — direct this speaker to give a short, punchy reaction or a quick pointed question instead of another lengthy point.';
    }

    return '';
  }

  private getConversationHistory(script: PodcastScript): string {
    return script.speeches
      .slice(-5) // Last 5 speeches
      .map(speech => `${speech.speaker.name}: ${speech.message} [${speech.tool ?? 'unknown'}]`)
      .join('\n');
  }
}
