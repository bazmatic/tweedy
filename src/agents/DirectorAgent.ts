import {
  AudienceProfile,
  AudienceValue,
  BeatPurpose,
  ConversationBeat,
  DiscussionPoint,
  DiscussionPointPriority,
  DiscourseRole,
  EditorialCard,
  EditorialMove,
  EnergyLevel,
  EpistemicRole,
  IDirectorAgent,
  IMaterialPreparer,
  ITurnReviewer,
  LlmMessage,
  OrientationContract,
  PodcastScript,
  Speaker,
  Speech,
  TurnBrief,
} from '../types';
import { LocalEmbeddingService } from '../rag/LocalEmbeddingService';
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
import { DiscourseRoleMatcher } from './DiscourseRoleMatcher';
import { SHORT_REACTION_TOOLS, SpeakerAgentToolName } from './speaker-tools';
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
  private discourseRoleMatcher: DiscourseRoleMatcher;
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
      discourseRoleMatcher?: DiscourseRoleMatcher;
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
    this.discourseRoleMatcher =
      dependencies.discourseRoleMatcher ??
      new DiscourseRoleMatcher(new LocalEmbeddingService());
  }

  /**
   * Also wires the director's internal material preparer and turn reviewer
   * (constructed as BaseAgent subclasses by default) so their model calls
   * are captured alongside the director's own, giving a complete per-episode
   * trace rather than only the top-level planning/direction calls.
   */
  attachObservability(instance: Parameters<BaseAgent['attachObservability']>[0]): void {
    super.attachObservability(instance);
    if (this.materialPreparer instanceof BaseAgent) {
      this.materialPreparer.attachObservability(instance);
    }
    if (this.turnReviewer instanceof BaseAgent) {
      this.turnReviewer.attachObservability(instance);
    }
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

Also provide a subject-neutral orientation contract: name what is being discussed, define this episode's scope and central question, and list 2-6 atomic facts a completely new listener must understand before deeper material will make sense. These are not necessarily story facts: adapt them to a scientific concept, technology, historical event, person, argument, cultural object, or other subject. Keep them factual and testable against a transcript. The claims receive ids o1, o2, and so on in their listed order; use those ids in prerequisiteClaimIds.

Also provide a sequence of conversation beats. Each beat must have a listener-centred purpose and goal, suitable energy, useful prepared card ids, realistic target turn count, and pointIds naming the ranked points it advances (p1, p2, and so on). Vary the beat purposes so the episode has shape rather than becoming a run of explanations. Use prerequisiteBeatIds where a payoff or advanced explanation depends on earlier context. Discussion points may name prerequisiteClaimIds from the orientation contract when they require that foundation.

For every beat provide ordered atomic claims. Each claim has a subject-neutral role (context, proposition, action, mechanism, explanation, evidence, example, surprise, complication, implication, or payoff) and zero-based prerequisiteClaimIndexes referring only to earlier claims in that beat. Decompose causal examples so setup is established before action, complication, consequence, interpretation or payoff. For non-narrative subjects, establish the phenomenon or proposition before mechanism, evidence and implication. A teaser or memorable consequence does not eliminate the need to establish its prerequisites later.

Also nominate one central analogy — a concrete, physical, everyday comparison for the episode's core concept. Choose something both speakers can return to and extend as new aspects of the topic appear, the way a good explainer keeps one metaphor alive for a whole episode.`,
        }
      ];

      const { narrative, points, beats, centralAnalogy, orientation } = await this.callModelForStructuredOutput<CreatePodcastPlanInput>(
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
          prerequisiteClaimIds: ranked.prerequisiteClaimIds,
          covered: false,
        };
      });
      this.script.discussionPoints = this.points;
      const normalisedBeats = await this.normaliseDiscourseRoles(beats);
      this.script.conversationBeats = this.toConversationBeats(
        normalisedBeats,
        this.points
      );
      this.script.centralAnalogy = centralAnalogy;
      this.script.narrative = this.podcastPlan;
      this.script.orientation = this.toOrientationContract(orientation);
      const orientationClaimIds = new Set(
        this.script.orientation.requiredClaims.map((claim) => claim.id)
      );
      for (const point of this.points) {
        point.prerequisiteClaimIds = point.prerequisiteClaimIds?.filter((id) =>
          orientationClaimIds.has(id)
        );
      }

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
      const orientationClaims = this.getOpenOrientationClaims();
      const isFinalTurn =
        (orientationClaims.length === 0 &&
          (this.turnsUsed >= this.maxTurns ||
            progress >= 100 ||
            this.lateStageTurns >= MAX_LATE_STAGE_TURNS));
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
      if (orientationClaims.length === 0) {
        this.pruneOpenPointsToBudget(script, velocityBeforeThisTurn);
      }
      const targetPoint = isFinalTurn || orientationClaims.length > 0
        ? undefined
        : this.selectScheduledPoint();
      const targetDiscourseClaim = targetPoint
        ? this.selectNextDiscourseClaim(targetPoint.id)
        : undefined;
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
      const discourseNote = targetDiscourseClaim
        ? `\n\nLocal discourse requirement: establish this next eligible meaning before asking listeners to interpret, react to, or remember dependent material:\n- ${targetDiscourseClaim.id} [${targetDiscourseClaim.role}]: ${targetDiscourseClaim.text}\nIts prerequisites are established. Do not presuppose a later claim or jump to a complication, consequence, implication, or payoff. Do not foreshadow later material using people, groups, objects, or events that have not yet been explicitly introduced aloud.`
        : "";
      // With exactly two speakers, who talks next is already deterministic
      // (ping-pong, computed from script.speeches alone) — it does not
      // depend on anything the model returns. Computed here, ahead of the
      // orientation note below, so that note can tailor itself to whether
      // this turn's speaker actually holds the informed-host role.
      const knownNextSpeaker =
        script.speakers.length === 2 ? this.pingPongSpeaker(script) : undefined;
      const orientationTargets = orientationClaims.slice(0, 2);
      const orientationSpeakerIsAudienceGuide =
        !!knownNextSpeaker &&
        this.roleProfileResolver.resolve(knownNextSpeaker).epistemicRole ===
          EpistemicRole.AudienceGuide;
      const orientationNote =
        orientationTargets.length > 0
          ? orientationSpeakerIsAudienceGuide
            ? `\n\nMandatory listener orientation is due, but this turn's speaker is the audience-guide, not the informed host — they should not deliver these foundational claims themselves. Instead, have them ask a direct question or prompt that invites their co-host to establish it on the next turn:\n${orientationTargets
                .map((claim) => `- ${claim.id}: ${claim.text}`)
                .join(
                  "\n"
                )}\nDo not have this speaker state the claims' content themselves; only set up the handoff.`
            : `\n\nMandatory listener orientation: before opening any ranked topic, work toward establishing these foundational claims in plain language, starting with this turn:\n${orientationTargets
                .map((claim) => `- ${claim.id}: ${claim.text}`)
                .join(
                  "\n"
                )}\nDo not merely mention keywords — state what you do cover directly and literally in plain words, before reaching for a metaphor, tease, or hook; a listener must be able to follow it from the literal statement alone, without needing figurative framing to decode it. A claim with several parts does not need to land whole in a single turn — cover what fits naturally and cleanly here, and let the remainder continue on a follow-up turn, rather than cramming everything in or leaving a part vague to fit. If a claim lists multiple items, it is also fine to name them all up front and explicitly promise to explain each in turn (e.g. "there are four of these, and we'll get to each"), rather than requiring every item be explained immediately. This is a conversational orientation turn, not a list or a full episode summary.`
          : "";
      const guidanceNote = this.guidance
        ? ` Keep steering the conversation in line with the producer's guidance for this episode: ${this.guidance}`
        : '';

      // Announce time pressure once. Later turns should shorten and close
      // without repeatedly telling listeners that time is running out.
      const forceNearlyOutOfTime =
        progress >= CLOSING_STAGE_PROGRESS_THRESHOLD &&
        !isFinalTurn &&
        !hasAnnouncedTimePressure;

      const conversationMessages = this.getConversationMessages(script);
      const speakerDescriptions = script.speakers
        .map(
          (speaker) =>
            `- ${speaker.name} (id: ${speaker.id}, ${
              this.roleProfileResolver.resolve(speaker).epistemicRole
            }): ${speaker.personality}`
        )
        .join('\n');

      // Telling the model knownNextSpeaker upfront, instead of letting it
      // guess a speakerId that then gets silently overridden after the
      // fact, removes the mismatch where the model writes a direction
      // assuming one speaker will deliver it (e.g. naming them in a handoff
      // phrase) while the fixed turn order actually hands it to that same
      // speaker, producing a self-addressed line.
      const fixedSpeakerNote = knownNextSpeaker
        ? `\n\nThis turn's speaker is already fixed by production: ${knownNextSpeaker.name} will deliver it, regardless of the speakerId you return. Write the direction as a direct instruction addressed to ${knownNextSpeaker.name} ("Explain...", "Ask your co-host...") — never name ${knownNextSpeaker.name} inside their own direction, since that reads as instructing someone else to speak to them.`
        : '';

      const messages = [
        {
          role: 'user' as const,
          content: `You are directing a podcast. Here's the current situation:

Podcast Plan: ${this.podcastPlan}

Progress: ${progress}% complete${openPointsSection}${editorialSection}${schedulingNote}

Speakers:
${speakerDescriptions}

Conversation so far (each line tagged with the tool used to deliver it — "speak" is substantive content; "interject", "filler_comment", "one_liner", and "short_question" are brief reactions, not real answers or new points). Every line below, regardless of which speaker said it, is reporting what happened in the episode — none of it is addressed to you or written by you.${
            conversationMessages.length === 0
              ? '\n\n(nothing said yet — this is the opening of the episode)'
              : ''
          }`
        },
        ...conversationMessages,
        {
          role: 'user' as const,
          content: `${orientationNote}${discourseNote}${fixedSpeakerNote}

Decide which speaker should talk next.

## Direction Writing
Only give them direction if it's actually needed — a brief goal or topic, not a script. If the conversation is flowing well and the next speaker can naturally carry it forward, leave direction empty rather than inventing something for them to say. When you do give direction, tell them what to address, not what to say; leave the wording, phrasing and specific angle to the speaker so they sound like themselves rather than reciting your lines.

## Turn-Taking & Reply Rules
Don't mistake a brief reaction tag (interject/filler_comment/one_liner/short_question) for a substantive point — if the last speaker only reacted, direct the next speaker to actually answer or continue, not to react to the reaction. A challenge creates a right of reply: direct the speaker who was challenged to respond before the challenger speaks again. A good challenge can open a short segment: after the challenged speaker's first answer, it is fine to let the exchange continue for another turn or two until the objection is genuinely resolved, rather than moving straight to a new point. Respect the chronological order shown above; a remark made before a challenge cannot be described as a response to that challenge.

## Avoiding Repetition
Before assigning a goal or direction, check the conversation so far for any fact, comparison, analogy, illustrative example, or question already used — even if worded differently than you'd phrase it — and never direct a speaker to re-explain, re-derive, or re-ask about it; point them toward new ground instead. This applies just as much to a brief handoff (invite, short_question) as to a full explanation: don't reach for an already-settled topic just because the move calls for something short. If the open discussion points list above shows points already addressed by recent turns, mark their ids in coveredPointIds — only mark a point covered if it was explicitly and substantively discussed with specific detail from the point's text, not merely a topically-adjacent mention (e.g. mentioning an oxygen tank explosion does NOT cover a point about a CO2 scrubber duct-tape hack).

## Editorial Fields
Also choose a subject-neutral editorial move, the primary audience value, desired energy, relevant beat and prepared card ids. Every turn should help the listener understand, entertain them, reveal something meaningful, create connection, or move the conversation forwards; it need not do all of these. Don't force analysis onto a story or humour onto an explanation. Choose the beat this proposed turn should advance; beat completion is recorded only after the resulting speech is accepted and reviewed.

## Fixed Exclusions
The episode's welcome and speaker introductions are already handled before you are ever consulted — never direct anyone to (re)welcome listeners or (re)introduce themselves or a co-host, no matter how far into the episode this is.

Use Australian/British spelling.

## Pacing & Rhythm${this.getPacingNote(
            script
          )}${wrapUpNote}${velocityNote}${balanceNote}${rhythmNote}${signpostNote}${guidanceNote}${this.speakerRolePolicy.buildDirectorGuidance(script)}${this.audienceAccessibilityPolicy.buildDirectorGuidance(script.audienceProfile ?? AudienceProfile.General)}

## Device Assignment
Occasionally — at most once every several turns, mid-explanation — assign the trail_off device so a speaker hands an unfinished sentence to their co-host to complete; never assign it on a closing or summary turn. When a speaker is about to open a brand new beat or point the conversation hasn't touched yet, consider assigning them the tease move instead of explain — a short hook rather than the full explanation — so their co-host can naturally invite them to continue; don't use tease for a beat that's already underway.`
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
        ? targetDiscourseClaim
          ? `Establish ${targetDiscourseClaim.id} directly and declaratively: ${targetDiscourseClaim.text} Give the minimum context a new listener needs. Do not ask a question that presupposes this claim, and do not mention dependent material until this is clear. Every pronoun or shorthand reference must point to a person, group, object, or event already named aloud in the conversation or explicitly introduced in this turn.`
          : `${result.direction ?? ""} Advance the scheduled point ${targetPoint.id}: ${targetPoint.text}.`.trim()
        : orientationTargets.length > 0
          ? `${result.direction ?? ""} Establish this listener foundation before deeper discussion: ${orientationTargets
              .map((claim) => claim.text)
              .join(" ")} Do not introduce a payoff or advanced detail yet.`.trim()
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
      if (targetDiscourseClaim) {
        turnBrief.beatId = targetDiscourseClaim.beatId;
        turnBrief.targetDiscourseClaimIds = [targetDiscourseClaim.id];
        turnBrief.requiredListenerClaimIds = [
          ...targetDiscourseClaim.prerequisiteClaimIds,
        ];
        turnBrief.move =
          targetDiscourseClaim.role === "example"
            ? EditorialMove.Illustrate
            : EditorialMove.Explain;
        turnBrief.audienceValue = AudienceValue.Understanding;
        turnBrief.goal = direction;
      }
      if (orientationTargets.length > 0) {
        turnBrief.targetOrientationClaimIds = orientationTargets.map(
          (claim) => claim.id
        );
        turnBrief.goal = direction;
      }

      // With exactly two speakers there's only one sensible turn order —
      // ping-pong deterministically rather than trusting the model's pick,
      // which can otherwise let one speaker dominate several turns in a row.
      // knownNextSpeaker was already computed before the prompt was built
      // (and told to the model) so this reuses that same deterministic pick.
      const proposedSpeaker =
        knownNextSpeaker ?? this.resolveSpeakerReference(script, speakerId);
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
      if (roleAssignment.repaired || assignment.cadenceRepairReason) {
        assignment.turnBrief.repaired = true;
      }

      const interjectionAcknowledgmentNote = this.getInterjectionAcknowledgmentNote(
        script,
        assignment.speaker.id
      );
      if (interjectionAcknowledgmentNote) {
        assignment.direction =
          `${assignment.direction} ${interjectionAcknowledgmentNote}`.trim();
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
   * The reviewer is shown card ids for bookkeeping and can occasionally
   * echo one into a replacement message as if it were a citation. Strip
   * any such artifact before it reaches the transcript or audio pipeline.
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
          return { ...revisedSpeech, review: { ...review, accepted: true } };
        }
        // Step 4: re-review the revision itself — the reviewer's fix isn't
        // trusted blindly, it must independently pass the same review. Tell
        // it what problem this revision is meant to fix, so it judges
        // whether that specific issue is resolved rather than performing an
        // entirely fresh critique that can invent a new, unrelated objection
        // (the ironic "rejects its own revision" failure mode).
        const revisedReview = await this.turnReviewer.review(
          revisedSpeech,
          turnBrief,
          editorialCards,
          recentSpeeches,
          this.script.knowledgeLedger,
          this.script.audienceProfile,
          this.script.terminologyLedger,
          this.script.speakers,
          review.feedback
        );
        if (!revisedReview.accepted) {
          // Step 5a: preserve the rejection. Callers discard this candidate
          // and request a fresh turn rather than ship known-bad speech.
          // Log the actual rejected text and both verdicts — neither is
          // persisted anywhere else, and without them a stuck run's log is
          // the only place left to diagnose why revisions keep failing.
          logger.warn(
            `Turn reviewer rejected its revision for ${speech.speaker.name}; discarding the candidate\n` +
              `  original (rejected: ${review.feedback}): "${speech.message}"\n` +
              `  revision (rejected: ${revisedReview.feedback}): "${revisedSpeech.message}"`
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
      // Step 6: return the original annotated with its verdict. A rejected
      // result with no usable repair remains rejected for callers to discard.
      if (!review.accepted) {
        logger.warn(
          `Turn reviewer rejected ${speech.speaker.name}'s turn with no usable revision; discarding the candidate\n` +
            `  original (rejected: ${review.feedback}): "${speech.message}"`
        );
      }
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
      ...(this.script.orientation
        ? {
            orientationStatus:
              this.script.orientation.status === "complete"
                ? ("complete" as const)
                : ("incomplete" as const),
            unresolvedOrientationClaimIds:
              this.script.orientation.requiredClaims
                .filter((claim) => claim.required && !claim.covered)
                .map((claim) => claim.id),
          }
        : {}),
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
    const ranked = this.rankedOpenPoints();
    const hasDiscourseContracts = (this.script.conversationBeats ?? []).some(
      (beat) => (beat.discourseClaims?.length ?? 0) > 0
    );
    const eligible = ranked.filter(
      (point) =>
        this.areOrientationPrerequisitesMet(point) &&
        (!hasDiscourseContracts || this.hasEligibleDiscourseForPoint(point.id))
    );
    // Once a bounded orientation attempt has failed, continue with the best
    // comprehensible work rather than deadlocking production.
    return eligible[0] ?? (hasDiscourseContracts ? undefined : ranked[0]);
  }

  private hasEligibleDiscourseForPoint(pointId: string): boolean {
    const beats = this.script.conversationBeats ?? [];
    return beats.some(
      (beat) =>
        !beat.covered &&
        (beat.pointIds ?? []).includes(pointId) &&
        beat.prerequisiteBeatIds.every((id) =>
          beats.some((candidate) => candidate.id === id && candidate.covered)
        ) &&
        (beat.discourseClaims ?? []).some(
          (claim) =>
            claim.state !== "established" &&
            claim.state !== "developed" &&
            claim.state !== "unresolved" &&
            claim.prerequisiteClaimIds.every((id) =>
              this.isDiscourseClaimEstablished(id)
            )
        )
    );
  }

  private areOrientationPrerequisitesMet(point: DiscussionPoint): boolean {
    const ids = point.prerequisiteClaimIds ?? [];
    if (ids.length === 0) return true;
    const claims = this.script.orientation?.requiredClaims ?? [];
    return ids.every((id) => claims.some((claim) => claim.id === id && claim.covered));
  }

  private getOpenOrientationClaims() {
    const orientation = this.script.orientation;
    if (!orientation || orientation.status !== "active") return [];
    return orientation.requiredClaims.filter(
      (claim) => claim.required && !claim.covered
    );
  }

  private allDiscourseClaims() {
    return (this.script.conversationBeats ?? []).flatMap(
      (beat) => beat.discourseClaims ?? []
    );
  }

  private isDiscourseClaimEstablished(claimId: string): boolean {
    return this.allDiscourseClaims().some(
      (claim) =>
        claim.id === claimId &&
        (claim.state === "established" || claim.state === "developed")
    );
  }

  private selectNextDiscourseClaim(
    targetPointId: string
  ) {
    const beats = this.script.conversationBeats ?? [];
    const eligibleBeats = beats.filter(
      (beat) =>
        !beat.covered &&
        (beat.pointIds ?? []).includes(targetPointId) &&
        beat.prerequisiteBeatIds.every((id) =>
          beats.some((candidate) => candidate.id === id && candidate.covered)
        )
    );
    for (const beat of eligibleBeats) {
      const claim = (beat.discourseClaims ?? []).find(
        (candidate) =>
          candidate.state !== "established" &&
          candidate.state !== "developed" &&
          candidate.state !== "unresolved" &&
          candidate.prerequisiteClaimIds.every((id) =>
            this.isDiscourseClaimEstablished(id)
          )
      );
      if (claim) return claim;
    }
    return undefined;
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

  /**
   * Once meaningful production time has elapsed, reserve two turns for the
   * multi-turn closing and retain only the highest-ranked work that can still
   * fit. This is explicit graceful degradation, not inferred coverage.
   */
  private pruneOpenPointsToBudget(
    script: PodcastScript,
    velocity: ReturnType<DirectorAgent["calculateVelocity"]>
  ): void {
    const progress = this.calculateProgress(script);
    if (progress < 35 || velocity.paceStatus !== "behind") return;
    const remainingTurnCapacity = Math.max(
      0,
      this.maxTurns - this.turnsUsed - 2
    );
    const durationTurnCapacity = Math.max(
      0,
      Math.floor(velocity.remainingMinutes * 2.5) - 2
    );
    const capacity = Math.min(remainingTurnCapacity, durationTurnCapacity);
    const ranked = this.rankedOpenPoints();
    const required = ranked.reduce(
      (sum, point) => sum + Math.max(1, point.estimatedTurns ?? 2),
      0
    );
    if (required <= capacity) return;

    let used = 0;
    const omitted: DiscussionPoint[] = [];
    for (const point of ranked) {
      const cost = Math.max(1, point.estimatedTurns ?? 2);
      if (used + cost <= capacity) {
        used += cost;
      } else {
        point.omitted = true;
        point.omissionReason = "budget_priority";
        omitted.push(point);
      }
    }
    if (omitted.length > 0) {
      logger.warn(
        `Budget triage omitted ${omitted.length} lower-ranked point(s); reserved ${capacity} substantive turn(s) plus closing capacity`
      );
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
   * Beat progress is recorded from an accepted, reviewed speech rather than
   * from the direction model's prediction about what a future turn may cover.
   */
  recordAcceptedBeat(speech: Speech): void {
    // A reviewer saying that one turn advances a beat is not evidence that an
    // ordered multi-claim discourse contract is complete. Claim-targeted turns
    // can complete their beat only through verified claim coverage.
    if ((speech.turnBrief?.targetDiscourseClaimIds?.length ?? 0) > 0) {
      return;
    }
    const beatId = speech.turnBrief?.beatId;
    if (beatId && speech.review?.advancesBeat === true) {
      this.applyCoveredBeats([beatId]);
    }
  }

  async recordAcceptedCoverage(
    script: PodcastScript,
    speech: Speech,
    verifiedDiscourseClaimIds?: string[]
  ): Promise<void> {
    const orientationClaimIds =
      speech.turnBrief?.targetOrientationClaimIds ?? [];
    if (orientationClaimIds.length > 0) {
      await this.recordAcceptedOrientationCoverage(
        script,
        orientationClaimIds
      );
    }
    const discourseClaimIds =
      speech.turnBrief?.targetDiscourseClaimIds ?? [];
    if (discourseClaimIds.length > 0) {
      await this.recordAcceptedDiscourseCoverage(
        script,
        speech,
        discourseClaimIds,
        verifiedDiscourseClaimIds
      );
    }
    // A speaker can establish a claim's content in passing while pursuing an
    // unrelated assigned target (e.g. answering a co-host's tangent) — only
    // checking the turn's explicitly targeted claims leaves those claims
    // permanently "unestablished" even though a listener already heard them,
    // so the director re-assigns the same already-spoken content as a fresh
    // target on a later turn, guaranteeing a repetition rejection. Bounded to
    // a handful of untargeted-but-eligible claims to avoid an unbounded LLM
    // call per turn.
    await this.recordOpportunisticDiscourseCoverage(
      script,
      speech,
      discourseClaimIds
    );
    const targetPointId = speech.turnBrief?.targetPointId;
    if (!targetPointId) return;
    if (discourseClaimIds.length > 0) {
      this.applyPointCoverageFromDiscourse(targetPointId);
      return;
    }
    const confirmed = await this.verifyCoveredPoints([targetPointId], script);
    this.applyCoveredPoints(confirmed);
  }

  private static readonly MAX_OPPORTUNISTIC_DISCOURSE_CLAIMS = 3;

  private async recordOpportunisticDiscourseCoverage(
    script: PodcastScript,
    speech: Speech,
    alreadyTargetedClaimIds: string[]
  ): Promise<void> {
    const untargetedEligibleIds = this.allDiscourseClaims()
      .filter(
        (claim) =>
          !alreadyTargetedClaimIds.includes(claim.id) &&
          claim.state !== "established" &&
          claim.state !== "developed" &&
          claim.state !== "unresolved" &&
          claim.prerequisiteClaimIds.every((id) =>
            this.isDiscourseClaimEstablished(id)
          )
      )
      .map((claim) => claim.id)
      .slice(0, DirectorAgent.MAX_OPPORTUNISTIC_DISCOURSE_CLAIMS);
    if (untargetedEligibleIds.length === 0) return;
    const verifiedIds = await this.verifyDiscourseClaims(
      script,
      untargetedEligibleIds,
      speech.message
    );
    if (verifiedIds.length === 0) return;
    this.applyVerifiedDiscourseClaims(
      speech,
      untargetedEligibleIds,
      verifiedIds
    );
  }

  private async recordAcceptedDiscourseCoverage(
    script: PodcastScript,
    speech: Speech,
    targetClaimIds: string[],
    preverifiedClaimIds?: string[]
  ): Promise<void> {
    const candidates = this.allDiscourseClaims().filter((claim) =>
      targetClaimIds.includes(claim.id)
    );
    if (candidates.length === 0) return;
    for (const claim of candidates) claim.attemptedTurns += 1;
    const confirmedPointIds =
      preverifiedClaimIds ??
      (await this.verifyDiscourseClaims(script, targetClaimIds));
    this.applyVerifiedDiscourseClaims(speech, targetClaimIds, confirmedPointIds);
    this.propagateUnresolvedDiscourse();
    this.updateBeatCoverageFromDiscourse();
  }

  async verifyDiscourseClaims(
    script: PodcastScript,
    targetClaimIds: string[],
    candidateMessage?: string
  ): Promise<string[]> {
    const candidates = this.allDiscourseClaims().filter((claim) =>
      targetClaimIds.includes(claim.id)
    );
    if (candidates.length === 0) return [];
    const messages = [
      {
        role: "user" as const,
        content: `Verify whether each atomic discourse claim is clearly established by the accepted podcast transcript. The complete causal or explanatory meaning must be recoverable by a new listener. A teaser, keyword, unexplained proper noun, consequence without its cause, or question that assumes the answer does NOT establish a claim.

Accepted transcript:
${this.getConversationHistory(script) || "(nothing said yet)"}
${candidateMessage ? `\nCandidate accepted turn:\n${candidateMessage}` : ""}

Target claims:
${candidates.map((claim) => `- ${claim.id}: ${claim.text}`).join("\n")}

Return only the ids whose complete meaning is established.`,
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
        "Failed to verify discourse claims; treating claims as unconfirmed:",
        error
      );
      return [];
    }
  }

  applyVerifiedDiscourseClaims(
    speech: Speech,
    targetClaimIds: string[],
    verifiedClaimIds: string[]
  ): void {
    const candidates = this.allDiscourseClaims().filter((claim) =>
      targetClaimIds.includes(claim.id)
    );
    for (const claim of candidates) {
      if (verifiedClaimIds.includes(claim.id)) {
        claim.state = "established";
        if (!claim.evidenceSpeechIds.includes(speech.id)) {
          claim.evidenceSpeechIds.push(speech.id);
        }
      } else if (claim.attemptedTurns >= 2) {
        claim.state = "unresolved";
      }
    }
    this.propagateUnresolvedDiscourse();
    this.updateBeatCoverageFromDiscourse();
  }

  abandonDiscourseClaims(claimIds: string[], reason: string): void {
    const abandoned = this.allDiscourseClaims().filter((claim) =>
      claimIds.includes(claim.id)
    );
    for (const claim of abandoned) {
      claim.state = "unresolved";
      claim.attemptedTurns = Math.max(claim.attemptedTurns, 2);
    }
    if (abandoned.length > 0) {
      logger.warn(
        `Abandoned unresolved discourse claim(s) after repeated rejection (${reason}): ${abandoned
          .map((claim) => claim.id)
          .join(", ")}`
      );
      this.propagateUnresolvedDiscourse();
      this.updateBeatCoverageFromDiscourse();
    }
  }

  private propagateUnresolvedDiscourse(): void {
    for (const beat of this.script.conversationBeats ?? []) {
      const claims = beat.discourseClaims ?? [];
      let changed = true;
      while (changed) {
        changed = false;
        for (const claim of claims) {
          if (
            claim.state !== "unresolved" &&
            claim.prerequisiteClaimIds.some((id) =>
              claims.some(
                (candidate) =>
                  candidate.id === id && candidate.state === "unresolved"
              )
            )
          ) {
            claim.state = "unresolved";
            changed = true;
          }
        }
      }
      if (claims.some((claim) => claim.state === "unresolved")) {
        for (const pointId of beat.pointIds ?? []) {
          const point = this.points.find((candidate) => candidate.id === pointId);
          if (point && !point.covered) {
            point.omitted = true;
            point.omissionReason = "unresolved_discourse_prerequisite";
          }
        }
      }
    }
  }

  private updateBeatCoverageFromDiscourse(): void {
    for (const beat of this.script.conversationBeats ?? []) {
      const completionIds = beat.completionClaimIds ?? [];
      if (
        completionIds.length > 0 &&
        completionIds.every((id) => this.isDiscourseClaimEstablished(id))
      ) {
        beat.covered = true;
        beat.coveredAtTurn ??= this.turnsUsed;
      }
    }
  }

  private applyPointCoverageFromDiscourse(pointId: string): void {
    const relatedBeats = (this.script.conversationBeats ?? []).filter((beat) =>
      (beat.pointIds ?? []).includes(pointId)
    );
    if (
      relatedBeats.length > 0 &&
      relatedBeats.every((beat) => beat.covered)
    ) {
      this.applyCoveredPoints([pointId]);
    }
  }

  private async recordAcceptedOrientationCoverage(
    script: PodcastScript,
    targetClaimIds: string[]
  ): Promise<void> {
    const orientation = script.orientation;
    if (!orientation || orientation.status !== "active") return;
    orientation.attemptedTurns += 1;
    const candidates = orientation.requiredClaims.filter((claim) =>
      targetClaimIds.includes(claim.id)
    );
    const claimsList = candidates
      .map((claim) => `- ${claim.id}: ${claim.text}`)
      .join("\n");
    const messages = [
      {
        role: "user" as const,
        content: `Verify whether each foundational orientation claim is clearly established by the accepted podcast transcript. A new listener must be able to recover the claim's complete meaning. Mere keyword mentions, implications, scattered fragments, or assumed prior knowledge do NOT count.

Accepted transcript:
${this.getConversationHistory(script) || "(nothing said yet)"}

Orientation claims:
${claimsList}

Return only the ids of claims whose complete meaning was explicitly established.`,
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
      for (const claim of candidates) {
        if (confirmedPointIds.includes(claim.id) && !claim.covered) {
          claim.covered = true;
          claim.coveredAtTurn = this.turnsUsed;
        }
      }
    } catch (error) {
      logger.error(
        "Failed to verify orientation claims; treating claims as unconfirmed:",
        error
      );
    }

    const unresolved = orientation.requiredClaims.filter(
      (claim) => claim.required && !claim.covered
    );
    if (unresolved.length === 0) {
      orientation.status = "complete";
      orientation.unresolvedClaimIds = [];
    } else if (orientation.attemptedTurns >= orientation.maxTurns) {
      orientation.status = "incomplete";
      orientation.unresolvedClaimIds = unresolved.map((claim) => claim.id);
      logger.warn(
        `Orientation remained incomplete after ${orientation.maxTurns} turns; continuing gracefully with unresolved claims: ${orientation.unresolvedClaimIds.join(", ")}`
      );
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

  /**
   * When the resuming speaker's own thought was just interrupted by a brief
   * co-host reaction (interject/filler/short_question/one_liner/paraphrase/
   * agree), tell them upfront to acknowledge it in their opening words. This
   * used to be caught only after the fact by the turn reviewer ("talks past
   * the interjection"), which meant a wasted review-reject-revise cycle every
   * time it happened; stating it in the direction prevents the miss instead.
   */
  private getInterjectionAcknowledgmentNote(
    script: PodcastScript,
    resumingSpeakerId: string
  ): string {
    const speeches = script.speeches;
    const lastSpeech = speeches[speeches.length - 1];
    const priorSpeech = speeches[speeches.length - 2];
    if (!lastSpeech || !priorSpeech) return '';
    if (!SHORT_REACTION_TOOLS.includes(lastSpeech.tool as SpeakerAgentToolName)) {
      return '';
    }
    if (lastSpeech.speaker.id === resumingSpeakerId) return '';
    if (priorSpeech.speaker.id !== resumingSpeakerId) return '';

    return `${priorSpeech.speaker.name}'s thought was just met with a brief reaction from ${lastSpeech.speaker.name} ("${lastSpeech.message}"). Acknowledge it in the opening few words (e.g. a short "Right,"/"Exactly"/"I know" that actually suits that reaction) before continuing the thought — do not talk past it as if it hadn't happened.`;
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
        discourseClaims: [
          {
            id: `b${index + 1}-c1`,
            beatId: `b${index + 1}`,
            text: point.text,
            role: "proposition" as const,
            prerequisiteClaimIds: [],
            state: "unheard",
            evidenceSpeechIds: [],
            attemptedTurns: 0,
          },
        ],
        completionClaimIds: [`b${index + 1}-c1`],
      }));
    }

    return inputs.map((input, index) => {
      const beatId = `b${index + 1}`;
      const rawClaims =
        input.claims?.length
          ? input.claims
          : [{ text: input.goal, role: "proposition" as const }];
      const discourseClaims = rawClaims.map((claim, claimIndex) => ({
        id: `${beatId}-c${claimIndex + 1}`,
        beatId,
        text: claim.text,
        role: claim.role as DiscourseRole,
        prerequisiteClaimIds: (claim.prerequisiteClaimIndexes ?? [])
          .filter(
            (prerequisiteIndex) =>
              prerequisiteIndex >= 0 && prerequisiteIndex < claimIndex
          )
          .map(
            (prerequisiteIndex) => `${beatId}-c${prerequisiteIndex + 1}`
          ),
        state: "unheard" as const,
        evidenceSpeechIds: [],
        attemptedTurns: 0,
      }));
      return {
        id: beatId,
        purpose: input.purpose,
        goal: input.goal,
        cardIds: input.cardIds ?? [],
        prerequisiteBeatIds: input.prerequisiteBeatIds ?? [],
        desiredEnergy: input.desiredEnergy ?? EnergyLevel.Curious,
        targetTurns: Math.max(1, input.targetTurns ?? 1),
        pointIds: input.pointIds ?? [],
        covered: false,
        discourseClaims,
        completionClaimIds: discourseClaims.map((claim) => claim.id),
      };
    });
  }

  private async normaliseDiscourseRoles(
    beats: CreatePodcastPlanInput["beats"]
  ): Promise<CreatePodcastPlanInput["beats"]> {
    if (!beats) return beats;
    return Promise.all(
      beats.map(async (beat) => ({
        ...beat,
        claims: beat.claims
          ? await Promise.all(
              beat.claims.map(async (claim) => ({
                ...claim,
                role: (await this.discourseRoleMatcher.match(
                  claim.role
                )) as DiscourseRole,
              }))
            )
          : beat.claims,
      }))
    );
  }

  private toOrientationContract(
    input: CreatePodcastPlanInput["orientation"]
  ): OrientationContract {
    const fallbackSubject = this.script.title.trim() || "this episode's subject";
    const fallbackScope =
      this.script.description.trim() ||
      `A clear introduction to ${fallbackSubject} for a new listener.`;
    const claims =
      input?.requiredClaims?.length
        ? input.requiredClaims
        : [
            `Clearly identify what ${fallbackSubject} is.`,
            `Establish the essential context needed to understand this episode's focus: ${fallbackScope}`,
          ];
    return {
      subject: input?.subject?.trim() || fallbackSubject,
      scope: input?.scope?.trim() || fallbackScope,
      centralQuestion:
        input?.centralQuestion?.trim() ||
        `What should a new listener understand about ${fallbackSubject}?`,
      requiredClaims: claims.slice(0, 6).map((text, index) => ({
        id: `o${index + 1}`,
        text,
        required: true,
        covered: false,
      })),
      maxTurns: Math.min(3, Math.max(1, input?.maxTurns ?? 3)),
      attemptedTurns: 0,
      status: "active",
    };
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
    const allBeats = script.conversationBeats ?? [];
    const beats = allBeats
      .filter(
        (beat) =>
          !beat.covered &&
          beat.prerequisiteBeatIds.every((id) =>
            allBeats.some(
              (candidate) => candidate.id === id && candidate.covered
            )
          )
      )
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
      (script.knowledgeLedger?.introducedCards ?? [])
        .filter((entry) => entry.state !== "teased")
        .map((entry) => entry.cardId)
    );
    const teasedCardIds = new Set(
      (script.knowledgeLedger?.introducedCards ?? [])
        .filter((entry) => entry.state === "teased")
        .map((entry) => entry.cardId)
    );
    const cardText = cards
      .slice(0, 20)
      .map((card) =>
        introducedCardIds.has(card.id)
          ? `- ${card.id} [${card.kind}] (ALREADY USED — do not reassign unless the conversation needs to explicitly revisit it): ${card.content}`
          : teasedCardIds.has(card.id)
            ? `- ${card.id} [${card.kind}] (TEASED ONLY — listeners still need the full setup before any consequence or payoff): ${card.content}`
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

  // Every speech is reported to the Director as a 'user' message, never
  // 'assistant' — the Director has no speaker persona of its own, and an
  // alternating role assignment risks the model treating some past turns as
  // its own prior output and replying to them in character instead of
  // directing the next one. The direction the Director itself gave for that
  // turn (if any) IS its own prior output, so it's surfaced as a preceding
  // 'assistant' message — letting the model see what it already told a
  // speaker to do, and how that landed, before deciding what to say next.
  private getConversationMessages(script: PodcastScript): LlmMessage[] {
    return script.speeches.flatMap(speech => {
      // A repaired turn's stored goal is the ORIGINAL assignment that role
      // or cadence repair overrode as invalid (e.g. a goal written for one
      // speaker that got silently reassigned to another) — showing that
      // back to the Director as its own past output would surface a known
      // mistake and risk reinforcing it. Show a generic placeholder instead.
      const priorDirection = speech.turnBrief?.repaired
        ? 'Continue the conversation naturally.'
        : speech.turnBrief?.goal?.trim();
      const directionMessage: LlmMessage[] = priorDirection
        ? [
            {
              role: 'assistant' as const,
              content: `[Direction to ${speech.speaker.name}] ${priorDirection}`,
            },
          ]
        : [];
      return [
        ...directionMessage,
        {
          role: 'user' as const,
          content: `[${speech.speaker.name}] ${speech.message} [${speech.tool ?? 'unknown'}]`,
        },
      ];
    });
  }
}
