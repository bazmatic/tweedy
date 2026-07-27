// src/agents/TurnDirectionProposer.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  buildOpenPointsSection,
  buildVelocityNote,
  buildWrapUpNote,
  proposeTurnDirection,
} from "./TurnDirectionProposer";
import { EpisodeInspection } from "../workflow/EpisodeInspector";
import { DiscussionPoint, PodcastScript, VocalProviderName } from "../types";

function makeInspection(overrides: Partial<EpisodeInspection> = {}): EpisodeInspection {
  return {
    progress: 10,
    elapsedSeconds: 60,
    isFinalTurn: false,
    velocity: {
      coveredCount: 0,
      openCount: 3,
      elapsedMinutes: 1,
      remainingMinutes: 9,
      paceStatus: "on-pace",
    },
    dominantSpeaker: null,
    hasAnnouncedTimePressure: false,
    ...overrides,
  };
}

function makeScript(overrides: Partial<PodcastScript> = {}): PodcastScript {
  return {
    id: "script-1",
    title: "Test",
    description: "Test",
    speakers: [
      {
        id: "s1",
        slug: "s1",
        name: "Speaker One",
        personality: "curious",
        voice: {
          id: "v1",
          name: "Voice",
          description: "",
          provider: VocalProviderName.ElevenLabs,
          providerId: "provider-id",
          settings: {},
        },
        voiceStyle: "neutral",
      },
    ],
    speeches: [],
    materials: [],
    discussionPoints: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("buildOpenPointsSection", () => {
  it("lists only uncovered points", () => {
    const points: DiscussionPoint[] = [
      { id: "p1", text: "Point A", covered: false },
      { id: "p2", text: "Point B", covered: true },
    ];
    const section = buildOpenPointsSection(points);
    expect(section).toContain("p1: Point A");
    expect(section).not.toContain("Point B");
  });

  it("reports full coverage once every point is covered", () => {
    const points: DiscussionPoint[] = [{ id: "p1", text: "Point A", covered: true }];
    expect(buildOpenPointsSection(points)).toContain("All discussion points have been covered");
  });

  it("returns an empty string with no points at all", () => {
    expect(buildOpenPointsSection([])).toBe("");
  });
});

describe("buildWrapUpNote", () => {
  it("instructs a closing statement on the final turn", () => {
    const note = buildWrapUpNote(makeInspection({ isFinalTurn: true }));
    expect(note).toContain("final turn");
  });

  it("is empty well before the closing stage", () => {
    expect(buildWrapUpNote(makeInspection({ progress: 20 }))).toBe("");
  });
});

describe("buildVelocityNote", () => {
  it("is empty unless pace is behind", () => {
    expect(
      buildVelocityNote(makeInspection({ velocity: { coveredCount: 1, openCount: 1, elapsedMinutes: 1, remainingMinutes: 5, paceStatus: "on-pace" } }), [])
    ).toBe("");
  });

  it("names the next open points when behind pace", () => {
    const points: DiscussionPoint[] = [
      { id: "p1", text: "Point A", covered: false },
      { id: "p2", text: "Point B", covered: false },
    ];
    const note = buildVelocityNote(
      makeInspection({ velocity: { coveredCount: 0, openCount: 2, elapsedMinutes: 5, remainingMinutes: 2, paceStatus: "behind" } }),
      points
    );
    expect(note).toContain("behind pace");
    expect(note).toContain("p1: Point A");
  });
});

describe("proposeTurnDirection", () => {
  it("returns a proposal without mutating the script or points", async () => {
    const script = makeScript();
    const points: DiscussionPoint[] = [{ id: "p1", text: "Point A", covered: false }];
    const beforeScript = JSON.parse(JSON.stringify(script));
    const beforePoints = JSON.parse(JSON.stringify(points));

    const callModel = vi.fn().mockResolvedValue({
      speakerId: "s1",
      direction: "Talk about point A",
      coveredPointIds: ["p1"],
      coveredBeatIds: [],
    });

    const proposal = await proposeTurnDirection(
      callModel,
      script,
      "A plan narrative",
      points,
      makeInspection(),
      undefined
    );

    expect(proposal.speakerId).toBe("s1");
    expect(proposal.claimedCoveredPointIds).toEqual(["p1"]);
    expect(JSON.parse(JSON.stringify(script))).toEqual(beforeScript);
    expect(JSON.parse(JSON.stringify(points))).toEqual(beforePoints);
    expect(points[0].covered).toBe(false);
  });
});
