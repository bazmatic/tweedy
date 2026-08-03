import { mkdtemp, rm } from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRetryFeedback,
  findRecurringRejection,
  MastraScriptWorkflowRunner,
} from "./MastraScriptWorkflowRunner";
import {
  AiProviderName,
  AudienceProfile,
  AudienceValue,
  EditorialMove,
  EnergyLevel,
  EpistemicRole,
  SourceAccess,
  SpeakerAllocation,
  UncertaintyStyle,
  VocalProviderName,
} from "../types";
import { SpeakerAgentToolName } from "../agents/speaker-tools";

const directorCreatePlan = vi.fn();
const directorChoose = vi.fn();
const directorReview = vi.fn();
const directorComplete = vi.fn();
const speakerSpeak = vi.fn();
const directorAgentCalls: any[] = [];
const speakerAgentCalls: any[] = [];

vi.mock("../agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agents")>();
  return {
    ...actual,
    DirectorAgent: vi.fn().mockImplementation(function (...args: any[]) {
      directorAgentCalls.push(args);
      const script = args[0];
      directorCreatePlan.mockImplementation(async () => {
        script.discussionPoints = [
          { id: "point-1", text: "Point one", covered: false },
        ];
        script.conversationBeats = [
          {
            id: "beat-1",
            purpose: "welcome",
            goal: "welcome",
            covered: false,
          },
        ];
        script.speakerRoleAssignments = {
          "speaker-1": {
            epistemicRole: EpistemicRole.InformedHost,
            sourceAccess: SourceAccess.PreparedCards,
            uncertaintyStyle: UncertaintyStyle.Exploratory,
          },
        };
        script.speakers[0].roleProfile =
          script.speakerRoleAssignments["speaker-1"];
        return "A compact plan";
      });
      return {
        createPodcastPlan: directorCreatePlan,
        chooseNextSpeaker: directorChoose,
        reviewSpeech: directorReview,
        isConversationComplete: directorComplete,
        recordAcceptedBeat: vi.fn(),
        recordAcceptedCoverage: vi.fn(),
        markRemainingPointsOmitted: vi.fn(),
        attachObservability: vi.fn(),
      };
    }),
    SpeakerAgent: vi.fn().mockImplementation(function (...args: any[]) {
      speakerAgentCalls.push(args);
      return {
      speak: speakerSpeak,
      interject: vi.fn(),
      attachObservability: vi.fn(),
      };
    }),
  };
});

const tempDirectories: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  directorAgentCalls.length = 0;
  speakerAgentCalls.length = 0;
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true }))
  );
});

describe("findRecurringRejection", () => {
  it("detects a problem recurring across a window even when other distinct problems are interleaved", () => {
    // Reproduces a real stuck run: the same substantive problem ("108
    // suitors" unintroduced) recurs several times in different wording,
    // interleaved with unrelated one-off issues — never 3-in-a-row.
    const reasons = [
      "108 suitors appear without being introduced to the listener",
      "Presents foundational facts clearly, but no definition for 'epic poem'.",
      "108 suitors still appear without setup or explanation",
      "Repeats structural point Claire already made about Ithaca.",
      "No prior mention of 108 suitors — comes out of nowhere",
    ];

    const result = findRecurringRejection(reasons);

    expect(result).toBeDefined();
    expect(result?.reason).toBe(reasons[reasons.length - 1]);
    expect(result?.occurrences).toBeGreaterThanOrEqual(3);
  });

  it("does not flag a handful of genuinely distinct rejection reasons", () => {
    const reasons = [
      "Talks past the interjection without acknowledging it.",
      "Presents foundational facts clearly, but no definition for 'epic poem'.",
      "Repeats structural point Claire already made about Ithaca.",
    ];

    expect(findRecurringRejection(reasons)).toBeUndefined();
  });

  it("only looks at the most recent window, not the entire history", () => {
    const stale = Array(3).fill("Old unrelated problem from long ago");
    const recent = [
      "Talks past the interjection without acknowledging it.",
      "Presents foundational facts clearly, but no definition for 'epic poem'.",
    ];

    expect(findRecurringRejection([...stale, ...recent])).toBeUndefined();
  });
});

describe("buildRetryFeedback", () => {
  it("frames the rejection as feedback on the speaker's own previous attempt and quotes it", () => {
    const feedback = buildRetryFeedback(
      "108 suitors appear without being introduced to the listener",
      "There were 108 suitors waiting for her.",
      undefined
    );

    expect(feedback).toContain("Your previous attempt at this turn was rejected");
    expect(feedback).toContain(
      "108 suitors appear without being introduced to the listener"
    );
    expect(feedback).toContain('"There were 108 suitors waiting for her."');
    expect(feedback).not.toContain("Director");
  });

  it("omits the quote when no previous message is available", () => {
    const feedback = buildRetryFeedback("Some rejection reason", undefined, undefined);

    expect(feedback).toContain("Some rejection reason");
    expect(feedback).not.toContain("What you said");
  });

  it("demands a substantively different fix when the same problem is recurring", () => {
    const feedback = buildRetryFeedback(
      "108 suitors appear without being introduced to the listener",
      "There were 108 suitors waiting for her.",
      {
        reason: "108 suitors appear without being introduced to the listener",
        occurrences: 3,
      }
    );

    expect(feedback).toContain("failed 3 attempts in a row");
    expect(feedback).toContain("change what information you lead with");
  });
});

describe("MastraScriptWorkflowRunner", () => {
  it("runs the typed workflow and returns the normal PodcastScript domain", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "tweedy-mastra-runner-")
    );
    tempDirectories.push(directory);
    const speaker = {
      id: "speaker-1",
      slug: "host",
      name: "Host",
      personality: "curious host",
      voice: {
        id: "voice-1",
        name: "Voice",
        description: "",
        provider: VocalProviderName.ElevenLabs,
        providerId: "provider-1",
        settings: {},
      },
      voiceStyle: "natural",
    };
    const script = {
      id: "",
      title: "Mastra episode",
      description: "",
      speakers: [speaker],
      speeches: [],
      materials: [],
      discussionPoints: [],
      audienceProfile: AudienceProfile.General,
      createdAt: new Date("2026-07-29T00:00:00.000Z"),
      updatedAt: new Date("2026-07-29T00:00:00.000Z"),
    };
    const speech = {
      id: "",
      speaker,
      message: "A concise opening and final thought.",
      instructions: "natural",
      voice: speaker.voice,
      voiceStyle: speaker.voiceStyle,
      timestamp: new Date("2026-07-29T00:00:01.000Z"),
      stopReason: "stop" as const,
      tool: SpeakerAgentToolName.CLOSING_STATEMENT,
    };
    let generatedSpeechNumber = 0;
    speakerSpeak.mockImplementation(async (...args) => {
      const isFinalTurn = args[2]?.isFinalTurn === true;
      generatedSpeechNumber += 1;
      return {
        ...speech,
        message: isFinalTurn
          ? `A distinct closing thought ${generatedSpeechNumber}.`
          : `A distinct production thought ${generatedSpeechNumber}.`,
        tool: isFinalTurn
          ? SpeakerAgentToolName.CLOSING_STATEMENT
          : SpeakerAgentToolName.SPEAK,
      };
    });
    directorReview.mockImplementation(async (candidate) => ({
      ...candidate,
      message:
        candidate.tool === SpeakerAgentToolName.CLOSING_STATEMENT
          ? `${candidate.message} Thanks for listening, and until next time.`
          : `Reviewer improved: ${candidate.message}`,
    }));
    directorComplete.mockResolvedValue(false);
    directorChoose.mockResolvedValue({
      speaker,
      direction: "sign off",
      timeStatus: "",
      forceNearlyOutOfTime: false,
      requestSummary: true,
      isFinalTurn: true,
      turnBrief: undefined,
    });
    const createOrReturn = vi.fn(async (record, idempotencyKey) => ({
      ...record,
      id: `speech-${idempotencyKey}`,
      idempotencyKey,
    }));
    let speechesVisibleWhenLedgerRecorded = -1;
    const knowledgeLedgerPolicy = {
      createLedger: () => ({ introducedCards: [] }),
      getAccessibleCards: () => [],
      recordAcceptedTurn: (targetScript: typeof script) => {
        speechesVisibleWhenLedgerRecorded = targetScript.speeches.length;
      },
    };
    const runner = new MastraScriptWorkflowRunner(
      { createOrReturn } as any,
      { addMaterials: vi.fn() } as any,
      knowledgeLedgerPolicy as any,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        storagePath: path.join(directory, "workflow.db"),
        tracePath: path.join(directory, "traces.jsonl"),
      },
      undefined,
      { evaluate: vi.fn().mockResolvedValue({ accepted: true }) } as any,
      {
        audit: vi.fn().mockResolvedValue([]),
        rewrite: vi.fn(),
        attachObservability: vi.fn(),
      } as any
    );

    const result = await runner.run({
      script,
      params: {
        title: script.title,
        description: "",
        speakers: [speaker],
        materials: [],
        maxTurns: 1,
        maxDuration: 60,
        allocation: SpeakerAllocation.Sequential,
      },
      workflowRunId: "run-14",
    });

    expect(result).toBe(script);
    expect(result.speeches).toHaveLength(5);
    expect(createOrReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "A distinct closing thought 5. Thanks for listening, and until next time.",
      }),
      expect.stringContaining("/run-14/")
    );
    expect(speechesVisibleWhenLedgerRecorded).toBe(result.speeches.length - 1);
    expect(directorCreatePlan).toHaveBeenCalledOnce();
  });

  it("forwards provider and prompt-variant choices from params to DirectorAgent and SpeakerAgent", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "tweedy-mastra-runner-provider-")
    );
    tempDirectories.push(directory);
    const speaker = {
      id: "speaker-1",
      slug: "host",
      name: "Host",
      personality: "curious host",
      voice: {
        id: "voice-1",
        name: "Voice",
        description: "",
        provider: VocalProviderName.ElevenLabs,
        providerId: "provider-1",
        settings: {},
      },
      voiceStyle: "natural",
    };
    const script = {
      id: "",
      title: "Mastra episode",
      description: "",
      speakers: [speaker],
      speeches: [],
      materials: [],
      discussionPoints: [],
      audienceProfile: AudienceProfile.General,
      createdAt: new Date("2026-07-29T00:00:00.000Z"),
      updatedAt: new Date("2026-07-29T00:00:00.000Z"),
    };
    const speech = {
      id: "",
      speaker,
      message: "A concise opening and final thought.",
      instructions: "natural",
      voice: speaker.voice,
      voiceStyle: speaker.voiceStyle,
      timestamp: new Date("2026-07-29T00:00:01.000Z"),
      stopReason: "stop" as const,
      tool: SpeakerAgentToolName.CLOSING_STATEMENT,
    };
    let generatedSpeechNumber = 0;
    speakerSpeak.mockImplementation(async (...args) => {
      const isFinalTurn = args[2]?.isFinalTurn === true;
      generatedSpeechNumber += 1;
      return {
        ...speech,
        message: isFinalTurn
          ? `A distinct closing thought ${generatedSpeechNumber}.`
          : `A distinct production thought ${generatedSpeechNumber}.`,
        tool: isFinalTurn
          ? SpeakerAgentToolName.CLOSING_STATEMENT
          : SpeakerAgentToolName.SPEAK,
      };
    });
    directorReview.mockImplementation(async (candidate) => ({
      ...candidate,
      message:
        candidate.tool === SpeakerAgentToolName.CLOSING_STATEMENT
          ? `${candidate.message} Thanks for listening, and until next time.`
          : `Reviewer improved: ${candidate.message}`,
    }));
    directorComplete.mockResolvedValue(false);
    directorChoose.mockResolvedValue({
      speaker,
      direction: "sign off",
      timeStatus: "",
      forceNearlyOutOfTime: false,
      requestSummary: true,
      isFinalTurn: true,
      turnBrief: undefined,
    });
    const createOrReturn = vi.fn(async (record, idempotencyKey) => ({
      ...record,
      id: `speech-${idempotencyKey}`,
      idempotencyKey,
    }));
    const knowledgeLedgerPolicy = {
      createLedger: () => ({ introducedCards: [] }),
      getAccessibleCards: () => [],
      recordAcceptedTurn: () => {},
    };
    const runner = new MastraScriptWorkflowRunner(
      { createOrReturn } as any,
      { addMaterials: vi.fn() } as any,
      knowledgeLedgerPolicy as any,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        storagePath: path.join(directory, "workflow.db"),
        tracePath: path.join(directory, "traces.jsonl"),
      },
      undefined,
      { evaluate: vi.fn().mockResolvedValue({ accepted: true }) } as any,
      {
        audit: vi.fn().mockResolvedValue([]),
        rewrite: vi.fn(),
        attachObservability: vi.fn(),
      } as any
    );

    await runner.run({
      script,
      params: {
        title: script.title,
        description: "",
        speakers: [speaker],
        materials: [],
        maxTurns: 1,
        maxDuration: 60,
        allocation: SpeakerAllocation.Sequential,
        provider: AiProviderName.OpenAI,
        directorPromptVariantId: "director-variant",
        speakerPromptVariantId: "speaker-variant",
      },
      workflowRunId: "run-provider",
    });

    expect(directorAgentCalls[0][3]).toEqual(
      expect.objectContaining({
        provider: AiProviderName.OpenAI,
        promptVariantId: "director-variant",
      })
    );
    expect(speakerAgentCalls[0][2]).toEqual(
      expect.objectContaining({
        provider: AiProviderName.OpenAI,
        promptVariantId: "speaker-variant",
      })
    );
  });

  it("forces a turn through after the rejection budget is used up, instead of looping indefinitely", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "tweedy-mastra-runner-budget-")
    );
    tempDirectories.push(directory);
    const speaker = {
      id: "speaker-1",
      slug: "host",
      name: "Host",
      personality: "curious host",
      voice: {
        id: "voice-1",
        name: "Voice",
        description: "",
        provider: VocalProviderName.ElevenLabs,
        providerId: "provider-1",
        settings: {},
      },
      voiceStyle: "natural",
    };
    const script = {
      id: "",
      title: "Mastra episode",
      description: "",
      speakers: [speaker],
      speeches: [],
      materials: [],
      discussionPoints: [],
      audienceProfile: AudienceProfile.General,
      createdAt: new Date("2026-07-29T00:00:00.000Z"),
      updatedAt: new Date("2026-07-29T00:00:00.000Z"),
    };
    const speech = {
      id: "",
      speaker,
      message: "A concise opening and final thought.",
      instructions: "natural",
      voice: speaker.voice,
      voiceStyle: speaker.voiceStyle,
      timestamp: new Date("2026-07-29T00:00:01.000Z"),
      stopReason: "stop" as const,
      tool: SpeakerAgentToolName.CLOSING_STATEMENT,
    };
    let generatedSpeechNumber = 0;
    speakerSpeak.mockImplementation(async (...args) => {
      const isFinalTurn = args[2]?.isFinalTurn === true;
      generatedSpeechNumber += 1;
      return {
        ...speech,
        message: isFinalTurn
          ? `A distinct closing thought ${generatedSpeechNumber}.`
          : `A distinct production thought ${generatedSpeechNumber}.`,
        tool: isFinalTurn
          ? SpeakerAgentToolName.CLOSING_STATEMENT
          : SpeakerAgentToolName.SPEAK,
      };
    });
    // Every single review rejects, unconditionally, forever — if the
    // rejection-budget force-accept mechanism is working, the workflow must
    // still terminate (each logical turn force-accepted after 3 attempts)
    // rather than regenerating and rejecting the same turn indefinitely.
    directorReview.mockImplementation(async (candidate) => ({
      ...candidate,
      review: { accepted: false, feedback: "never good enough" },
    }));
    directorComplete.mockResolvedValue(false);
    directorChoose.mockResolvedValue({
      speaker,
      direction: "sign off",
      timeStatus: "",
      forceNearlyOutOfTime: false,
      requestSummary: true,
      isFinalTurn: true,
      turnBrief: undefined,
    });
    const createOrReturn = vi.fn(async (record, idempotencyKey) => ({
      ...record,
      id: `speech-${idempotencyKey}`,
      idempotencyKey,
    }));
    const knowledgeLedgerPolicy = {
      createLedger: () => ({ introducedCards: [] }),
      getAccessibleCards: () => [],
      recordAcceptedTurn: () => {},
    };
    const runner = new MastraScriptWorkflowRunner(
      { createOrReturn } as any,
      { addMaterials: vi.fn() } as any,
      knowledgeLedgerPolicy as any,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        storagePath: path.join(directory, "workflow.db"),
        tracePath: path.join(directory, "traces.jsonl"),
      },
      undefined,
      { evaluate: vi.fn().mockResolvedValue({ accepted: true }) } as any,
      {
        audit: vi.fn().mockResolvedValue([]),
        rewrite: vi.fn(),
        attachObservability: vi.fn(),
      } as any
    );

    const result = await runner.run({
      script,
      params: {
        title: script.title,
        description: "",
        speakers: [speaker],
        materials: [],
        maxTurns: 3,
        maxDuration: 60,
        allocation: SpeakerAllocation.Sequential,
      },
      workflowRunId: "run-budget",
    });

    // Every persisted turn made it through despite every single review call
    // rejecting — proving the budget forced acceptance rather than the
    // episode either hanging or silently dropping the turns.
    expect(result.speeches.length).toBeGreaterThan(0);
    // Each logical turn should take at most 3 generation attempts (the
    // rejection budget) before being forced through. If the budget were
    // broken (not accumulating, as originally suspected), a stuck turn would
    // regenerate far more than 3 times before this test's timeout gave up —
    // bounding the ratio here catches that regression directly.
    expect(generatedSpeechNumber).toBeLessThanOrEqual(result.speeches.length * 3);
    expect(directorReview).toHaveBeenCalled();
  });

  it("gives a repaired turn its own retry-feedback field instead of duplicating rejection text into direction/turnBrief.goal", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "tweedy-mastra-runner-retry-")
    );
    tempDirectories.push(directory);
    const speaker = {
      id: "speaker-1",
      slug: "host",
      name: "Host",
      personality: "curious host",
      voice: {
        id: "voice-1",
        name: "Voice",
        description: "",
        provider: VocalProviderName.ElevenLabs,
        providerId: "provider-1",
        settings: {},
      },
      voiceStyle: "natural",
    };
    // OpeningSequencePolicy.getStage derives its stage purely from
    // script.speeches.length vs script.speakers.length: with a single
    // speaker and an empty speeches array it would insert real Hook/
    // Welcome/Frame turns ahead of anything directorChoose returns,
    // masking the retry-feedback behavior under test. Pre-seeding 3 prior
    // speeches (> speakers.length + 1) makes getStage return "complete"
    // immediately, so opening.nextTurn() is null and director.chooseNextSpeaker
    // (the mocked directorChoose) drives the turn under test from the start.
    const priorSpeech = {
      id: "prior",
      speaker,
      message: "Prior opening content.",
      instructions: "natural",
      voice: speaker.voice,
      voiceStyle: speaker.voiceStyle,
      timestamp: new Date("2026-07-30T00:00:00.000Z"),
      stopReason: "stop" as const,
      tool: SpeakerAgentToolName.SPEAK,
    };
    const script = {
      id: "",
      title: "Mastra episode",
      description: "",
      speakers: [speaker],
      speeches: [priorSpeech, priorSpeech, priorSpeech],
      materials: [],
      discussionPoints: [],
      audienceProfile: AudienceProfile.General,
      createdAt: new Date("2026-07-30T00:00:00.000Z"),
      updatedAt: new Date("2026-07-30T00:00:00.000Z"),
    };
    const speech = {
      id: "",
      speaker,
      instructions: "natural",
      voice: speaker.voice,
      voiceStyle: speaker.voiceStyle,
      timestamp: new Date("2026-07-30T00:00:01.000Z"),
      stopReason: "stop" as const,
      tool: SpeakerAgentToolName.CLOSING_STATEMENT,
    };
    // Must satisfy the real EpisodeConclusionPolicy.hasFinalSignOff check
    // (unmocked in this test) on every attempt, so the only rejection in
    // play is the one this test controls via claimEditorialGate below —
    // otherwise a real "no sign-off detected" rejection could interleave
    // unpredictably with the controlled one.
    let generatedSpeechNumber = 0;
    speakerSpeak.mockImplementation(async () => {
      generatedSpeechNumber += 1;
      return {
        ...speech,
        message: `Attempt ${generatedSpeechNumber}: thanks for listening, and until next time.`,
      };
    });
    directorReview.mockImplementation(async (candidate) => candidate);
    directorComplete.mockResolvedValue(false);
    const turnBrief = {
      speakerId: speaker.id,
      goal: "Land the reflective close.",
      move: EditorialMove.Reframe,
      cardIds: [],
      audienceValue: AudienceValue.Connection,
      desiredEnergy: EnergyLevel.Reflective,
    };
    directorChoose.mockResolvedValue({
      speaker,
      direction: "sign off",
      timeStatus: "",
      forceNearlyOutOfTime: false,
      requestSummary: false,
      isFinalTurn: true,
      turnBrief,
    });
    let evaluateCallCount = 0;
    const claimEditorialGate = {
      evaluate: vi.fn().mockImplementation(async () => {
        evaluateCallCount += 1;
        return evaluateCallCount === 1
          ? { accepted: false, reason: "Too abrupt for a closing statement." }
          : { accepted: true };
      }),
    };
    const knowledgeLedgerPolicy = {
      createLedger: () => ({ introducedCards: [] }),
      getAccessibleCards: () => [],
      recordAcceptedTurn: () => {},
    };
    const runner = new MastraScriptWorkflowRunner(
      { createOrReturn: vi.fn(async (record, idempotencyKey) => ({
          ...record,
          id: `speech-${idempotencyKey}`,
          idempotencyKey,
        })) } as any,
      { addMaterials: vi.fn() } as any,
      knowledgeLedgerPolicy as any,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        storagePath: path.join(directory, "workflow.db"),
        tracePath: path.join(directory, "traces.jsonl"),
      },
      undefined,
      claimEditorialGate as any,
      {
        audit: vi.fn().mockResolvedValue([]),
        rewrite: vi.fn(),
        attachObservability: vi.fn(),
      } as any
    );

    await runner.run({
      script,
      params: {
        title: script.title,
        description: "",
        speakers: [speaker],
        materials: [],
        maxTurns: 1,
        maxDuration: 60,
        allocation: SpeakerAllocation.Sequential,
      },
      workflowRunId: "run-retry",
    });

    const firstCallOptions = speakerSpeak.mock.calls[0][2];
    const secondCallOptions = speakerSpeak.mock.calls[1][2];

    expect(speakerSpeak.mock.calls[0][1]).toBe("sign off");
    expect(speakerSpeak.mock.calls[1][1]).toBe("sign off");
    expect(firstCallOptions.turnBrief.goal).toBe("Land the reflective close.");
    expect(secondCallOptions.turnBrief.goal).toBe("Land the reflective close.");
    expect(firstCallOptions.retryFeedback).toBeUndefined();
    expect(secondCallOptions.retryFeedback).toContain(
      "Your previous attempt at this turn was rejected"
    );
    expect(secondCallOptions.retryFeedback).toContain(
      "Too abrupt for a closing statement."
    );
    expect(secondCallOptions.retryFeedback).toContain(
      '"Attempt 1: thanks for listening, and until next time."'
    );
  });
});
