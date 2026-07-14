import { describe, expect, it, vi } from "vitest";
import { SpeakerAgentToolName } from "../agents/speaker-tools";
import {
  PodcastScript,
  ScriptEditTurnAction,
  VocalProviderName,
} from "../types";
import { ScriptService } from "./ScriptService";

function makeScript(): PodcastScript {
  const speaker = {
    id: "speaker-1",
    slug: "ada",
    name: "Ada",
    personality: "warm",
    voice: {
      id: "voice-1",
      name: "Voice",
      description: "",
      provider: VocalProviderName.ElevenLabs,
      providerId: "provider-1",
      settings: {},
    },
    voiceStyle: "natural",
    isExpert: false,
  };
  return {
    id: "script-1",
    title: "Test",
    description: "",
    speakers: [speaker],
    speeches: [
      {
        id: "speech-1",
        speaker,
        message: "Original one.",
        instructions: "warmly",
        voice: speaker.voice,
        voiceStyle: speaker.voiceStyle,
        timestamp: new Date(),
        tool: SpeakerAgentToolName.SPEAK,
      },
      {
        id: "speech-2",
        speaker,
        message: "Original two.",
        instructions: "naturally",
        voice: speaker.voice,
        voiceStyle: speaker.voiceStyle,
        timestamp: new Date(),
        tool: SpeakerAgentToolName.SHORT_QUESTION,
      },
    ],
    materials: [],
    discussionPoints: [],
    createdAt: new Date("2026-07-14T00:00:00.000Z"),
    updatedAt: new Date("2026-07-14T01:00:00.000Z"),
  };
}

describe("ScriptService editable imports", () => {
  it("applies copy-on-write turns and commits their order through the script", async () => {
    const script = makeScript();
    const update = vi.fn().mockResolvedValue({ id: script.id });
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: "replacement-1" })
      .mockResolvedValueOnce({ id: "addition-1" });
    const removeCreatedSpeech = vi.fn();
    const service = new ScriptService(
      { update } as any,
      {} as any,
      {} as any,
      {} as any,
      { create, delete: removeCreatedSpeech } as any,
      {} as any
    );
    vi.spyOn(service, "getScript").mockResolvedValue(script);

    const result = await service.applyEditedScriptImport({
      scriptId: script.id,
      expectedRevision: script.updatedAt.toISOString(),
      summary: {
        added: 1,
        removed: 0,
        edited: 1,
        unchanged: 1,
        reordered: true,
      },
      turns: [
        {
          sourceId: "speech-2",
          speakerSlug: "ada",
          message: "Edited two.",
          mode: SpeakerAgentToolName.SPEAK,
          action: ScriptEditTurnAction.Replace,
        },
        {
          sourceId: "speech-1",
          speakerSlug: "ada",
          message: "Original one.",
          mode: SpeakerAgentToolName.SPEAK,
          action: ScriptEditTurnAction.Reuse,
        },
        {
          speakerSlug: "ada",
          message: "Added.",
          mode: SpeakerAgentToolName.SPEAK,
          action: ScriptEditTurnAction.Add,
        },
      ],
    });

    expect(result.edited).toBe(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        message: "Edited two.",
        instructions: "naturally",
        tool: SpeakerAgentToolName.SPEAK,
      })
    );
    expect(update).toHaveBeenCalledWith(
      script.id,
      expect.objectContaining({
        speechIds: ["replacement-1", "speech-1", "addition-1"],
        knowledgeLedger: { introducedCards: [] },
        terminologyLedger: { explainedTerms: [] },
      })
    );
    expect(removeCreatedSpeech).not.toHaveBeenCalled();
  });
});
