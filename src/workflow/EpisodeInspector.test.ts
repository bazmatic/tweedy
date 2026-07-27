import { describe, expect, it } from "vitest";
import {
  calculateProgress,
  calculateVelocity,
  estimateElapsedSeconds,
  findDominantSpeaker,
  inspectEpisode,
} from "./EpisodeInspector";
import {
  EpistemicRole,
  PodcastScript,
  Speaker,
  Speech,
  SourceType,
  VocalProviderName,
} from "../types";
import { SpeakerAgentToolName } from "../agents/speaker-tools";
import { SpeakerRoleProfileResolver } from "../agents/SpeakerRoleProfileResolver";

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

function makeSpeech(
  speaker: Speaker,
  message: string,
  tool?: SpeakerAgentToolName
): Speech {
  return {
    id: `${speaker.id}-${message.length}`,
    speaker,
    message,
    instructions: "",
    voice: speaker.voice,
    voiceStyle: speaker.voiceStyle,
    timestamp: new Date(),
    tool,
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

describe("estimateElapsedSeconds", () => {
  it("converts total spoken words to seconds at 150 wpm", () => {
    const s1 = makeSpeaker("s1");
    const script = makeScript({
      speeches: [makeSpeech(s1, Array(150).fill("word").join(" "))],
    });
    expect(estimateElapsedSeconds(script)).toBeCloseTo(60, 0);
  });
});

describe("calculateProgress", () => {
  it("is 0 with no speeches", () => {
    expect(calculateProgress(makeScript(), 600)).toBe(0);
  });

  it("caps at 100 once elapsed exceeds maxDuration", () => {
    const s1 = makeSpeaker("s1");
    const script = makeScript({
      speeches: [makeSpeech(s1, Array(1500).fill("word").join(" "))],
    });
    expect(calculateProgress(script, 60)).toBe(100);
  });
});

describe("calculateVelocity", () => {
  it("reports unknown pace when there are no discussion points", () => {
    const velocity = calculateVelocity(makeScript(), 600, 0, 0);
    expect(velocity.paceStatus).toBe("unknown");
  });

  it("reports unknown pace when nothing has been said yet", () => {
    const velocity = calculateVelocity(makeScript(), 600, 5, 0);
    expect(velocity.paceStatus).toBe("unknown");
  });

  it("reports behind when covered pace is well under the needed pace", () => {
    const s1 = makeSpeaker("s1");
    // ~120 seconds of speech elapsed (300 words at 150 wpm), only 1 of 10
    // points covered, 8 minutes remaining of a 10 minute budget.
    // Actual pace: 0.2 pts/min, needed pace: 1.8 pts/min => behind
    const script = makeScript({
      speeches: [makeSpeech(s1, Array(300).fill("word").join(" "))],
    });
    const velocity = calculateVelocity(script, 600, 10, 1);
    expect(velocity.paceStatus).toBe("behind");
    expect(velocity.openCount).toBe(9);
  });
});

describe("findDominantSpeaker", () => {
  it("returns null with fewer than 3 speeches", () => {
    const s1 = makeSpeaker("s1");
    const script = makeScript({ speeches: [makeSpeech(s1, "hello there")] });
    expect(findDominantSpeaker(script, new SpeakerRoleProfileResolver())).toBeNull();
  });

  it("flags a non-expert speaker who dominates word share", () => {
    const s1 = makeSpeaker("s1");
    const s2 = makeSpeaker("s2");
    const script = makeScript({
      speakers: [s1, s2],
      speeches: [
        makeSpeech(s1, Array(90).fill("word").join(" ")),
        makeSpeech(s2, "short reply"),
        makeSpeech(s1, Array(90).fill("word").join(" ")),
      ],
    });
    const result = findDominantSpeaker(script, new SpeakerRoleProfileResolver());
    expect(result?.speakerId).toBe("s1");
    expect(result?.share).toBeGreaterThan(0.55);
  });

  it("exempts experts from the dominance flag", () => {
    const s1 = makeSpeaker("s1");
    s1.roleProfile = {
      epistemicRole: EpistemicRole.Expert,
      sourceAccess: "full" as any,
      uncertaintyStyle: "precise" as any,
    };
    const s2 = makeSpeaker("s2");
    const script = makeScript({
      speakers: [s1, s2],
      speeches: [
        makeSpeech(s1, Array(90).fill("word").join(" ")),
        makeSpeech(s2, "short reply"),
        makeSpeech(s1, Array(90).fill("word").join(" ")),
      ],
    });
    expect(findDominantSpeaker(script, new SpeakerRoleProfileResolver())).toBeNull();
  });
});

describe("inspectEpisode", () => {
  it("marks isFinalTurn once turnsUsed reaches maxTurns", () => {
    const inspection = inspectEpisode(makeScript(), { maxTurns: 5, maxDuration: 600 }, 5, 0, 0, 0);
    expect(inspection.isFinalTurn).toBe(true);
  });

  it("marks isFinalTurn once progress reaches 100", () => {
    const s1 = makeSpeaker("s1");
    const script = makeScript({
      speeches: [makeSpeech(s1, Array(1500).fill("word").join(" "))],
    });
    const inspection = inspectEpisode(script, { maxTurns: 50, maxDuration: 60 }, 1, 0, 0, 0);
    expect(inspection.isFinalTurn).toBe(true);
  });

  it("marks isFinalTurn once lateStageTurns reaches the cap", () => {
    const inspection = inspectEpisode(makeScript(), { maxTurns: 50, maxDuration: 600 }, 1, 2, 0, 0);
    expect(inspection.isFinalTurn).toBe(true);
  });

  it("detects an already-announced time-pressure turn", () => {
    const s1 = makeSpeaker("s1");
    const script = makeScript({
      speeches: [makeSpeech(s1, "we're almost out of time", SpeakerAgentToolName.NEARLY_OUT_OF_TIME)],
    });
    const inspection = inspectEpisode(script, { maxTurns: 50, maxDuration: 600 }, 1, 0, 0, 0);
    expect(inspection.hasAnnouncedTimePressure).toBe(true);
  });

  it("does not mutate the script it inspects", () => {
    const s1 = makeSpeaker("s1");
    const script = makeScript({ speeches: [makeSpeech(s1, "hello")] });
    const before = JSON.parse(JSON.stringify(script));
    inspectEpisode(script, { maxTurns: 10, maxDuration: 600 }, 1, 0, 3, 1);
    expect(JSON.parse(JSON.stringify(script))).toEqual(before);
  });
});
