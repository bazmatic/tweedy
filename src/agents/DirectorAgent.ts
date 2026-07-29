import {
  AudienceProfile,
  AudienceValue,
  BeatPurpose,
  ConversationBeat,
  DiscussionPoint,
  DiscussionPointPriority,
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
  AssignSpeakerRolesInput,
  CheckConversationCompleteInput,
  CreatePodcastPlanInput,
  SelectNextSpeakerInput,
  VerifyCoveredPointsInput,
  checkConversationCompleteSchema,
  createAssignSpeakerRolesSchema,
  createPodcastPlanSchema,
  createSelectNextSpeakerSchema,
  verifyCoveredPointsSchema,
  ConversationBeatInput,
} from './director-schemas';
import { SpeakerRolePolicy } from './SpeakerRolePolicy';
import { SpeechRevisionPolicy } from './SpeechRevisionPolicy';
import { SpeakerRoleProfileResolver } from './SpeakerRoleProfileResolver';
import { SpeakerRoleProfileFactory } from './SpeakerRoleProfileFactory';
import { DialogueCadencePolicy } from './DialogueCadencePolicy';
import { AudienceAccessibilityPolicy } from './AudienceAccessibilityPolicy';
import { EpisodeConclusionPolicy } from './EpisodeConclusionPolicy';
import { SpeakerAgentToolName } from './speaker-tools';
import { ModelTask } from '../providers/ModelRoutingPolicy';

const WORDS_PER_MINUTE = 150;
const MINUTES_PER_DISCUSSION_POINT = 1.75;
const MAX_PLAN_TOKENS = 10000;
const MAX_TURN_DIRECTION_TOKENS = 600;
const DOMINANT_SPEAKER_SHARE_THRESHOLD = 0.55;
const MIN_SPEECHES_FOR_BALANCE_CHECK = 3;
const CLOSING_STAGE_PROGRESS_THRESHOLD = 85;
const MAX_LATE_STAGE_TURNS = 2;

export class DirectorAgent extends BaseAgent implements IDirectorAgent {
  private script: PodcastScript;
  private podcastPlan: string = '';
  private maxTurns: number;
  private maxDuration: number;
  private turnsUsed = 0;
  private lateStageTurns = 0;
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
  private guidance?: string;

  constructor(
    script: PodcastScript,
    budget: { maxTurns: number; maxDuration: number },
    guidance?: string,
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
    this.guidance = guidance;
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
      this.script.editorialCards = preparedMaterials
        .flatMap((prepared) => prepared.cards)
        .sort((a, b) => b.storyValue - a.storyValue);
      const materialText = this.script.materials
        .map((material, index) => {
          const prepared = preparedMaterials[index];
          const cards = [...prepared.cards]
            .sort((a, b) => b.storyValue - a.storyValue)
            .map((card) => `- ${card.id} [${card.kind}]: ${card.content}`)
            .join('\n');
          return `${material.title}: ${prepared.synopsis}\n${cards}`;
        })
        .join('\n\n');

      await this.assignSpeakerRoles(materialText);

      const durationMinutes = this.maxDuration / 60;
      const minDiscussionPoints = Math.max(
        3,
        Math.round(durationMinutes / MINUTES_PER_DISCUSSION_POINT)
      );

      const guidanceSection = this.guidance
        ? `\n\nGuidance from the producer for this episode: ${this.guidance}`
        : '';

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
4. Closing segment${guidanceSection}

Design a listener journey rather than a list of facts. Balance understanding,
entertainment, insight and conversational momentum. Use stories, examples,
vivid details, surprises, tensions, different perspectives and takeaways only
when the prepared material supports them. Do not force scientific analysis or
formal tests onto topics that do not call for them. Use Australian/British
spelling.

Also provide a separate list of at least ${minDiscussionPoints} ranked discussion points — editorial opportunities rather than a rigid checklist. For each point provide a short text, priority (essential, supporting, or optional), storyValue from 1-10, and estimatedTurns from 1-6. Essential means the episode would fail its central promise without it; supporting deepens that promise; optional is worthwhile only if time permits. The production team will use this ranking to adapt gracefully to the duration.

Also provide a sequence of conversation beats. Each beat must have a listener-centred purpose and goal, suitable energy, useful prepared card ids, realistic target turn count, and pointIds naming the ranked points it advances (p1, p2, and so on). Vary the beat purposes so the episode has shape rather than becoming a run of explanations.

Also nominate one central analogy — a concrete, physical, everyday comparison for the episode's core concept. Choose something both speakers can return to and extend as new aspects of the topic appear, the way a good explainer keeps one metaphor alive for a whole episode.`,
        }
      ];

      const { narrative, points, beats, centralAnalogy } = await this.callModelForStructuredOutput<CreatePodcastPlanInput>(
        ModelTask.EpisodePlanning,
        messages,
        createPodcastPlanSchema,
        MAX_PLAN_TOKENS
      );

      this.podcastPlan = narrative ?? '';
      this.points = (points ?? []).map((point, index) => {
        const ranked =
          typeof point === 'string'
            ? {
                text: point,
                priority: DiscussionPointPriority.Supporting,
                storyValue: 5,
                estimatedTurns: 2,
              }
            : point;
        return {
          id: `p${index + 1}`,
          text: ranked.text,
          priority: ranked.priority,
          storyValue: ranked.storyValue,
          estimatedTurns: ranked.estimatedTurns,
          covered: false,
        };
      });
      this.script.discussionPoints = this.points;
      this.script.conversationBeats = this.toConversationBeats(
        beats,
        this.points
      );
      this.script.centralAnalogy = centralAnalogy;
      this.script.narrative = this.podcastPlan;

      logger.info(
        `Podcast plan created successfully with ${this.points.length} discussion points`
      );

      return this.podcastPlan;
    } catch (error) {
      logger.error('Failed to create podcast plan:', error);
      throw error;
    }
  }

  /**
   * Casts each speaker's epistemic role fresh for this specific episode,
   * based on their personality and this episode's material — a runtime
   * decision, not a stored property of the speaker. Guarantees at least one
   * speaker is not audience_guide, so an unfamiliar term always has someone
   * eligible to explain it on air.
   */
  private async assignSpeakerRoles(materialText: string): Promise<void> {
    const roleProfileFactory = new SpeakerRoleProfileFactory();
    const speakerDescriptions = this.script.speakers
      .map((speaker) => `- ${speaker.name} (id: ${speaker.id}): ${speaker.personality}`)
      .join('\n');

    let resolvedRoles: EpistemicRole[];
    try {
      const messages = [
        {
          role: 'user' as const,
          content: `You are casting roles for a single podcast episode, not describing a permanent trait of these speakers. For this episode only, decide each speaker's epistemic role based on their personality and the material below.

Speakers:
${speakerDescriptions}

Material:
${materialText || '(No source materials were supplied.)'}

Epistemic roles:
- expert: has full access to the source material and can introduce and explain any technical term or fact directly.
- informed_host: can explain prepared editorial cards handed to them, but not raw source material outright.
- audience_guide: represents the listener — asks questions and reacts, but must not perform specialist explanations.

Default to "informed_host" for any speaker whose personality doesn't say otherwise — podcast hosts are generally well-read and can be assumed knowledgeable about the topics they cover. Only cast a speaker as "audience_guide" when their personality explicitly signals they are a newcomer, layperson, or specifically positioned as the one learning on air; a general description like "curious" or "enthusiastic" is not, by itself, a signal of ignorance. At least one speaker must be "expert" or "informed_host" so unfamiliar terms in the material can actually be explained on air; do not assign every speaker "audience_guide".`,
        },
      ];

      const { assignments } =
        await this.callModelForStructuredOutput<AssignSpeakerRolesInput>(
          ModelTask.EpisodePlanning,
          messages,
          createAssignSpeakerRolesSchema(this.script.speakers),
          1000
        );

      const roleBySpeakerId = new Map(
        assignments.map((assignment) => [assignment.speakerId, assignment.epistemicRole])
      );
      resolvedRoles = this.script.speakers.map(
        (speaker) => roleBySpeakerId.get(speaker.id) ?? EpistemicRole.AudienceGuide
      );
    } catch (error) {
      logger.error(
        'Failed to assign speaker roles; defaulting all speakers to audience_guide (the guarantee below will promote one to informed_host):',
        error
      );
      resolvedRoles = this.script.speakers.map(() => EpistemicRole.AudienceGuide);
    }

    if (!resolvedRoles.some((role) => role !== EpistemicRole.AudienceGuide)) {
      resolvedRoles[0] = EpistemicRole.InformedHost;
    }

    this.script.speakerRoleAssignments = {};
    this.script.speakers.forEach((speaker, index) => {
      const profile = roleProfileFactory.create(resolvedRoles[index]);
      speaker.roleProfile = profile;
      this.script.speakerRoleAssignments![speaker.id] = profile;
    });
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
      if (progress >= CLOSING_STAGE_PROGRESS_THRESHOLD) {
        this.lateStageTurns++;
      }
      // progress caps at 100 once estimated elapsed speech time reaches
      // maxDuration — treat that the same as hitting the turn ceiling so the
      // episode actually ends instead of dragging on until maxTurns (a
      // generous safety ceiling, not the real pacing signal). Likewise, once
      // the director has already nudged the speakers to wrap up once and
      // progress is still in the late-stage zone on a later turn, force the
      // close instead of nudging again — otherwise speakers repeatedly
      // thank listeners and say goodbye without the episode ever ending.
      const isFinalTurn =
        this.turnsUsed >= this.maxTurns ||
        progress >= 100 ||
        this.lateStageTurns >= MAX_LATE_STAGE_TURNS;
      const hasAnnouncedTimePressure = script.speeches.some(
        (speech) =>
          speech.tool === SpeakerAgentToolName.NEARLY_OUT_OF_TIME
      );
      const wrapUpNote = this.getWrapUpNote(
        progress,
        isFinalTurn,
        hasAnnouncedTimePressure
      );
      const velocityBeforeThisTurn = this.calculateVelocity(script);
      const targetPoint = isFinalTurn
        ? undefined
        : this.selectScheduledPoint();
      const velocityNote = this.getVelocityNote(velocityBeforeThisTurn);
      const openPointsSection = this.getOpenPointsSection();
      const balanceNote = this.getBalanceNote(script);
      const rhythmNote = this.getRhythmNote(script);
      const signpostNote = this.getSignpostNote(script);
      const editorialSection = this.getEditorialSection(
        script,
        targetPoint?.id
      );
      const schedulingNote = targetPoint
        ? `\n\nProduction scheduling decision: advance ${targetPoint.id} [${targetPoint.priority ?? DiscussionPointPriority.Supporting}] — ${targetPoint.text}. This target was selected deterministically from the ranked open points. Shape the next turn around it; a brief reaction or necessary answer may bridge into it, but do not substitute a lower-ranked new topic.`
        : '';
      const guidanceNote = this.guidance
        ? ` Keep steering the conversation in line with the producer's guidance for this episode: ${this.guidance}`
        : '';

      // Announce time pressure once. Later turns should shorten and close
      // without repeatedly telling listeners that time is running out.
      const forceNearlyOutOfTime =
        progress >= CLOSING_STAGE_PROGRESS_THRESHOLD &&
        !isFinalTurn &&
        !hasAnnouncedTimePressure;

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

Progress: ${progress}% complete${openPointsSection}${editorialSection}${schedulingNote}

Speakers:
${speakerDescriptions}

Conversation so far (each line tagged with the tool used to deliver it — "speak" is substantive content; "interject", "filler_comment", "one_liner", and "short_question" are brief reactions, not real answers or new points):
${history || '(nothing said yet — this is the opening of the episode)'}

Decide which speaker should talk next. Only give them direction if it's actually needed — a brief goal or topic, not a script. If the conversation is flowing well and the next speaker can naturally carry it forward, leave direction empty rather than inventing something for them to say. When you do give direction, tell them what to address, not what to say; leave the wording, phrasing and specific angle to the speaker so they sound like themselves rather than reciting your lines. Also choose a subject-neutral editorial move, the primary audience value, desired energy, relevant beat and prepared card ids. Every turn should help the listener understand, entertain them, reveal something meaningful, create connection, or move the conversation forwards; it need not do all of these. Don't force analysis onto a story or humour onto an explanation. Don't mistake a brief reaction tag (interject/filler_comment/one_liner/short_question) for a substantive point — if the last speaker only reacted, direct the next speaker to actually answer or continue, not to react to the reaction. A challenge creates a right of reply: direct the speaker who was challenged to respond before the challenger speaks again. A good challenge can open a short segment: after the challenged speaker's first answer, it is fine to let the exchange continue for another turn or two until the objection is genuinely resolved, rather than moving straight to a new point. Respect the chronological order shown above; a remark made before a challenge cannot be described as a response to that challenge. The episode's welcome and speaker introductions are already handled before you are ever consulted — never direct anyone to (re)welcome listeners or (re)introduce themselves or a co-host, no matter how far into the episode this is. Before assigning a goal or direction, check the conversation so far for any fact, comparison, analogy, illustrative example, or question already used — even if worded differently than you'd phrase it — and never direct a speaker to re-explain, re-derive, or re-ask about it; point them toward new ground instead. This applies just as much to a brief handoff (invite, short_question) as to a full explanation: don't reach for an already-settled topic just because the move calls for something short. Choose the beat this proposed turn should advance; beat completion is recorded only after the resulting speech is accepted and reviewed. If the open discussion points list above shows points already addressed by recent turns, mark their ids in coveredPointIds — only mark a point covered if it was explicitly and substantively discussed with specific detail from the point's text, not merely a topically-adjacent mention (e.g. mentioning an oxygen tank explosion does NOT cover a point about a CO2 scrubber duct-tape hack). Use Australian/British spelling.${this.getPacingNote(
            script
          )}${wrapUpNote}${velocityNote}${balanceNote}${rhythmNote}${signpostNote}${guidanceNote}${this.speakerRolePolicy.buildDirectorGuidance(script)}${this.audienceAccessibilityPolicy.buildDirectorGuidance(script.audienceProfile ?? AudienceProfile.General)} Occasionally — at most once every several turns, mid-explanation — assign the trail_off device so a speaker hands an unfinished sentence to their co-host to complete; never assign it on a closing or summary turn. When a speaker is about to open a brand new beat or point the conversation hasn't touched yet, consider assigning them the tease move instead of explain — a short hook rather than the full explanation — so their co-host can naturally invite them to continue; don't use tease for a beat that's already underway.`
        }
      ];

      const result =
        await this.callModelForStructuredOutput<SelectNextSpeakerInput>(
          ModelTask.DirectionSelection,
          messages,
          createSelectNextSpeakerSchema(script.speakers),
          MAX_TURN_DIRECTION_TOKENS
        );
      const { speakerId, coveredPointIds } = result;
      const direction = targetPoint
        ? `${result.direction ?? ''} Advance the scheduled point ${targetPoint.id}: ${targetPoint.text}.`.trim()
        : result.direction ?? '';
      if (result.moveRationale) {
        logger.debug(
          `Director move rationale (${result.move ?? 'unspecified'}): ${result.moveRationale}`
        );
      }

      const confirmedPointIds = await this.verifyCoveredPoints(
        coveredPointIds,
        script
      );
      this.applyCoveredPoints(confirmedPointIds);
      const velocityAfterThisTurn = this.calculateVelocity(script);
      this.logVelocity(velocityAfterThisTurn);
      const requestSummary =
        progress >= 50 &&
        velocityAfterThisTurn.paceStatus === 'behind' &&
        velocityAfterThisTurn.openCount >= 2 &&
        this.remainingWorkExceedsCapacity(velocityAfterThisTurn);
      const turnBrief = this.toTurnBrief(result, direction);
      if (targetPoint) {
        turnBrief.targetPointId = targetPoint.id;
        turnBrief.goal = direction;
      }

      // With exactly two speakers there's only one sensible turn order —
      // ping-pong deterministically rather than trusting the model's pick,
      // which can otherwise let one speaker dominate several turns in a row.
      const proposedSpeaker =
        script.speakers.length === 2
          ? this.pingPongSpeaker(script)
          : this.resolveSpeakerReference(script, speakerId);
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
      if (isFinalTurn) {
        this.markRemainingPointsOmitted(
          progress >= 100
            ? 'duration_budget'
            : this.turnsUsed >= this.maxTurns
              ? 'turn_budget'
              : 'closing_reserve'
        );
      }
      return {
        speaker: assignment.speaker,
        direction: assignment.direction,
        timeStatus:
          forceNearlyOutOfTime || isFinalTurn ? wrapUpNote : "",
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
    if (
      this.points.length === 0 ||
      this.points.some((point) => !point.covered && !point.omitted)
    ) {
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

Full conversation so far:
${history || '(nothing said yet)'}

Return isComplete: true only if the conversation has genuinely wrapped up naturally.`,
      },
    ];

    try {
      const { isComplete } =
        await this.callModelForStructuredOutput<CheckConversationCompleteInput>(
          ModelTask.ConclusionCheck,
          messages,
          checkConversationCompleteSchema,
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
    const reviewed = await this.reviewSpeechUnsanitized(
      speech,
      turnBrief,
      editorialCards,
      recentSpeeches
    );
    return { ...reviewed, message: this.stripCardIdArtifacts(reviewed.message) };
  }

  /**
   * The reviewer is shown card ids in its prompt for its own bookkeeping
   * (introducedCardIds) but can occasionally echo one back into
   * revisedMessages as if it were a citation. Strip any such artifact
   * before the message ever reaches the transcript or audio pipeline.
   */
  private stripCardIdArtifacts(message: string): string {
    return message
      .replace(/\s*\[[\w-]+-card-\d+\]/gi, '')
      .trimEnd();
  }

  private async reviewSpeechUnsanitized(
    speech: Speech,
    turnBrief: TurnBrief,
    editorialCards: EditorialCard[],
    recentSpeeches: Speech[]
  ): Promise<Speech> {
    try {
      // Step 1: run the raw speech past the editorial reviewer.
      const review = await this.turnReviewer.review(
        speech,
        turnBrief,
        editorialCards,
        recentSpeeches,
        this.script.knowledgeLedger,
        this.script.audienceProfile,
        this.script.terminologyLedger,
        this.script.speakers
      );
      if (
        // Step 2: only attempt a revision if the reviewer rejected the
        // speech, it actually supplied replacement text, and that text
        // clears the usability bar (not empty/truncated/degenerate).
        !review.accepted &&
        review.revisedMessage &&
        this.speechRevisionPolicy.isUsable(
          review.revisedMessage,
          speech.tool === SpeakerAgentToolName.CLOSING_STATEMENT
        )
      ) {
        // Step 3: build a candidate speech using the reviewer's revision.
        const revisedSpeech = {
          ...speech,
          message: review.revisedMessage,
          turnBrief,
        };
        // Closing statements are the one case where re-reviewing the fix
        // against the same strict farewell/second-person bar tends to reject
        // the revision again on an increasingly nitpicky reading of its own
        // suggested wording, which would leave the episode's final words
        // without a sign-off forever. The first review already targeted this
        // one narrow requirement when producing revisedMessage, so trust it
        // directly instead of risking an infinite rejection loop.
        if (speech.tool === SpeakerAgentToolName.CLOSING_STATEMENT) {
          logger.warn(
            `Turn reviewer revised ${speech.speaker.name}'s closing statement to add a sign-off`
          );
          return { ...revisedSpeech, review };
        }
        // Step 4: re-review the revision itself — the reviewer's fix isn't
        // trusted blindly, it must independently pass the same review.
        const revisedReview = await this.turnReviewer.review(
          revisedSpeech,
          turnBrief,
          editorialCards,
          recentSpeeches,
          this.script.knowledgeLedger,
          this.script.audienceProfile,
          this.script.terminologyLedger,
          this.script.speakers
        );
        if (!revisedReview.accepted) {
          // Step 5a: the revision failed review too, so fall back to the
          // original speech rather than ship an unvetted rewrite.
          logger.warn(
            `Turn reviewer rejected its revision for ${speech.speaker.name}; keeping the original speech`
          );
          return { ...speech, turnBrief, review };
        }
        // Step 5b: the revision passed its own review — use it in place
        // of the original speech, attaching the second review's verdict.
        logger.warn(
          `Turn reviewer revised ${speech.speaker.name}'s speech for editorial fit`
        );
        return {
          ...revisedSpeech,
          review: revisedReview,
        };
      }
      // Step 6: reviewer accepted the original (or no usable revision was
      // offered) — return the original speech annotated with its review.
      return { ...speech, turnBrief, review };
    } catch (error) {
      // Step 7: review is best-effort — any failure (model error, etc.)
      // falls back to the unreviewed original so the pipeline never stalls.
      logger.error('Failed to review turn; keeping original:', error);
      return { ...speech, turnBrief };
    }
  }

  /**
   * The director's coveredPointIds claim comes from the same call that chose
   * the next speaker, and can hallucinate coverage from a merely
   * topically-adjacent mention (e.g. an oxygen tank explosion "covering" a
   * CO2 scrubber duct-tape hack point). Re-check each claim in a dedicated
   * structured verification against the actual, already-persisted full speech
   * transcript before ever marking a point covered.
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
        content: `The director claimed the following discussion points were covered somewhere in the conversation below. Verify each one strictly against the actual text — a point only counts as covered if it was explicitly and substantively discussed with specific detail from the point's text, not merely a topically-adjacent mention. For example, if a point is "CO2 scrubber duct-tape hack" and the speech only mentions an oxygen tank explosion, that point is NOT covered.

Full conversation so far:
${recentHistory || '(nothing said yet)'}

Candidate points claimed as covered:
${pointsList}

Return only the ids of points that were genuinely, substantively covered.`,
      },
    ];

    try {
      const { confirmedPointIds } =
        await this.callModelForStructuredOutput<VerifyCoveredPointsInput>(
          ModelTask.CoverageVerification,
          messages,
          verifyCoveredPointsSchema,
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
   * Records an explicit editorial omission when production must close before
   * every planned opportunity fits. Omitted points remain visible in the
   * saved script and are not misrepresented as covered.
   */
  markRemainingPointsOmitted(reason: string): DiscussionPoint[] {
    const omitted = this.points.filter(
      (point) => !point.covered && !point.omitted
    );
    for (const point of omitted) {
      point.omitted = true;
      point.omissionReason = reason;
    }
    const allOmitted = this.points.filter((point) => point.omitted);
    const omissionSeverity = allOmitted.some(
      (point) => point.priority === DiscussionPointPriority.Essential
    )
      ? "essential"
      : allOmitted.some(
            (point) => point.priority === DiscussionPointPriority.Supporting
          )
        ? "supporting"
        : allOmitted.length > 0
          ? "optional_only"
          : "none";
    this.script.productionOutcome = {
      status:
        allOmitted.length > 0 ? "complete_with_omissions" : "complete",
      completionReason:
        this.script.productionOutcome?.completionReason ?? reason,
      omittedPointIds: allOmitted.map((point) => point.id),
      omissionSeverity,
    };
    return omitted;
  }

  private priorityWeight(point: DiscussionPoint): number {
    switch (point.priority) {
      case DiscussionPointPriority.Essential:
        return 300;
      case DiscussionPointPriority.Optional:
        return 100;
      case DiscussionPointPriority.Supporting:
      default:
        return 200;
    }
  }

  private rankedOpenPoints(): DiscussionPoint[] {
    return this.points
      .filter((point) => !point.covered && !point.omitted)
      .sort((a, b) => {
        const aScore =
          this.priorityWeight(a) +
          (a.storyValue ?? 5) * 10 -
          (a.estimatedTurns ?? 2);
        const bScore =
          this.priorityWeight(b) +
          (b.storyValue ?? 5) * 10 -
          (b.estimatedTurns ?? 2);
        return bScore - aScore;
      });
  }

  private selectScheduledPoint(): DiscussionPoint | undefined {
    return this.rankedOpenPoints()[0];
  }

  private remainingWorkExceedsCapacity(
    velocity: ReturnType<DirectorAgent['calculateVelocity']>
  ): boolean {
    const requiredTurns = this.rankedOpenPoints().reduce(
      (sum, point) => sum + (point.estimatedTurns ?? 2),
      0
    );
    // A natural two-person discussion averages roughly 2.5 substantive turns
    // per minute once reactions and transitions are accounted for.
    const availableTurns = Math.max(
      0,
      Math.floor(velocity.remainingMinutes * 2.5)
    );
    return requiredTurns > availableTurns;
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
   * Beat progress is recorded from an accepted, reviewed speech rather than
   * from the direction model's prediction about what a future turn may cover.
   */
  recordAcceptedBeat(speech: Speech): void {
    const beatId = speech.turnBrief?.beatId;
    if (beatId && speech.review?.advancesBeat === true) {
      this.applyCoveredBeats([beatId]);
    }
  }

  async recordAcceptedCoverage(
    script: PodcastScript,
    speech: Speech
  ): Promise<void> {
    const targetPointId = speech.turnBrief?.targetPointId;
    if (!targetPointId) return;
    const confirmed = await this.verifyCoveredPoints([targetPointId], script);
    this.applyCoveredPoints(confirmed);
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
    const openCount = this.points.filter(
      (point) => !point.covered && !point.omitted
    ).length;

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

    const openPoints = this.rankedOpenPoints();
    const nextPointsList = openPoints
      .slice(0, 2)
      .map(
        (point) =>
          `- ${point.id} [${point.priority ?? DiscussionPointPriority.Supporting}, story ${point.storyValue ?? 5}/10, ~${point.estimatedTurns ?? 2} turn(s)]: ${point.text}`
      )
      .join('\n');

    return ` The conversation is behind pace on discussion points — ${velocity.openCount} point(s) remain with about ${velocity.remainingMinutes.toFixed(
      1
    )} minutes left. Use the ranking below: cover the highest-ranked point that connects naturally to the current conversation. It is acceptable to omit lower-ranked opportunities; never pretend an omitted point was covered. Compatible points may be combined when they form one coherent idea, but do not turn the speech into a checklist.\n${nextPointsList}`;
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
    const openPoints = this.rankedOpenPoints();
    if (openPoints.length === 0) {
      return '\n\nAll discussion points have been covered.';
    }
    const list = openPoints
      .map(
        (point) =>
          `- ${point.id} [${point.priority ?? DiscussionPointPriority.Supporting}, story ${point.storyValue ?? 5}/10, ~${point.estimatedTurns ?? 2} turn(s)]: ${point.text}`
      )
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
      `Discussion points: ${velocity.coveredCount}/${velocity.coveredCount + velocity.openCount} active covered · ${this.points.filter((point) => point.omitted).length} omitted · ${velocity.elapsedMinutes.toFixed(
        1
      )}/${(this.maxDuration / 60).toFixed(1)} min elapsed · pace: ${velocity.paceStatus}`
    );
  }

  private pingPongSpeaker(script: PodcastScript): Speaker {
    const lastSpeaker = script.speeches[script.speeches.length - 1]?.speaker;
    if (!lastSpeaker) {
      return script.speakers[0];
    }
    return (
      script.speakers.find((speaker) => speaker.id !== lastSpeaker.id) ??
      script.speakers[0]
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

  private resolveSpeakerReference(
    script: PodcastScript,
    reference: string
  ): Speaker | undefined {
    const normalisedReference = reference.trim().toLocaleLowerCase();
    return script.speakers.find(
      (speaker) =>
        speaker.id.toLocaleLowerCase() === normalisedReference ||
        speaker.slug.toLocaleLowerCase() === normalisedReference ||
        speaker.name.toLocaleLowerCase() === normalisedReference
    );
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
  private getWrapUpNote(
    progress: number,
    isFinalTurn: boolean,
    hasAnnouncedTimePressure: boolean
  ): string {
    if (isFinalTurn) {
      return ' This is the final turn of the episode — direct this speaker to deliver a closing statement. It must step back to the episode\'s overall throughline or big-picture takeaway rather than recapping every point, must not raise any new fact or question, and must end by signing off naturally, not on a question. Before assigning this, confirm from the conversation above that nothing is left as an open, unanswered question — if something still is, that should already have been resolved by an earlier nearly_out_of_time turn; do not let the closing turn attempt to resolve it, and do not let it introduce something new instead.';
    }

    if (progress >= CLOSING_STAGE_PROGRESS_THRESHOLD) {
      if (hasAnnouncedTimePressure) {
        return ' The speakers have already told listeners that time is running out. Keep the remaining turns concise and move directly towards the close without mentioning the time pressure again.';
      }
      return ' The episode is almost out of time — direct the speakers to wrap up remaining points and head toward a close within the next turn or two, rather than opening new topics. If the immediately preceding turn(s) left a question or thread unanswered, this time-pressure turn must resolve it — answer it briefly — rather than only announcing that time is short; do not let the episode move toward closing while a live question sits unanswered.';
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
        pointIds: [point.id],
        covered: false,
      }));
    }

    return inputs.map((input, index) => ({
      id: `b${index + 1}`,
      purpose: input.purpose,
      goal: input.goal,
      cardIds: input.cardIds ?? [],
      prerequisiteBeatIds: input.prerequisiteBeatIds ?? [],
      desiredEnergy: input.desiredEnergy ?? EnergyLevel.Curious,
      targetTurns: Math.max(1, input.targetTurns ?? 1),
      pointIds: input.pointIds ?? [],
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
      move: input.move ?? EditorialMove.Explain,
      cardIds: input.cardIds ?? [],
      audienceValue: input.audienceValue ?? AudienceValue.Understanding,
      desiredEnergy: input.desiredEnergy ?? EnergyLevel.Curious,
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

  private getEditorialSection(
    script: PodcastScript,
    targetPointId?: string
  ): string {
    const beats = (script.conversationBeats ?? [])
      .filter((beat) => !beat.covered)
      .sort((a, b) => {
        if (!targetPointId) return 0;
        const aMatches = a.pointIds?.includes(targetPointId) ? 1 : 0;
        const bMatches = b.pointIds?.includes(targetPointId) ? 1 : 0;
        return bMatches - aMatches;
      });
    const cards = [...(script.editorialCards ?? [])].sort(
      (a, b) => b.storyValue - a.storyValue
    );
    if (beats.length === 0 && cards.length === 0) return '';

    const beatText = beats
      .map(
        (beat) =>
          `- ${beat.id} [${beat.purpose}, ${beat.desiredEnergy}]: ${beat.goal}`
      )
      .join('\n');
    const introducedCardIds = new Set(
      (script.knowledgeLedger?.introducedCards ?? []).map(
        (entry) => entry.cardId
      )
    );
    const cardText = cards
      .slice(0, 20)
      .map((card) =>
        introducedCardIds.has(card.id)
          ? `- ${card.id} [${card.kind}] (ALREADY USED — do not reassign unless the conversation needs to explicitly revisit it): ${card.content}`
          : `- ${card.id} [${card.kind}]: ${card.content}`
      )
      .join('\n');
    return `\n\nOpen conversation beats:\n${beatText || '(none)'}\n\nPrepared editorial cards:\n${cardText || '(none)'}`;
  }

  /**
   * When the previous turn closed out a beat and more remain, invite the
   * director to have the next speaker voice the segment transition out
   * loud, the way real hosts signpost ("Here's where it gets interesting").
   */
  private getSignpostNote(script: PodcastScript): string {
    const beats = script.conversationBeats ?? [];
    const justCovered = beats.some(
      (beat) => beat.covered && beat.coveredAtTurn === this.turnsUsed - 1
    );
    const remaining = beats.some((beat) => !beat.covered);
    if (!justCovered || !remaining) return "";
    return " The conversation just completed a beat — consider directing this speaker to voice the transition out loud in their own words (e.g. connecting what was just established to what comes next, or flagging that the next part is where it gets interesting) rather than jumping topics silently.";
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
      .map(speech => `${speech.speaker.name}: ${speech.message} [${speech.tool ?? 'unknown'}]`)
      .join('\n');
  }
}
