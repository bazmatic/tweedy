import { describe, expect, it, vi } from "vitest";
import { DirectorAgent } from "./DirectorAgent";
import { PodcastScript, Speaker, VocalProviderName } from "../types";

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
    isExpert: false,
  };
}

function makeScript(overrides: Partial<PodcastScript> = {}): PodcastScript {
  return {
    id: "script-1",
    title: "Test Script",
    description: "A test script",
    speakers: [makeSpeaker("s1"), makeSpeaker("s2")],
    speeches: [],
    materials: [],
    discussionPoints: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("DirectorAgent.createPodcastPlan", () => {
  it("assigns sequential ids to points and stores them on the script", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    vi.spyOn(agent as any, "callModelForToolInput").mockResolvedValue({
      narrative: "Open with intros, then dig in.",
      points: ["Point A", "Point B", "Point C"],
    });

    await agent.createPodcastPlan();

    expect(script.discussionPoints).toEqual([
      { id: "p1", text: "Point A", covered: false },
      { id: "p2", text: "Point B", covered: false },
      { id: "p3", text: "Point C", covered: false },
    ]);
  });
});

describe("DirectorAgent.chooseNextSpeaker coverage tracking", () => {
  it("marks points covered from coveredPointIds and reflects it on the next call's prompt", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(agent as any, "callModelForToolInput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A", "Point B"],
    });
    await agent.createPodcastPlan();

    const chooseSpy = vi.spyOn(agent as any, "callModelForToolInput");
    chooseSpy.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Talk about A",
      coveredPointIds: ["p1"],
    });

    await agent.chooseNextSpeaker(script);

    expect(script.discussionPoints.find((p) => p.id === "p1")?.covered).toBe(true);
    expect(script.discussionPoints.find((p) => p.id === "p2")?.covered).toBe(false);

    chooseSpy.mockResolvedValueOnce({
      speakerId: "s2",
      direction: "Talk about B",
      coveredPointIds: [],
    });

    await agent.chooseNextSpeaker(script);

    const prompt = (chooseSpy.mock.calls[2][0] as any)[0].content as string;
    expect(prompt).toContain("p2: Point B");
    expect(prompt).not.toContain("p1: Point A");
  });
});

describe("DirectorAgent velocity / pacing", () => {
  it("requests a summary turn when behind pace with 2+ open points", async () => {
    const script = makeScript({
      speeches: [
        {
          id: "sp1",
          speaker: makeSpeaker("s1"),
          message: new Array(150).fill("word").join(" "),
          instructions: "",
          voice: makeSpeaker("s1").voice,
          voiceStyle: "neutral",
          timestamp: new Date(),
        },
      ],
    });
    // 150 words already spoken at 150 wpm = 1 minute elapsed; a 2-minute
    // budget leaves 1 minute for 3 uncovered points — well behind pace.
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 120 });

    vi.spyOn(agent as any, "callModelForToolInput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A", "Point B", "Point C"],
    });
    await agent.createPodcastPlan();

    vi.spyOn(agent as any, "callModelForToolInput").mockResolvedValueOnce({
      speakerId: "s1",
      direction: "keep going",
      coveredPointIds: [],
    });

    const result = await agent.chooseNextSpeaker(script);

    expect(result.requestSummary).toBe(true);
  });

  it("does not request a summary before there is any elapsed speaking time", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 6000 });

    vi.spyOn(agent as any, "callModelForToolInput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A"],
    });
    await agent.createPodcastPlan();

    vi.spyOn(agent as any, "callModelForToolInput").mockResolvedValueOnce({
      speakerId: "s1",
      direction: "keep going",
      coveredPointIds: [],
    });

    const result = await agent.chooseNextSpeaker(script);

    expect(result.requestSummary).toBe(false);
  });
});
