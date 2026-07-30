import { describe, expect, it, vi } from "vitest";
import {
  AudienceValue,
  EditorialMove,
  EnergyLevel,
  PodcastScript,
  Speech,
  VocalProviderName,
} from "../types";
import { EpisodeRepairService } from "./EpisodeRepairService";

const speaker = {
  id: "s1",
  slug: "host",
  name: "Host",
  personality: "warm",
  voice: {
    id: "v1",
    name: "Voice",
    description: "",
    provider: VocalProviderName.ElevenLabs,
    providerId: "voice",
    settings: {},
  },
  voiceStyle: "natural",
};

function makeSpeech(id: string, message: string): Speech {
  return {
    id,
    speaker,
    message,
    instructions: "continue naturally",
    voice: speaker.voice,
    voiceStyle: speaker.voiceStyle,
    timestamp: new Date(),
    turnBrief: {
      speakerId: speaker.id,
      goal: "Continue naturally.",
      move: EditorialMove.Explain,
      cardIds: [],
      audienceValue: AudienceValue.Understanding,
      desiredEnergy: EnergyLevel.Curious,
    },
  };
}

function makeScript(): PodcastScript {
  return {
    id: "script",
    title: "Episode",
    description: "",
    speakers: [speaker],
    speeches: [
      makeSpeech("sp1", "The original malformed line ... uh"),
      makeSpeech("sp2", "The conversation continues from that point."),
    ],
    materials: [],
    discussionPoints: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("EpisodeRepairService", () => {
  it("persists a validated local repair before changing the transcript", async () => {
    const script = makeScript();
    const issue = {
      id: "malformed_speech:sp1",
      speechId: "sp1",
      category: "malformed_speech" as const,
      reason: "Turn contains accidental model debris",
    };
    const auditAgent = {
      audit: vi
        .fn()
        .mockResolvedValueOnce([issue])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      rewrite: vi.fn().mockResolvedValue("The corrected complete line."),
    };
    const update = vi.fn().mockResolvedValue({
      id: "sp1",
      message: "The corrected complete line.",
    });
    const director = {
      reviewSpeech: vi.fn(async (speech: Speech) => ({
        ...speech,
        review: {
          accepted: true,
          clear: true,
          engaging: true,
          grounded: true,
          advancesBeat: true,
          addsVariety: true,
        },
      })),
    };
    const service = new EpisodeRepairService(
      { update } as any,
      auditAgent as any,
      { evaluate: vi.fn().mockResolvedValue({ accepted: true }) } as any,
      { isUsable: vi.fn().mockReturnValue(true) } as any
    );

    await service.auditAndRepair(script, 720, director as any);

    expect(update).toHaveBeenCalledWith("sp1", {
      message: "The corrected complete line.",
      review: expect.objectContaining({ accepted: true }),
    });
    expect(script.speeches[0].message).toBe("The corrected complete line.");
    expect(script.productionOutcome?.audit?.repairedSpeechIds).toEqual(["sp1"]);
  });

  it("leaves the original untouched when persistence fails", async () => {
    const script = makeScript();
    const issue = {
      id: "malformed_speech:sp1",
      speechId: "sp1",
      category: "malformed_speech" as const,
      reason: "Turn contains accidental model debris",
    };
    const service = new EpisodeRepairService(
      { update: vi.fn().mockRejectedValue(new Error("disk full")) } as any,
      {
        audit: vi
          .fn()
          .mockResolvedValueOnce([issue])
          .mockResolvedValueOnce([]),
        rewrite: vi.fn().mockResolvedValue("The corrected complete line."),
      } as any,
      { evaluate: vi.fn().mockResolvedValue({ accepted: true }) } as any,
      { isUsable: vi.fn().mockReturnValue(true) } as any
    );

    await service.auditAndRepair(script, 720, {
      reviewSpeech: vi.fn(async (speech: Speech) => ({
        ...speech,
        review: { accepted: true },
      })),
    } as any);

    expect(script.speeches[0].message).toContain("... uh");
    expect(script.productionOutcome?.audit?.unresolvedIssueIds).toEqual([
      issue.id,
    ]);
  });

  it("does not persist a repair that creates a local follow-on issue", async () => {
    const script = makeScript();
    const issue = {
      id: "continuity:sp1",
      speechId: "sp1",
      category: "continuity" as const,
      reason: "Turn breaks the exchange",
    };
    const followOn = {
      id: "continuity:sp2",
      speechId: "sp2",
      category: "continuity" as const,
      reason: "Following turn no longer connects",
    };
    const update = vi.fn();
    const service = new EpisodeRepairService(
      { update } as any,
      {
        audit: vi
          .fn()
          .mockResolvedValueOnce([issue])
          .mockResolvedValueOnce([followOn]),
        rewrite: vi.fn().mockResolvedValue("A polished but disruptive line."),
      } as any,
      { evaluate: vi.fn().mockResolvedValue({ accepted: true }) } as any,
      { isUsable: vi.fn().mockReturnValue(true) } as any
    );

    await service.auditAndRepair(script, 720, {
      reviewSpeech: vi.fn(async (speech: Speech) => ({
        ...speech,
        review: { accepted: true },
      })),
    } as any);

    expect(update).not.toHaveBeenCalled();
    expect(script.speeches[0].message).toContain("... uh");
  });

  it("rolls back a persisted repair that fails the final episode audit", async () => {
    const script = makeScript();
    const issue = {
      id: "malformed_speech:sp1",
      speechId: "sp1",
      category: "malformed_speech" as const,
      reason: "Turn contains accidental model debris",
    };
    const update = vi.fn().mockResolvedValue({ id: "sp1" });
    const service = new EpisodeRepairService(
      { update } as any,
      {
        audit: vi
          .fn()
          .mockResolvedValueOnce([issue])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([issue]),
        rewrite: vi.fn().mockResolvedValue("The initially accepted repair."),
      } as any,
      { evaluate: vi.fn().mockResolvedValue({ accepted: true }) } as any,
      { isUsable: vi.fn().mockReturnValue(true) } as any
    );

    await service.auditAndRepair(script, 720, {
      reviewSpeech: vi.fn(async (speech: Speech) => ({
        ...speech,
        review: { accepted: true },
      })),
    } as any);

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1][1].message).toContain("... uh");
    expect(script.speeches[0].message).toContain("... uh");
    expect(script.productionOutcome?.audit?.repairedSpeechIds).toEqual([]);
  });
});
