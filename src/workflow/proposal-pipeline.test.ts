import { describe, expect, it, vi } from "vitest";
import { inspectEpisode } from "./EpisodeInspector";
import { proposeTurnDirection } from "../agents/TurnDirectionProposer";
import { verifyCoveredPointClaims } from "../agents/CoverageVerifier";
import { repairTurnAssignment } from "../agents/TurnAssignmentRepairPipeline";
import { SpeakerRolePolicy } from "../agents/SpeakerRolePolicy";
import { DialogueCadencePolicy } from "../agents/DialogueCadencePolicy";
import {
  AudienceValue,
  EditorialMove,
  EnergyLevel,
  DiscussionPoint,
  PodcastScript,
  Speaker,
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
  const s1 = makeSpeaker("s1");
  const s2 = makeSpeaker("s2");
  return {
    id: "script-1",
    title: "Test",
    description: "Test",
    speakers: [s1, s2],
    speeches: [
      {
        id: "1",
        speaker: s1,
        message: "Welcome to the show, today we're talking about oceans.",
        instructions: "",
        voice: s1.voice,
        voiceStyle: s1.voiceStyle,
        timestamp: new Date(),
      },
    ],
    materials: [],
    discussionPoints: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("inspection -> proposal -> verification -> repair pipeline", () => {
  it("ping-pongs to the other speaker and never mutates script/points along the way", async () => {
    const script = makeScript();
    const points: DiscussionPoint[] = [
      { id: "p1", text: "Ocean acidification basics", covered: false },
    ];
    const beforeScript = JSON.parse(JSON.stringify(script));
    const beforePoints = JSON.parse(JSON.stringify(points));

    const inspection = inspectEpisode(
      script,
      { maxTurns: 20, maxDuration: 600 },
      1,
      0,
      points.length,
      0
    );
    expect(inspection.isFinalTurn).toBe(false);

    const callDirectionModel = vi.fn().mockResolvedValue({
      speakerId: "s1", // deliberately wrong — script has 2 speakers, so ping-pong must override this
      direction: "Explain ocean acidification basics",
      coveredPointIds: ["p1"],
      coveredBeatIds: [],
      move: EditorialMove.Explain,
      audienceValue: AudienceValue.Understanding,
      desiredEnergy: EnergyLevel.Curious,
    });

    const proposal = await proposeTurnDirection(
      callDirectionModel,
      script,
      "Plan narrative",
      points,
      inspection,
      undefined
    );
    expect(proposal.claimedCoveredPointIds).toEqual(["p1"]);

    const callVerificationModel = vi.fn().mockResolvedValue({ confirmedPointIds: ["p1"] });
    const confirmedPointIds = await verifyCoveredPointClaims(
      callVerificationModel,
      "Welcome to the show, today we're talking about oceans.",
      points
    );
    expect(confirmedPointIds).toEqual(["p1"]);

    const turnBrief = {
      speakerId: proposal.speakerId,
      goal: proposal.direction,
      move: proposal.move ?? EditorialMove.Explain,
      cardIds: proposal.cardIds,
      audienceValue: proposal.audienceValue ?? AudienceValue.Understanding,
      desiredEnergy: proposal.desiredEnergy ?? EnergyLevel.Curious,
    };

    const repaired = repairTurnAssignment(
      script,
      proposal.speakerId,
      turnBrief,
      proposal.direction,
      new SpeakerRolePolicy(),
      new DialogueCadencePolicy()
    );

    // Two-speaker ping-pong must win over the (deliberately wrong) proposed
    // speakerId of "s1" — the last speaker was s1, so the next must be s2.
    expect(repaired.speaker.id).toBe("s2");

    expect(JSON.parse(JSON.stringify(script))).toEqual(beforeScript);
    expect(JSON.parse(JSON.stringify(points))).toEqual(beforePoints);
    expect(points[0].covered).toBe(false);
  });
});
