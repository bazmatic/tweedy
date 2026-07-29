import { DirectorAgent, SpeakerAgent, SpeechRepetitionPolicy } from "../agents";
import {
  OpeningSequencePolicy,
  OpeningStage,
  OpeningTurn,
} from "../agents/OpeningSequencePolicy";
import { EpisodeRecapPolicy } from "../agents/EpisodeRecapPolicy";
import { KnowledgeLedgerPolicy } from "../agents/KnowledgeLedgerPolicy";
import { SpeakerRoleProfileResolver } from "../agents/SpeakerRoleProfileResolver";
import { TerminologyLedgerPolicy } from "../agents/TerminologyLedgerPolicy";
import { createTweedyMastra } from "../mastra";
import {
  EpisodeWorkflowDependencies,
  TurnSelection,
  WorkflowCandidate,
} from "../mastra/episode-workflow";
import { SpeechRepository } from "../repositories";
import { RAGService } from "../rag";
import {
  AudienceValue,
  EditorialMove,
  EnergyLevel,
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
    }
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
    const selectedTurns = new Map<string, SelectedTurn>();
    const generatedSpeeches = new Map<string, Speech>();
    let planReady = false;

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
      assignSpeakerRoles: async () => {
        await ensurePlan();
        return Object.fromEntries(
          Object.entries(script.speakerRoleAssignments ?? {}).map(
            ([speakerId, profile]) => [speakerId, profile.epistemicRole]
          )
        );
      },
      createPlan: async () => {
        await ensurePlan();
        return {
          discussionPointIds: (script.discussionPoints ?? []).map(
            (point) => point.id
          ),
          conversationBeatIds: (script.conversationBeats ?? []).map(
            (beat) => beat.id
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
        return { ...inspection } as unknown as Record<string, unknown>;
      },
      proposeTurn: async (state) => {
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
      repairTurn: async (_state, proposal) => proposal,
      forceClosingTurn: async (state) => {
        let choice: Awaited<ReturnType<DirectorAgent["chooseNextSpeaker"]>>;
        try {
          choice = await director.chooseNextSpeaker(script);
        } catch {
          const lastSpeaker = script.speeches[script.speeches.length - 1]?.speaker;
          const speaker =
            script.speakers.find(
              (candidate) => candidate.id !== lastSpeaker?.id
            ) ?? script.speakers[0];
          if (!speaker) {
            throw new Error("Cannot close an episode without a speaker");
          }
          choice = {
            speaker,
            direction:
              "Deliver the final big-picture takeaway and sign off naturally.",
            timeStatus: "",
            forceNearlyOutOfTime: false,
            requestSummary: true,
            isFinalTurn: true,
            turnBrief: {
              speakerId: speaker.id,
              goal:
                "Deliver the final big-picture takeaway and sign off naturally.",
              move: EditorialMove.Summarise,
              cardIds: [],
              audienceValue: AudienceValue.Insight,
              desiredEnergy: EnergyLevel.Reflective,
            },
          };
        }
        return rememberSelection(
          state,
          {
            speaker: choice.speaker,
            direction:
              choice.direction ||
              "Deliver the final big-picture takeaway and sign off naturally.",
            timeStatus: choice.timeStatus,
            forceNearlyOutOfTime: false,
            requestSummary: true,
            isFinalTurn: true,
            turnBrief: choice.turnBrief,
            openingTurn: null,
          },
          { isFinalTurn: true }
        );
      },
      generateCandidate: async (state, selection) => {
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
          speech = await new SpeakerAgent(
            selected.speaker,
            this.ragService
          ).interject(previous);
        } else {
          speech = await new SpeakerAgent(
            selected.speaker,
            this.ragService
          ).speak(
            script.speeches,
            script.speakers,
            script.materials,
            script.title,
            script.description,
            selected.direction,
            selected.timeStatus,
            selected.forceNearlyOutOfTime,
            selected.openingTurn?.forceColdOpen ?? false,
            selected.requestSummary,
            selection.isFinalTurn,
            selected.turnBrief,
            this.knowledgeLedgerPolicy.getAccessibleCards(
              selected.speaker,
              script.editorialCards ?? [],
              script.knowledgeLedger ??
                this.knowledgeLedgerPolicy.createLedger(),
              selected.turnBrief?.cardIds ?? []
            ),
            script.audienceProfile,
            script.terminologyLedger,
            script.centralAnalogy,
            this.recapPolicy.buildRecap(script)
          );
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
      reviewCandidate: async (_state, selection, candidate) => {
        const selected = selectedTurns.get(keyFor(selection));
        const speech = generatedSpeeches.get(keyFor(selection));
        if (!selected || !speech) {
          throw new Error(`Missing generated turn ${keyFor(selection)}`);
        }
        if (selection.kind === "interjection") {
          return { approved: true, notes: "Interjection accepted" };
        }
        const reviewed = await director.reviewSpeech(
          speech,
          selected.direction,
          selected.turnBrief,
          script.editorialCards ?? [],
          script.speeches
        );
        generatedSpeeches.set(keyFor(selection), reviewed);
        return {
          approved: true,
          notes: reviewed.review?.feedback ?? "Director review completed",
          candidate: {
            ...candidate,
            message: reviewed.message,
            stopReason: reviewed.stopReason ?? candidate.stopReason,
          },
        };
      },
      validateIntegrity: async () => null,
      validateRepetition: async (_state, selection) => {
        const speech = generatedSpeeches.get(keyFor(selection));
        return speech && this.repetitionPolicy.isRepetition(speech, script.speeches)
          ? "Repeated candidate"
          : null;
      },
      persistCandidate: async (_state, selection, _candidate, idempotencyKey) => {
        const speech = generatedSpeeches.get(keyFor(selection));
        if (!speech) {
          throw new Error(`Missing reviewed turn ${keyFor(selection)}`);
        }
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
        };
      },
      acceptCandidate: async (_state, selection, _candidate, persisted) => {
        const speech = generatedSpeeches.get(keyFor(selection));
        if (!speech) {
          throw new Error(`Missing accepted turn ${keyFor(selection)}`);
        }
        speech.id = persisted.speechId;
        if (!script.speeches.some((accepted) => accepted.id === speech.id)) {
          // Policies calculate introducedAtTurn from speeches.length + 1.
          // Apply them after TURN_ACCEPTED, before transcript insertion.
          this.knowledgeLedgerPolicy.recordAcceptedTurn(script, speech);
          this.terminologyLedgerPolicy.recordAcceptedTurn(script, speech);
          script.speeches.push(speech);
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
      isNaturallyComplete: async (state) =>
        state.phase === "discussion" &&
        script.speeches.length > 0 &&
        director.isConversationComplete(script),
    };

    const runtime = createTweedyMastra({
      storagePath: this.runtimeConfig.storagePath,
      tracePath: this.runtimeConfig.tracePath,
      episodeWorkflowDependencies: dependencies,
    });
    const workflow = runtime.mastra.getWorkflow("episodeWorkflow");
    const run = await workflow.createRunAsync({ runId: workflowRunId });
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
    return script;
  }
}
