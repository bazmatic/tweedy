import {
  AudienceProfile,
  AudienceValue,
  BeatPurpose,
  ConversationBeat,
  DiscussionPoint,
  EditorialCard,
  EditorialMove,
  EnergyLevel,
  EpistemicRole,
  IDirectorAgent,
  IMaterialPreparer,
  ITurnReviewer,
  PodcastScript,
  Speaker,
  Speech,
  TurnBrief,
} from '../types';
import { BaseAgent } from './BaseAgent';
import { MaterialPreparerAgent } from './MaterialPreparerAgent';
import { ConversationRhythmPolicy } from './ConversationRhythmPolicy';
import { TurnReviewerAgent } from './TurnReviewerAgent';
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
import { ConversationBeatInput } from './editorial-tools';
import { SpeakerRolePolicy } from './SpeakerRolePolicy';
import { SpeechRevisionPolicy } from './SpeechRevisionPolicy';
import { SpeakerRoleProfileResolver } from './SpeakerRoleProfileResolver';
import { DialogueCadencePolicy } from './DialogueCadencePolicy';
import { AudienceAccessibilityPolicy } from './AudienceAccessibilityPolicy';
import { EpisodeConclusionPolicy } from './EpisodeConclusionPolicy';
import { ModelTask } from '../providers/ModelRoutingPolicy';

const WORDS_PER_MINUTE = 150;
const MINUTES_PER_DISCUSSION_POINT = 2;
const MAX_PLAN_TOKENS = 5000;
const MAX_TURN_DIRECTION_TOKENS = 600;
const DOMINANT_SPEAKER_SHARE_THRESHOLD = 0.55;
const MIN_SPEECHES_FOR_BALANCE_CHECK = 3;

export class DirectorAgent extends BaseAgent implements IDirectorAgent {
  private script: PodcastScript;
  private podcastPlan: string = '';
  private maxTurns: number;
  private maxDuration: number;
  private turnsUsed = 0;
  private hasForcedTimeWarning = false;
  private points: DiscussionPoint[] = [];
  private materialPreparer: IMaterialPreparer;
  private turnReviewer: ITurnReviewer;
  private rhythmPolicy: ConversationRhythmPolicy;
  private speakerRolePolicy: SpeakerRolePolicy;
  private speechRevisionPolicy: SpeechRevisionPolicy;
  private roleProfileResolver: SpeakerRoleProfileResolver;
  private dialogueCadencePolicy: DialogueCadencePolicy;
  private audienceAccessibilityPolicy: AudienceAccessibilityPolicy;
  private episodeConclusionPolicy: EpisodeConclusionPolicy;

  constructor(
    script: PodcastScript,
    budget: { maxTurns: number; maxDuration: number },
    dependencies: {
      materialPreparer?: IMaterialPreparer;
      turnReviewer?: ITurnReviewer;
      rhythmPolicy?: ConversationRhythmPolicy;
      speakerRolePolicy?: SpeakerRolePolicy;
      speechRevisionPolicy?: SpeechRevisionPolicy;
      roleProfileResolver?: SpeakerRoleProfileResolver;
      dialogueCadencePolicy?: DialogueCadencePolicy;
      audienceAccessibilityPolicy?: AudienceAccessibilityPolicy;
      episodeConclusionPolicy?: EpisodeConclusionPolicy;
    } = {}
  ) {
    super();
    this.script = script;
    this.maxTurns = budget.maxTurns;
    this.maxDuration = budget.maxDuration;
    this.materialPreparer =
      dependencies.materialPreparer ?? new MaterialPreparerAgent();
    this.turnReviewer = dependencies.turnReviewer ?? new TurnReviewerAgent();
    this.rhythmPolicy =
      dependencies.rhythmPolicy ?? new ConversationRhythmPolicy();
    this.speakerRolePolicy =
      dependencies.speakerRolePolicy ?? new SpeakerRolePolicy();
    this.speechRevisionPolicy =
      dependencies.speechRevisionPolicy ?? new SpeechRevisionPolicy();
    this.roleProfileResolver =
      dependencies.roleProfileResolver ?? new SpeakerRoleProfileResolver();
    this.dialogueCadencePolicy =
      dependencies.dialogueCadencePolicy ?? new DialogueCadencePolicy();
    this.audienceAccessibilityPolicy =
      dependencies.audienceAccessibilityPolicy ??
      new AudienceAccessibilityPolicy();
    this.episodeConclusionPolicy =
      dependencies.episodeConclusionPolicy ?? new EpisodeConclusionPolicy();
  }

  async createPodcastPlan(): Promise<string> {
    try {
      this.logAgentAction('Creating podcast plan');

      const preparedMaterials = await Promise.all(
        this.script.materials.map((material) =>
          this.materialPreparer.prepare(material, {
            title: this.script.title,
            description: this.script.description,
          })
        )
      );
      this.script.editorialCards = preparedMaterials.flatMap(
        (prepared) => prepared.cards
      );
      const materialText = this.script.materials
        .map((material, index) => {
          const prepared = preparedMaterials[index];
          const cards = prepared.cards
            .map((card) => `- ${card.id} [${card.kind}]: ${card.content}`)
            .join('\n');
          return `${material.title}: ${prepared.synopsis}\n${cards}`;
        })
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

Available prepared materials:
${materialText || '(No source materials were supplied.)'}

Create a detailed plan for how the conversation should flow, including:
1. Opening segment — a warm, friendly welcome where the interviewer greets listeners, introduces the episode by name ("${this.script.title}"), and introduces the speakers, before any points are mentioned. After naming the speakers, the speaker must stop and let them respond.
2. Main discussion points
3. Key topics to cover
4. Closing segment

Design a listener journey rather than a list of facts. Balance understanding,
entertainment, insight and conversational momentum. Use stories, examples,
vivid details, surprises, tensions, different perspectives and takeaways only
when the prepared material supports them. Do not force scientific analysis or
formal tests onto topics that do not call for them. Use Australian/British
spelling.

Also provide a separate list of at least ${minDiscussionPoints} concrete discussion points that must be covered during the episode (roughly one per ${MINUTES_PER_DISCUSSION_POINT} minutes of runtime) — short, discrete phrases rather than full sentences, since they'll be tracked individually as the conversation progresses.

Also provide a sequence of conversation beats. Each beat must have a listener-centred purpose and goal, suitable energy, useful prepared card ids and realistic target turn count. Vary the beat purposes so the episode has shape rather than becoming a run of explanations.`,
        }
      ];

      const tools = [toCreatePodcastPlanTool()];
      const { narrative, points, beats } = await this.callModelForToolInput<CreatePodcastPlanInput>(
        ModelTask.EpisodePlanning,
        messages,
        tools,
        MAX_PLAN_TOKENS
      );

      this.podcastPlan = narrative ?? '';
      this.points = (points ?? []).map((text, index) => ({
        id: `p${index + 1}`,
        text,
        covered: false,
      }));
      this.script.discussionPoints = this.points;
      this.script.conversationBeats = this.toConversationBeats(
        beats,
        this.points
      );

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
    turnBrief: TurnBrief;
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
      const balanceNote = this.getBalanceNote(script);
      const rhythmNote = this.getRhythmNote(script);
      const editorialSection = this.getEditorialSection(script);

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
              this.roleProfileResolver.resolve(speaker).epistemicRole
            }): ${speaker.personality}`
        )
        .join('\n');

      const messages = [
        {
          role: 'user' as const,
          content: `You are directing a podcast. Here's the current situation:

Podcast Plan: ${this.podcastPlan}

Progress: ${progress}% complete${openPointsSection}${editorialSection}

Speakers:
${speakerDescriptions}

Conversation so far (each line tagged with the tool used to deliver it — "speak" is substantive content; "interject", "filler_comment", "one_liner", and "short_question" are brief reactions, not real answers or new points):
${history || '(nothing said yet — this is the opening of the episode)'}

Decide which speaker should talk next and give them clear direction. Also choose a subject-neutral editorial move, the primary audience value, desired energy, relevant beat and prepared card ids. Every turn should help the listener understand, entertain them, reveal something meaningful, create connection, or move the conversation forwards; it need not do all of these. Don't force analysis onto a story or humour onto an explanation. Don't mistake a brief reaction tag (interject/filler_comment/one_liner/short_question) for a substantive point — if the last speaker only reacted, direct the next speaker to actually answer or continue, not to react to the reaction. A challenge creates a right of reply: direct the speaker who was challenged to respond before the challenger speaks again. Respect the chronological order shown above; a remark made before a challenge cannot be described as a response to that challenge. On the opening of the episode (nothing said yet), this must be the interviewer, and the direction must have them deliver a warm, friendly welcome to listeners — greeting them, naming the episode ("${this.script.title}"), and introducing the speakers by name — before moving into substantive content. Don't repeat this welcome on later turns. Mark genuinely completed beat ids in coveredBeatIds. If the open discussion points list above shows points already addressed by recent turns, mark their ids in coveredPointIds — only mark a point covered if it was explicitly and substantively discussed with specific detail from the point's text, not merely a topically-adjacent mention (e.g. mentioning an oxygen tank explosion does NOT cover a point about a CO2 scrubber duct-tape hack). Use Australian/British spelling.${this.getPacingNote(
            script
          )}${wrapUpNote}${velocityNote}${balanceNote}${rhythmNote}${this.speakerRolePolicy.buildDirectorGuidance(script)}${this.audienceAccessibilityPolicy.buildDirectorGuidance(script.audienceProfile ?? AudienceProfile.General)}`
        }
      ];

      const tools = [toSelectNextSpeakerTool(script.speakers)];
      const result =
        await this.callModelForToolInput<SelectNextSpeakerInput>(
          ModelTask.DirectionSelection,
          messages,
          tools,
          MAX_TURN_DIRECTION_TOKENS
        );
      const { speakerId, direction, coveredPointIds } = result;

      const confirmedPointIds = await this.verifyCoveredPoints(
        coveredPointIds,
        script
      );
      this.applyCoveredPoints(confirmedPointIds);
      this.applyCoveredBeats(result.coveredBeatIds);
      const velocityAfterThisTurn = this.calculateVelocity(script);
      this.logVelocity(velocityAfterThisTurn);
      const requestSummary =
        velocityAfterThisTurn.paceStatus === 'behind' &&
        velocityAfterThisTurn.openCount >= 2;
      const turnBrief = this.toTurnBrief(result, direction);

      const proposedSpeaker = script.speakers.find((s) => s.id === speakerId);
      const fallback = proposedSpeaker ?? this.fallbackSpeaker(script);
      if (!proposedSpeaker) {
        logger.warn(
          `Director chose unknown speakerId "${speakerId}"; falling back to alternating speaker`
        );
      }

      const roleAssignment = this.speakerRolePolicy.repairAssignment(
        script,
        fallback,
        { ...turnBrief, speakerId: fallback.id },
        direction
      );
      if (roleAssignment.repaired) {
        logger.info(
          `Repaired role-inconsistent turn assignment (${roleAssignment.repairReason})`
        );
      }
      const assignment = this.dialogueCadencePolicy.repairAssignment(
        script,
        roleAssignment
      );
      if (assignment.cadenceRepairReason) {
        logger.info(
          `Repaired repetitive dialogue cadence (${assignment.cadenceRepairReason})`
        );
      }

      logger.debug(
        `Director chose ${assignment.speaker.name}: ${assignment.direction}`
      );
      return {
        speaker: assignment.speaker,
        direction: assignment.direction,
        timeStatus: wrapUpNote,
        forceNearlyOutOfTime,
        requestSummary,
        isFinalTurn,
        turnBrief: assignment.turnBrief,
      };
    } catch (error) {
      logger.error('Failed to choose next speaker:', error);
      throw error;
    }
  }

  /**
   * True once all discussion points are covered, the final persisted turn is
   * a dedicated closing statement, and the model agrees that the words form a
   * natural conclusion. Summaries and time warnings cannot end the episode.
   */
  async isConversationComplete(script: PodcastScript): Promise<boolean> {
    if (this.points.length === 0 || this.points.some((point) => !point.covered)) {
      return false;
    }
    if (!this.episodeConclusionPolicy.hasFinalSignOff(script)) {
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
          ModelTask.ConclusionCheck,
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
   * Delegates review to the intent-aware reviewer. A story is judged as a
   * story, a reaction as a reaction, and factual claims remain grounded.
   * Review fails open so production can continue if the model is unavailable.
   */
  async reviewSpeech(
    speech: Speech,
    direction: string,
    turnBrief = this.defaultTurnBrief(speech.speaker.id, direction),
    editorialCards: EditorialCard[] = this.script.editorialCards ?? [],
    recentSpeeches: Speech[] = this.script.speeches
  ): Promise<Speech> {
    try {
      const review = await this.turnReviewer.review(
        speech,
        turnBrief,
        editorialCards,
        recentSpeeches,
        this.script.knowledgeLedger,
        this.script.audienceProfile,
        this.script.terminologyLedger
      );
      if (
        !review.accepted &&
        review.revisedMessage &&
        this.speechRevisionPolicy.isUsable(review.revisedMessage)
      ) {
        const revisedSpeech = {
          ...speech,
          message: review.revisedMessage,
          turnBrief,
        };
        const revisedReview = await this.turnReviewer.review(
          revisedSpeech,
          turnBrief,
          editorialCards,
          recentSpeeches,
          this.script.knowledgeLedger,
          this.script.audienceProfile,
          this.script.terminologyLedger
        );
        if (!revisedReview.accepted) {
          logger.warn(
            `Turn reviewer rejected its revision for ${speech.speaker.name}; keeping the original speech`
          );
          return { ...speech, turnBrief, review };
        }
        logger.info(
          `Turn reviewer revised ${speech.speaker.name}'s speech for editorial fit`
        );
        return {
          ...revisedSpeech,
          review: revisedReview,
        };
      }
      return { ...speech, turnBrief, review };
    } catch (error) {
      logger.error('Failed to review turn; keeping original:', error);
      return { ...speech, turnBrief };
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
          ModelTask.CoverageVerification,
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

  private applyCoveredBeats(coveredBeatIds?: string[]): void {
    if (!coveredBeatIds || coveredBeatIds.length === 0) return;
    for (const beat of this.script.conversationBeats ?? []) {
      if (coveredBeatIds.includes(beat.id) && !beat.covered) {
        beat.covered = true;
        beat.coveredAtTurn = this.turnsUsed;
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

  /**
   * Flags when a non-expert speaker has taken a disproportionate share of
   * words so far, so the director can steer the next pick toward others.
   * Experts are exempt — they're expected to carry substantive explaining.
   */
  private getBalanceNote(script: PodcastScript): string {
    if (
      script.speakers.length < 2 ||
      script.speeches.length < MIN_SPEECHES_FOR_BALANCE_CHECK
    ) {
      return '';
    }

    const wordCounts = new Map<string, number>();
    let totalWords = 0;
    for (const speech of script.speeches) {
      const words = speech.message.trim().split(/\s+/).filter(Boolean).length;
      wordCounts.set(
        speech.speaker.id,
        (wordCounts.get(speech.speaker.id) ?? 0) + words
      );
      totalWords += words;
    }
    if (totalWords === 0) {
      return '';
    }

    for (const speaker of script.speakers) {
      if (
        this.roleProfileResolver.resolve(speaker).epistemicRole ===
        EpistemicRole.Expert
      ) {
        continue;
      }
      const share = (wordCounts.get(speaker.id) ?? 0) / totalWords;
      if (share > DOMINANT_SPEAKER_SHARE_THRESHOLD) {
        return ` ${speaker.name} has dominated the conversation so far (${Math.round(
          share * 100
        )}% of words spoken) — favour other speakers for the next turn unless the next point specifically calls for ${speaker.name}'s input.`;
      }
    }

    return '';
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

  private toConversationBeats(
    inputs: ConversationBeatInput[] | undefined,
    points: DiscussionPoint[]
  ): ConversationBeat[] {
    if (!inputs || inputs.length === 0) {
      return points.map((point, index) => ({
        id: `b${index + 1}`,
        purpose: BeatPurpose.Explore,
        goal: point.text,
        cardIds: [],
        prerequisiteBeatIds: index === 0 ? [] : [`b${index}`],
        desiredEnergy: EnergyLevel.Curious,
        targetTurns: 2,
        covered: false,
      }));
    }

    return inputs.map((input, index) => ({
      id: `b${index + 1}`,
      purpose: Object.values(BeatPurpose).includes(input.purpose)
        ? input.purpose
        : BeatPurpose.Explore,
      goal: input.goal,
      cardIds: input.cardIds ?? [],
      prerequisiteBeatIds: input.prerequisiteBeatIds ?? [],
      desiredEnergy:
        input.desiredEnergy &&
        Object.values(EnergyLevel).includes(input.desiredEnergy)
          ? input.desiredEnergy
          : EnergyLevel.Curious,
      targetTurns: Math.max(1, input.targetTurns ?? 1),
      covered: false,
    }));
  }

  private toTurnBrief(
    input: SelectNextSpeakerInput,
    direction: string
  ): TurnBrief {
    return {
      speakerId: input.speakerId,
      beatId: input.beatId,
      goal: input.goal ?? direction,
      move:
        input.move && Object.values(EditorialMove).includes(input.move)
          ? input.move
          : EditorialMove.Explain,
      cardIds: input.cardIds ?? [],
      audienceValue:
        input.audienceValue &&
        Object.values(AudienceValue).includes(input.audienceValue)
          ? input.audienceValue
          : AudienceValue.Understanding,
      desiredEnergy:
        input.desiredEnergy &&
        Object.values(EnergyLevel).includes(input.desiredEnergy)
          ? input.desiredEnergy
          : EnergyLevel.Curious,
      device: input.device,
    };
  }

  private defaultTurnBrief(speakerId: string, direction: string): TurnBrief {
    return {
      speakerId,
      goal: direction,
      move: EditorialMove.Explain,
      cardIds: [],
      audienceValue: AudienceValue.Understanding,
      desiredEnergy: EnergyLevel.Curious,
    };
  }

  private getEditorialSection(script: PodcastScript): string {
    const beats = (script.conversationBeats ?? []).filter(
      (beat) => !beat.covered
    );
    const cards = script.editorialCards ?? [];
    if (beats.length === 0 && cards.length === 0) return '';

    const beatText = beats
      .map(
        (beat) =>
          `- ${beat.id} [${beat.purpose}, ${beat.desiredEnergy}]: ${beat.goal}`
      )
      .join('\n');
    const cardText = cards
      .slice(0, 20)
      .map((card) => `- ${card.id} [${card.kind}]: ${card.content}`)
      .join('\n');
    return `\n\nOpen conversation beats:\n${beatText || '(none)'}\n\nPrepared editorial cards:\n${cardText || '(none)'}`;
  }

  private getRhythmNote(script: PodcastScript): string {
    const recommendation = this.rhythmPolicy.recommend(script.speeches);
    if (!recommendation) return '';
    return ` Rhythm guidance: ${recommendation.reason} Prefer ${recommendation.preferredMoves.join(
      ', '
    )}; avoid ${recommendation.avoidedMoves.join(', ')}.`;
  }

  private getConversationHistory(script: PodcastScript): string {
    return script.speeches
      .slice(-5) // Last 5 speeches
      .map(speech => `${speech.speaker.name}: ${speech.message} [${speech.tool ?? 'unknown'}]`)
      .join('\n');
  }
}
