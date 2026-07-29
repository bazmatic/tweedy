import { describe, expect, it, vi } from "vitest";
import {
  assertConversationRunCompatible,
  ConversationEngineSelector,
  ConversationGenerationRequest,
  ConversationWorkflowEngineName,
  LegacyConversationWorkflowEngine,
  MastraConversationWorkflowEngine,
} from "./conversation-engine";
import { PodcastScript } from "../types";

function request(): ConversationGenerationRequest {
  return {
    script: {
      id: "episode-14",
      title: "Engine contract",
      description: "",
      speakers: [],
      speeches: [],
      materials: [],
      discussionPoints: [],
      createdAt: new Date("2026-07-29T00:00:00.000Z"),
      updatedAt: new Date("2026-07-29T00:00:00.000Z"),
    },
    params: {
      title: "Engine contract",
      description: "",
      speakers: [],
      materials: [],
      maxTurns: 10,
      maxDuration: 60,
      allocation: "sequential" as any,
    },
    workflowRunId: "run-14",
  };
}

async function appendContractMarker(script: PodcastScript): Promise<void> {
  script.narrative = "shared-domain-contract";
}

function applyDeterministicConversation(script: PodcastScript): void {
  const speaker = {
    id: "speaker-1",
    slug: "host",
    name: "Host",
    personality: "warm",
    voice: {} as any,
    voiceStyle: "natural",
  };
  script.speakers = [speaker];
  script.speeches = [
    {
      id: "speech-opening",
      speaker,
      message: "Opening",
      instructions: "",
      voice: speaker.voice,
      voiceStyle: speaker.voiceStyle,
      timestamp: new Date("2026-07-29T00:00:01.000Z"),
      tool: "cold_open" as any,
    },
    {
      id: "speech-final",
      speaker,
      message: "Final sign-off",
      instructions: "",
      voice: speaker.voice,
      voiceStyle: speaker.voiceStyle,
      timestamp: new Date("2026-07-29T00:00:02.000Z"),
      tool: "closing_statement" as any,
    },
  ];
  script.discussionPoints = [{ id: "point-1", text: "Point", covered: true }];
  script.knowledgeLedger = { introducedCards: [] };
  script.terminologyLedger = { explainedTerms: [] };
}

describe("conversation workflow engine contract", () => {
  it.each([
    [
      ConversationWorkflowEngineName.Legacy,
      () =>
        new LegacyConversationWorkflowEngine(async ({ script }) => {
          await appendContractMarker(script);
        }),
    ],
    [
      ConversationWorkflowEngineName.Mastra,
      () =>
        new MastraConversationWorkflowEngine({
          run: async ({ script }) => {
            await appendContractMarker(script);
            return script;
          },
        }),
    ],
  ])("%s returns the shared PodcastScript contract", async (name, create) => {
    const engine = create();
    const input = request();
    const result = await engine.generate(input);

    expect(result.script).toBe(input.script);
    expect(result.script.narrative).toBe("shared-domain-contract");
    expect(result.metadata).toEqual({
      engine: name,
      flowVersion: engine.flowVersion,
      workflowRunId: "run-14",
    });
  });

  it.each([
    [
      ConversationWorkflowEngineName.Legacy,
      () =>
        new LegacyConversationWorkflowEngine(async ({ script }) => {
          applyDeterministicConversation(script);
        }),
    ],
    [
      ConversationWorkflowEngineName.Mastra,
      () =>
        new MastraConversationWorkflowEngine({
          run: async ({ script }) => {
            applyDeterministicConversation(script);
            return script;
          },
        }),
    ],
  ])("%s preserves shared structural generation invariants", async (_name, create) => {
    const result = await create().generate(request());
    const speechIds = result.script.speeches.map((speech) => speech.id);

    expect(new Set(speechIds).size).toBe(speechIds.length);
    expect(result.script.speeches[0].tool).toBe("cold_open");
    expect(result.script.speeches.at(-1)?.tool).toBe("closing_statement");
    expect(result.script.discussionPoints.every((point) => point.covered)).toBe(
      true
    );
    expect(result.script.knowledgeLedger).toEqual({ introducedCards: [] });
    expect(result.script.terminologyLedger).toEqual({ explainedTerms: [] });
  });
});

describe("ConversationEngineSelector", () => {
  const legacy = new LegacyConversationWorkflowEngine(vi.fn());
  const mastra = new MastraConversationWorkflowEngine({
    run: async ({ script }) => script,
  });

  it("defaults to Mastra after cutover", () => {
    const selector = new ConversationEngineSelector([legacy, mastra]);
    expect(selector.resolve()).toBe(mastra);
  });

  it("selects legacy explicitly for configuration-only rollback", () => {
    const selector = new ConversationEngineSelector([legacy, mastra]);
    expect(selector.resolve(ConversationWorkflowEngineName.Legacy)).toBe(
      legacy
    );
  });

  it("selects Mastra explicitly", () => {
    const selector = new ConversationEngineSelector([legacy, mastra]);
    expect(selector.resolve(ConversationWorkflowEngineName.Mastra)).toBe(
      mastra
    );
  });

  it("fails clearly when an engine is unavailable", () => {
    const selector = new ConversationEngineSelector(
      [legacy],
      ConversationWorkflowEngineName.Legacy
    );
    expect(() =>
      selector.resolve(ConversationWorkflowEngineName.Mastra)
    ).toThrow('Conversation workflow engine "mastra" is not available');
  });
});

describe("assertConversationRunCompatible", () => {
  const legacy = new LegacyConversationWorkflowEngine(vi.fn());

  it("accepts the exact engine and flow version", () => {
    expect(() =>
      assertConversationRunCompatible(
        {
          engine: legacy.name,
          flowVersion: legacy.flowVersion,
          workflowRunId: "run-14",
        },
        legacy
      )
    ).not.toThrow();
  });

  it("refuses cross-engine or cross-version resume", () => {
    const mastra = new MastraConversationWorkflowEngine(
      { run: async ({ script }) => script },
      "mastra-episode-v2"
    );
    expect(() =>
      assertConversationRunCompatible(
        {
          engine: ConversationWorkflowEngineName.Mastra,
          flowVersion: "mastra-episode-v1",
          workflowRunId: "run-14",
        },
        mastra
      )
    ).toThrow(
      "Cannot resume workflow run run-14: it started with mastra/mastra-episode-v1"
    );
  });
});
