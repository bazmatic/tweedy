import { describe, expect, it, vi } from "vitest";
import { PodcastScript, VocalProviderName } from "../types";
import { EpisodeAuditAgent } from "./EpisodeAuditAgent";

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

function script(message: string): PodcastScript {
  return {
    id: "script",
    title: "Episode",
    description: "",
    speakers: [speaker],
    speeches: [
      {
        id: "sp1",
        speaker,
        message,
        instructions: "",
        voice: speaker.voice,
        voiceStyle: speaker.voiceStyle,
        timestamp: new Date(),
      },
    ],
    materials: [],
    discussionPoints: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("EpisodeAuditAgent", () => {
  it("detects deterministic duration language and malformed debris", async () => {
    const agent = new EpisodeAuditAgent();
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValue({
      issues: [],
    });

    const issues = await agent.audit(
      script("Thanks for spending this hour with us ... uh"),
      720
    );

    expect(issues.map((issue) => issue.category)).toEqual([
      "duration_language",
      "malformed_speech",
    ]);
  });

  it("ignores audit issues that do not identify a real speech", async () => {
    const agent = new EpisodeAuditAgent();
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValue({
      issues: [
        {
          speechId: "invented",
          category: "continuity",
          reason: "Invented target",
        },
      ],
    });

    await expect(agent.audit(script("A clean closing line."), 720)).resolves.toEqual(
      []
    );
  });
});
