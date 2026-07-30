import {
  ClaimEditorialGate,
  DirectorAgent,
  SpeakerAgent,
  SpeechRepetitionPolicy,
} from "../agents";
import {
  OpeningSequencePolicy,
  OpeningStage,
  OpeningTurn,
} from "../agents/OpeningSequencePolicy";
import { ClosingSequencePolicy } from "../agents/ClosingSequencePolicy";
import { EpisodeRecapPolicy } from "../agents/EpisodeRecapPolicy";
import { EpisodeConclusionPolicy } from "../agents/EpisodeConclusionPolicy";
import { KnowledgeLedgerPolicy } from "../agents/KnowledgeLedgerPolicy";
import { SpeakerRoleProfileResolver } from "../agents/SpeakerRoleProfileResolver";
import { TerminologyLedgerPolicy } from "../agents/TerminologyLedgerPolicy";
import type { ObservabilityInstance } from "@mastra/core/observability";
import { createTweedyMastra } from "../mastra";
import {
  EpisodeWorkflowDependencies,
  TurnSelection,
  WorkflowCandidate,
} from "../mastra/episode-workflow";
import { SpeechRepository } from "../repositories";
import { RAGService } from "../rag";
import {
  EpistemicRole,
  PodcastScript,
  Speaker,
  Speech,
  TurnBrief,
} from "../types";
import { appConfig } from "../utils/config";
import { shouldInterject } from "./interjection-policy";
import {
  ConversationGenerationRequest,
  MastraEpisodeRunner,
} from "./conversation-engine";
import { inspectEpisode } from "../workflow/EpisodeInspector";
import { EpisodeState } from "../workflow/episode-schemas";
import { ModelTask } from "../providers/ModelRoutingPolicy";
import { EpisodeAuditAgent } from "../agents/EpisodeAuditAgent";
import { EpisodeRepairService } from "./EpisodeRepairService";

interface SelectedTurn {
  speaker: Speaker;
  direction: string;
  timeStatus: string;
  forceNearlyOutOfTime: boolean;
  requestSummary: boolean;
  isFinalTurn: boolean;
  turnBrief?: TurnBrief;
  openingTurn: OpeningTurn | null;
}

function tokenize(reason: string): Set<string> {
  return new Set(
    reason.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/**
 * The specific number or name a rejection is about ("108 suitors", "Archie")
 * survives an LLM's rewording far more reliably than the sentence's overall
 * wording does — two paraphrases of the same complaint can otherwise share
 * almost no words in common. Numbers anchor regardless of position; a
 * capitalised word not at the very start of the sentence is treated as a
 * likely proper noun (the first word is excluded since ordinary sentence-
 * initial capitalisation would otherwise false-positive on unrelated
 * reasons).
 */
function extractAnchors(reason: string): Set<string> {
  const words = reason.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [];
  const anchors = new Set<string>();
  words.forEach((word, index) => {
    if (/^\d+$/.test(word)) {
      anchors.add(word);
    } else if (index > 0 && /^[A-Z]/.test(word) && word.length >= 3) {
      anchors.add(word.toLocaleLowerCase());
    }
  });
  return anchors;
}

function isEquivalentReason(a: string, b: string): boolean {
  const anchorsA = extractAnchors(a);
  const anchorsB = extractAnchors(b);
  if (anchorsA.size > 0 && anchorsB.size > 0) {
    return [...anchorsA].some((anchor) => anchorsB.has(anchor));
  }
  // Neither reason names a specific number or proper noun to anchor on —
  // fall back to overall word overlap.
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  const shared = [...tokensA].filter((token) => tokensB.has(token)).length;
  return shared / Math.max(1, Math.min(tokensA.size, tokensB.size)) >= 0.6;
}

const REJECTION_WINDOW_SIZE = 8;
const REJECTION_RECURRENCE_THRESHOLD = 3;

/**
 * A stuck turn rarely fails for the exact same reason on 3 *consecutive*
 * attempts — the model tries a few genuinely different fixes in between,
 * each one addressing a distinct incidental issue, while the same
 * substantive problem it can't actually solve keeps resurfacing between
 * them. Scanning a wider recent window for a reason recurring often enough
 * (regardless of what's interleaved) catches that pattern; requiring strict
 * consecutive repeats does not.
 */
interface RecurringRejection {
  reason: string;
  occurrences: number;
}

export function findRecurringRejection(
  reasons: string[]
): RecurringRejection | undefined {
  const window = reasons.slice(-REJECTION_WINDOW_SIZE);
  if (window.length === 0) return undefined;
  const mostRecent = window[window.length - 1];
  const occurrences = window.filter((reason) =>
    isEquivalentReason(mostRecent, reason)
  ).length;
  return occurrences >= REJECTION_RECURRENCE_THRESHOLD
    ? { reason: mostRecent, occurrences }
    : undefined;
}

/**
 * Adapts the existing domain agents and repositories to the narrow dependency
 * ports of the typed Mastra workflow. Domain records remain outside snapshots;
 * only IDs and compact candidate data cross workflow step boundaries.
 */
export class MastraScriptWorkflowRunner implements MastraEpisodeRunner {
  constructor(
    private readonly speechRepository: SpeechRepository,
    private readonly ragService: RAGService,
    private readonly knowledgeLedgerPolicy = new KnowledgeLedgerPolicy(),
    private readonly terminologyLedgerPolicy = new TerminologyLedgerPolicy(),
    private readonly repetitionPolicy = new SpeechRepetitionPolicy(),
    private readonly recapPolicy = new EpisodeRecapPolicy(),
    private readonly roleResolver = new SpeakerRoleProfileResolver(),
    private readonly runtimeConfig: {
      storagePath: string;
      tracePath: string;
    } = {
      storagePath: appConfig.mastraStoragePath,
      tracePath: appConfig.mastraTracePath,
    },
    private readonly conclusionPolicy = new EpisodeConclusionPolicy(),
    private readonly claimEditorialGate = new ClaimEditorialGate(),
    private readonly episodeAuditAgent = new EpisodeAuditAgent()
  ) {}

  async run(request: ConversationGenerationRequest): Promise<PodcastScript> {
    const { script, params, workflowRunId } = request;
    const director = new DirectorAgent(
      script,
      {
        maxTurns: Math.max(1, params.maxTurns - (script.speakers.length + 1)),
        maxDuration: params.maxDuration,
      },
      params.guidance
    );
    const opening = new OpeningSequencePolicy();
    const closing = new ClosingSequencePolicy();
    const selectedTurns = new Map<string, SelectedTurn>();
    const generatedSpeeches = new Map<string, Speech>();
    const verifiedDiscourseClaims = new Map<string, string[]>();
    const advancedAfterRepeatedRejection = new Set<string>();
    let planReady = false;
    // Assigned once the Mastra runtime exists (below); closures created above
    // this point (e.g. generateCandidate) capture the variable by reference,
    // so it's populated by the time they actually run during workflow.start().
    let observability: ObservabilityInstance | undefined;

    const keyFor = (selection: TurnSelection) =>
      `${selection.kind}:${selection.logicalTurn}`;

    const ensurePlan = async () => {
      if (!planReady) {
        await director.createPodcastPlan();
        planReady = true;
      }
    };

    const rememberSelection = (
      state: EpisodeState,
      selected: SelectedTurn,
      overrides: Partial<TurnSelection> = {}
    ): TurnSelection => {
      const selection: TurnSelection = {
        kind: "speech",
        logicalTurn: state.turnsUsed,
        speakerId: selected.speaker.id,
        direction: selected.direction,
        isOpeningTurn: selected.openingTurn !== null,
        isFinalOpeningTurn:
          selected.openingTurn !== null &&
          opening.getStage(script) === OpeningStage.Frame,
        isFinalTurn: selected.isFinalTurn,
        isClosingTurn: false,
        isFinalClosingTurn: false,
        wasRepaired: false,
        modelTask: ModelTask.DirectionSelection,
        ...overrides,
      };
      selectedTurns.set(keyFor(selection), selected);
      return selection;
    };

    const dependencies: EpisodeWorkflowDependencies = {
      prepareMaterials: async () => {
        await this.ragService.addMaterials(script.materials);
      },
      assignSpeakerRoles: async (_episodeId, _speakerIds, tracingContext) => {
        director.attachObservability(tracingContext?.currentSpan);
        await ensurePlan();
        return Object.fromEntries(
          Object.entries(script.speakerRoleAssignments ?? {}).map(
            ([speakerId, profile]) => [speakerId, profile.epistemicRole]
          )
        );
      },
      createPlan: async (_episodeId, tracingContext) => {
        director.attachObservability(tracingContext?.currentSpan);
        await ensurePlan();
        return {
          discussionPointIds: (script.discussionPoints ?? []).map(
            (point) => point.id
          ),
          conversationBeatIds: (script.conversationBeats ?? []).map(
            (beat) => beat.id
          ),
          discourseClaimIds: (script.conversationBeats ?? []).flatMap(
            (beat) => (beat.discourseClaims ?? []).map((claim) => claim.id)
          ),
        };
      },
      inspectEpisode: async (state) => {
        const inspection = inspectEpisode(
          script,
          { maxTurns: params.maxTurns, maxDuration: params.maxDuration },
          state.turnsUsed,
          state.lateStageTurns,
          state.discussionPoints.length,
          state.discussionPoints.filter((point) => point.covered).length,
          this.roleResolver
        );
        return {
          ...inspection,
          orientationActive: script.orientation?.status === "active",
        } as unknown as Record<string, unknown>;
      },
      proposeTurn: async (state, _inspection, tracingContext) => {
        director.attachObservability(tracingContext?.currentSpan);
        if (state.consecutiveRejectedTurns >= 3) {
          const recurring = findRecurringRejection(state.warnings);
          if (recurring) {
            const prior = selectedTurns.get(`speech:${state.turnsUsed}`);
            const claimIds =
              prior?.turnBrief?.targetDiscourseClaimIds ?? [];
            if (claimIds.length > 0) {
              director.abandonDiscourseClaims(claimIds, recurring.reason);
              advancedAfterRepeatedRejection.add(
                `speech:${state.turnsUsed}`
              );
            }
          }
        }
        const openingTurn = opening.nextTurn(script);
        const choice = openingTurn ?? (await director.chooseNextSpeaker(script));
        return rememberSelection(state, {
          speaker: choice.speaker,
          direction: choice.direction,
          timeStatus: choice.timeStatus,
          forceNearlyOutOfTime: choice.forceNearlyOutOfTime,
          requestSummary: choice.requestSummary,
          isFinalTurn: choice.isFinalTurn,
          turnBrief: choice.turnBrief,
          openingTurn,
        });
      },
      repairTurn: async (state, proposal) => {
        if (advancedAfterRepeatedRejection.delete(keyFor(proposal))) {
          return { ...proposal, wasRepaired: true };
        }
        if (state.consecutiveRejectedTurns === 0) return proposal;
        const selected = selectedTurns.get(keyFor(proposal));
        const rejectionReason = state.warnings.at(-1);
        if (!selected || !rejectionReason) return proposal;
        // A single terse reason repeats every retry with no memory of past
        // attempts, so the model often just rephrases the same failed fix.
        // When the same problem is recurring, say so explicitly and demand
        // a substantively different fix rather than another rewording.
        const recurring = findRecurringRejection(state.warnings);
        const retryGuidance =
          recurring && recurring.reason === rejectionReason
            ? `Previous candidate rejected: ${rejectionReason}. This same problem has now failed ${recurring.occurrences} attempts in a row, each time in different wording — rephrasing alone has not worked. Make a substantively different fix: change what information you lead with or how you frame it, not just the phrasing.`
            : `Previous candidate rejected: ${rejectionReason}. Correct that specific problem while preserving the assigned goal.`;
        const direction = `${selected.direction}\n\n${retryGuidance}`;
        selectedTurns.set(keyFor(proposal), {
          ...selected,
          direction,
          turnBrief: selected.turnBrief
            ? {
                ...selected.turnBrief,
                goal: `${selected.turnBrief.goal} ${retryGuidance}`,
              }
            : selected.turnBrief,
        });
        return {
          ...proposal,
          direction,
          wasRepaired: true,
        };
      },
      forceClosingTurn: async (state, reason) => {
        if (state.phase === "discussion") {
          director.markRemainingPointsOmitted(reason.replace(/ /g, "_"));
        }
        const choice = closing.nextTurn(script, state.closingCursor);
        if (!choice) {
          throw new Error("Closing sequence has no remaining turn");
        }
        return rememberSelection(
          state,
          {
            ...choice,
            timeStatus: choice.timeStatus,
            openingTurn: null,
          },
          {
            isClosingTurn: true,
            isFinalClosingTurn: choice.isFinalTurn,
            isFinalTurn: choice.isFinalTurn,
          }
        );
      },
      generateCandidate: async (state, selection, tracingContext) => {
        const selected = selectedTurns.get(keyFor(selection));
        if (!selected) {
          throw new Error(
            `Missing selected turn ${keyFor(selection)} for workflow run ${workflowRunId}`
          );
        }
        let speech: Speech;
        if (selection.kind === "interjection") {
          const previous = script.speeches[script.speeches.length - 1];
          if (!previous) {
            throw new Error("Cannot interject before an accepted speech");
          }
          const speakerAgent = new SpeakerAgent(
            selected.speaker,
            this.ragService
          );
          speakerAgent.attachObservability(tracingContext?.currentSpan);
          speech = await speakerAgent.interject(previous);
        } else {
          const speakerAgent = new SpeakerAgent(
            selected.speaker,
            this.ragService
          );
          speakerAgent.attachObservability(tracingContext?.currentSpan);
          speech = await speakerAgent.speak(script, selected.direction, {
            timeStatus: selected.timeStatus,
            forceNearlyOutOfTime: selected.forceNearlyOutOfTime,
            forceColdOpen: selected.openingTurn?.forceColdOpen ?? false,
            requestSummary: selected.requestSummary,
            isFinalTurn: selection.isFinalTurn,
            turnBrief: selected.turnBrief,
            editorialCards: this.knowledgeLedgerPolicy.getAccessibleCards(
              selected.speaker,
              script.editorialCards ?? [],
              script.knowledgeLedger ??
                this.knowledgeLedgerPolicy.createLedger(),
              selected.turnBrief?.cardIds ?? []
            ),
            centralAnalogy: script.centralAnalogy,
            episodeRecap: this.recapPolicy.buildRecap(script),
          });
        }
        generatedSpeeches.set(keyFor(selection), speech);
        return {
          message: speech.message,
          stopReason: speech.stopReason ?? "unknown",
          data: {
            tool: speech.tool,
          },
        };
      },
      reviewCandidate: async (_state, selection, candidate, tracingContext) => {
        const selected = selectedTurns.get(keyFor(selection));
        const speech = generatedSpeeches.get(keyFor(selection));
        if (!selected || !speech) {
          throw new Error(`Missing generated turn ${keyFor(selection)}`);
        }
        if (selection.kind === "interjection") {
          return { approved: true, notes: "Interjection accepted" };
        }
        director.attachObservability(tracingContext?.currentSpan);
        const reviewed = await director.reviewSpeech(
          speech,
          selected.direction,
          selected.turnBrief,
          script.editorialCards ?? [],
          script.speeches
        );
        generatedSpeeches.set(keyFor(selection), reviewed);
        return {
          approved: reviewed.review?.accepted !== false,
          notes: reviewed.review?.feedback ?? "Director review completed",
          candidate: {
            ...candidate,
            message: reviewed.message,
            stopReason: reviewed.stopReason ?? candidate.stopReason,
          },
        };
      },
      validateIntegrity: async (_state, selection, _candidate, tracingContext) => {
        const speech = generatedSpeeches.get(keyFor(selection));
        if (!speech) return "Missing reviewed turn";
        const claimGate = await this.claimEditorialGate.evaluate(speech, script);
        if (!claimGate.accepted) return claimGate.reason ?? "Editorial claim gate rejected";
        const targetClaimIds =
          speech.turnBrief?.targetDiscourseClaimIds ?? [];
        if (targetClaimIds.length === 0) return null;
        director.attachObservability(tracingContext?.currentSpan);
        const verified = await director.verifyDiscourseClaims(
          script,
          targetClaimIds,
          speech.message
        );
        verifiedDiscourseClaims.set(keyFor(selection), verified);
        return verified.length > 0
          ? null
          : "Targeted discourse claim was not established";
      },
      validateRepetition: async (_state, selection) => {
        const speech = generatedSpeeches.get(keyFor(selection));
        return speech && this.repetitionPolicy.isRepetition(speech, script.speeches)
          ? "Repeated candidate"
          : null;
      },
      validateFinalCandidate: async (_state, selection) => {
        const speech = generatedSpeeches.get(keyFor(selection));
        if (!speech) {
          return "Missing generated closing statement";
        }
        const projectedScript: PodcastScript = {
          ...script,
          speeches: [...script.speeches, speech],
        };
        return this.conclusionPolicy.hasFinalSignOff(projectedScript)
          ? null
          : "Final turn did not contain a complete listener-facing sign-off";
      },
      persistCandidate: async (_state, selection, _candidate, idempotencyKey) => {
        const speech = generatedSpeeches.get(keyFor(selection));
        if (!speech) {
          throw new Error(`Missing reviewed turn ${keyFor(selection)}`);
        }
        const targetDiscourseClaimIds =
          speech.turnBrief?.targetDiscourseClaimIds ?? [];
        const verifiedClaimIds =
          verifiedDiscourseClaims.get(keyFor(selection)) ?? [];
        verifiedDiscourseClaims.set(keyFor(selection), verifiedClaimIds);
        const record = {
          speakerId: speech.speaker.id,
          message: speech.message,
          instructions: speech.instructions,
          voiceId: speech.voice.id,
          voiceStyle: speech.voiceStyle,
          timestamp: speech.timestamp,
          tool: speech.tool,
          stopReason: speech.stopReason,
          turnBrief: speech.turnBrief,
          review: speech.review,
        };
        const persisted = await this.speechRepository.createOrReturn(
          record,
          idempotencyKey
        );
        speech.id = persisted.id;
        const projectedScript: PodcastScript = {
          ...script,
          speeches: [...script.speeches],
          knowledgeLedger: {
            introducedCards: [
              ...(script.knowledgeLedger?.introducedCards ?? []),
            ],
          },
          terminologyLedger: {
            explainedTerms: [
              ...(script.terminologyLedger?.explainedTerms ?? []),
            ],
          },
        };
        const introducedKnowledgeBefore = new Set(
          projectedScript.knowledgeLedger?.introducedCards.map(
            (entry) => entry.cardId
          ) ?? []
        );
        const introducedTermsBefore = new Set(
          projectedScript.terminologyLedger?.explainedTerms.map(
            (entry) => entry.term
          ) ?? []
        );
        this.knowledgeLedgerPolicy.recordAcceptedTurn(projectedScript, speech);
        this.terminologyLedgerPolicy.recordAcceptedTurn(projectedScript, speech);
        const durationSeconds =
          (speech.message.trim().split(/\s+/).filter(Boolean).length / 150) *
          60;
        return {
          speechId: speech.id,
          durationSeconds,
          coveredDiscussionPointIds: (script.discussionPoints ?? [])
            .filter((point) => point.covered)
            .map((point) => point.id),
          coveredConversationBeatIds: (script.conversationBeats ?? [])
            .filter((beat) => beat.covered)
            .map((beat) => beat.id),
          introducedKnowledgeIds:
            projectedScript.knowledgeLedger?.introducedCards
              .map((entry) => entry.cardId)
              .filter((cardId) => !introducedKnowledgeBefore.has(cardId)) ?? [],
          introducedTerms:
            projectedScript.terminologyLedger?.explainedTerms
              .map((entry) => entry.term)
              .filter((term) => !introducedTermsBefore.has(term)) ?? [],
          establishedDiscourseClaimIds: verifiedClaimIds,
          teasedDiscourseClaimIds:
            speech.turnBrief?.knowledgeState === "teased"
              ? speech.turnBrief.cardIds
              : [],
        };
      },
      acceptCandidate: async (_state, selection, _candidate, persisted) => {
        const speech = generatedSpeeches.get(keyFor(selection));
        if (!speech) {
          throw new Error(`Missing accepted turn ${keyFor(selection)}`);
        }
        speech.id = persisted.speechId;
        if (!script.speeches.some((accepted) => accepted.id === speech.id)) {
          director.recordAcceptedBeat(speech);
          // Policies calculate introducedAtTurn from speeches.length + 1.
          // Apply them after TURN_ACCEPTED, before transcript insertion.
          this.knowledgeLedgerPolicy.recordAcceptedTurn(script, speech);
          this.terminologyLedgerPolicy.recordAcceptedTurn(script, speech);
          script.speeches.push(speech);
          await director.recordAcceptedCoverage(
            script,
            speech,
            verifiedDiscourseClaims.get(keyFor(selection))
          );
        }
        script.updatedAt = new Date();
      },
      selectInterjection: async (state) => {
        const last = script.speeches[script.speeches.length - 1];
        if (
          !last ||
          !shouldInterject(last, script.speakers.length, Math.random())
        ) {
          return null;
        }
        const eligible = script.speakers.filter(
          (speaker) =>
            speaker.id !== last.speaker.id &&
            this.roleResolver.resolve(speaker).epistemicRole !==
              EpistemicRole.Expert
        );
        if (eligible.length === 0) return null;
        const speaker = eligible[Math.floor(Math.random() * eligible.length)];
        return rememberSelection(
          state,
          {
            speaker,
            direction: "React briefly to the preceding speech.",
            timeStatus: "",
            forceNearlyOutOfTime: false,
            requestSummary: false,
            isFinalTurn: false,
            openingTurn: null,
          },
          { kind: "interjection" }
        );
      },
      isNaturallyComplete: async (state, tracingContext) => {
        if (
          state.phase !== "discussion" ||
          script.orientation?.status === "active" ||
          script.speeches.length === 0
        ) {
          return false;
        }
        director.attachObservability(tracingContext?.currentSpan);
        return director.isConversationComplete(script);
      },
    };

    const runtime = createTweedyMastra({
      storagePath: this.runtimeConfig.storagePath,
      tracePath: this.runtimeConfig.tracePath,
      episodeWorkflowDependencies: dependencies,
    });
    // Kept as a root-level fallback for the post-workflow audit pass below,
    // which runs after run.start() returns and so has no active step span
    // to nest under. Every in-workflow dependency call instead attaches the
    // current step's own tracingContext.currentSpan (set just before each
    // director/speakerAgent call above), so those spans nest correctly under
    // their step in Studio's workflow trace view rather than becoming
    // disconnected root traces.
    observability = runtime.mastra.observability.getSelectedInstance({});
    const workflow = runtime.mastra.getWorkflow("episodeWorkflow");
    const run = await workflow.createRun({ runId: workflowRunId });
    const result = await run.start({
      inputData: {
        definition: {
          episodeId: script.id || encodeURIComponent(script.title),
          workflowRunId,
          discussionPointIds: [],
          conversationBeatIds: [],
          speakerIds: script.speakers.map((speaker) => speaker.id),
        },
        maxTurns: params.maxTurns,
        maxDurationSeconds: params.maxDuration,
      },
    });
    if (result.status !== "success") {
      throw new Error(`Mastra episode workflow ended with ${result.status}`);
    }
    if (result.result.state.phase !== "completed") {
      throw new Error(
        `Mastra episode workflow ended without a valid closing statement (${result.result.state.phase}): ${result.result.state.warnings.join("; ")}`
      );
    }
    this.episodeAuditAgent.attachObservability(observability);
    await new EpisodeRepairService(
      this.speechRepository,
      this.episodeAuditAgent,
      this.claimEditorialGate
    ).auditAndRepair(script, params.maxDuration, director);
    return script;
  }
}
