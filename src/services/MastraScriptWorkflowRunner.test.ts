import { mkdtemp, rm } from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MastraScriptWorkflowRunner } from "./MastraScriptWorkflowRunner";
import {
  AudienceProfile,
  EpistemicRole,
  SourceAccess,
  SpeakerAllocation,
  UncertaintyStyle,
  VocalProviderName,
} from "../types";

const directorCreatePlan = vi.fn();
const directorChoose = vi.fn();
const directorReview = vi.fn();
const directorComplete = vi.fn();
const speakerSpeak = vi.fn();

vi.mock("../agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agents")>();
  return {
    ...actual,
    DirectorAgent: vi.fn().mockImplementation(function (script) {
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
      };
    }),
    SpeakerAgent: vi.fn().mockImplementation(function () {
      return {
      speak: speakerSpeak,
      interject: vi.fn(),
      };
    }),
  };
});

const tempDirectories: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true }))
  );
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
    };
    speakerSpeak.mockResolvedValue(speech);
    directorReview.mockImplementation(async (candidate) => ({
      ...candidate,
      message: "A reviewer-improved opening and final thought.",
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
      }
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
    expect(result.speeches.length).toBeGreaterThan(0);
    expect(createOrReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "A reviewer-improved opening and final thought.",
      }),
      expect.stringContaining("/run-14/")
    );
    expect(speechesVisibleWhenLedgerRecorded).toBe(0);
    expect(directorCreatePlan).toHaveBeenCalledOnce();
  });
});
