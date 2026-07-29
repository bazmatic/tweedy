import { describe, expect, it } from "vitest";
import {
  fallbackSpeaker,
  pingPongSpeaker,
  repairTurnAssignment,
  resolveProposedSpeaker,
  resolveSpeakerReference,
} from "./TurnAssignmentRepairPipeline";
import { SpeakerRolePolicy } from "./SpeakerRolePolicy";
import { DialogueCadencePolicy } from "./DialogueCadencePolicy";
import {
  AudienceValue,
  EditorialMove,
  EnergyLevel,
  PodcastScript,
  Speaker,
  TurnBrief,
  VocalProviderName,
} from "../types";

function makeSpeaker(id: string): Speaker {
  return {
    id,
    slug: id,
    name: `Speaker ${id}`,
    personality: "curious",
    voice: {
      id: `voice-${id}`,
      name: "Voice",
      description: "",
      provider: VocalProviderName.ElevenLabs,
      providerId: "provider-id",
      settings: {},
    },
    voiceStyle: "neutral",
  };
}

function makeScript(overrides: Partial<PodcastScript> = {}): PodcastScript {
  return {
    id: "script-1",
    title: "Test",
    description: "Test",
    speakers: [makeSpeaker("s1"), makeSpeaker("s2")],
    speeches: [],
    materials: [],
    discussionPoints: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeTurnBrief(speakerId: string): TurnBrief {
  return {
    speakerId,
    goal: "Discuss the next point",
    move: EditorialMove.Explain,
    cardIds: [],
    audienceValue: AudienceValue.Understanding,
    desiredEnergy: EnergyLevel.Curious,
  };
}

describe("pingPongSpeaker", () => {
  it("picks the other speaker in a two-speaker script", () => {
    const [s1, s2] = [makeSpeaker("s1"), makeSpeaker("s2")];
    const script = makeScript({
      speakers: [s1, s2],
      speeches: [
        {
          id: "1",
          speaker: s1,
          message: "hi",
          instructions: "",
          voice: s1.voice,
          voiceStyle: s1.voiceStyle,
          timestamp: new Date(),
        },
      ],
    });
    expect(pingPongSpeaker(script).id).toBe("s2");
  });

  it("defaults to the first speaker when nobody has spoken yet", () => {
    const script = makeScript();
    expect(pingPongSpeaker(script).id).toBe("s1");
  });
});

describe("resolveSpeakerReference", () => {
  it("matches by id, slug, or name case-insensitively", () => {
    const script = makeScript();
    expect(resolveSpeakerReference(script, "S1")?.id).toBe("s1");
    expect(resolveSpeakerReference(script, "Speaker s2")?.id).toBe("s2");
    expect(resolveSpeakerReference(script, "unknown")).toBeUndefined();
  });
});

describe("resolveProposedSpeaker", () => {
  it("uses ping-pong for exactly two speakers, ignoring the proposed id", () => {
    const script = makeScript();
    const result = resolveProposedSpeaker(script, "nonexistent-id");
    expect(result.speaker.id).toBe("s1");
    expect(result.usedFallback).toBe(false);
  });

  it("falls back when a 3+ speaker script proposes an unknown id", () => {
    const s3 = makeSpeaker("s3");
    const script = makeScript({ speakers: [makeSpeaker("s1"), makeSpeaker("s2"), s3] });
    const result = resolveProposedSpeaker(script, "unknown-id");
    expect(result.usedFallback).toBe(true);
    expect(["s1", "s2", "s3"]).toContain(result.speaker.id);
  });

  it("resolves a known id directly in a 3+ speaker script", () => {
    const s3 = makeSpeaker("s3");
    const script = makeScript({ speakers: [makeSpeaker("s1"), makeSpeaker("s2"), s3] });
    const result = resolveProposedSpeaker(script, "s3");
    expect(result.speaker.id).toBe("s3");
    expect(result.usedFallback).toBe(false);
  });
});

describe("repairTurnAssignment", () => {
  it("chains speaker resolution, role repair and cadence repair without mutating the script", () => {
    const script = makeScript();
    const before = JSON.parse(JSON.stringify(script));
    const result = repairTurnAssignment(
      script,
      "s1",
      makeTurnBrief("s1"),
      "Discuss the next point",
      new SpeakerRolePolicy(),
      new DialogueCadencePolicy()
    );
    expect(result.speaker).toBeDefined();
    expect(result.turnBrief).toBeDefined();
    expect(JSON.parse(JSON.stringify(script))).toEqual(before);
  });
});
