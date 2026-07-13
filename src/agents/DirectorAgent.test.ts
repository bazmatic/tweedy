import { describe, expect, it, vi } from "vitest";
import { DirectorAgent } from "./DirectorAgent";
import { MaterialSummarizerAgent } from "./MaterialSummarizerAgent";
import {
  PodcastMaterial,
  PodcastScript,
  SourceType,
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

function makeMaterial(overrides: Partial<PodcastMaterial> = {}): PodcastMaterial {
  return {
    id: "m1",
    title: "Some Article",
    content: "Full raw article content that should not appear verbatim.",
    source: "https://example.com",
    sourceType: SourceType.Web,
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  };
}

describe("DirectorAgent.createPodcastPlan", () => {
  it("builds the plan prompt from summarized materials, not raw content", async () => {
    const material = makeMaterial();
    const script = makeScript({ materials: [material] });
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(
      MaterialSummarizerAgent.prototype,
      "summarize"
    ).mockResolvedValue("A concise podcast-ready summary of the article.");

    const callModelForToolInputSpy = vi
      .spyOn(agent as any, "callModelForToolInput")
      .mockResolvedValue({
        narrative: "Open with intros, then dig in.",
        points: ["Point A"],
      });

    await agent.createPodcastPlan();

    const promptContent = (callModelForToolInputSpy.mock.calls[0][0] as any)[0]
      .content as string;
    expect(promptContent).toContain("A concise podcast-ready summary of the article.");
    expect(promptContent).not.toContain(material.content);
  });

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
    // Verification call confirms the claim.
    chooseSpy.mockResolvedValueOnce({ confirmedPointIds: ["p1"] });

    await agent.chooseNextSpeaker(script);

    expect(script.discussionPoints.find((p) => p.id === "p1")?.covered).toBe(true);
    expect(script.discussionPoints.find((p) => p.id === "p2")?.covered).toBe(false);

    chooseSpy.mockResolvedValueOnce({
      speakerId: "s2",
      direction: "Talk about B",
      coveredPointIds: [],
    });

    await agent.chooseNextSpeaker(script);

    const prompt = (chooseSpy.mock.calls[3][0] as any)[0].content as string;
    expect(prompt).toContain("p2: Point B");
    expect(prompt).not.toContain("p1: Point A");
  });

  it("does not mark a point covered if verification rejects the director's claim (hallucination regression)", async () => {
    // Regression test for a bug where the director claimed a point was
    // covered because the speech mentioned a topically-adjacent detail
    // (an oxygen tank explosion) rather than the point's actual specific
    // content (the CO2 scrubber duct-tape hack).
    const script = makeScript({
      speeches: [
        {
          id: "sp1",
          speaker: makeSpeaker("s1"),
          message:
            "The oxygen tank explosion crippled the spacecraft's power and life support systems.",
          instructions: "",
          voice: makeSpeaker("s1").voice,
          voiceStyle: "neutral",
          timestamp: new Date(),
        },
      ],
    });
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(agent as any, "callModelForToolInput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["CO2 scrubber duct-tape hack"],
    });
    await agent.createPodcastPlan();

    const chooseSpy = vi.spyOn(agent as any, "callModelForToolInput");
    chooseSpy.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Keep going",
      coveredPointIds: ["p1"],
    });
    // Verification call rejects the hallucinated claim.
    chooseSpy.mockResolvedValueOnce({ confirmedPointIds: [] });

    await agent.chooseNextSpeaker(script);

    expect(script.discussionPoints.find((p) => p.id === "p1")?.covered).toBe(
      false
    );
  });

  it("skips verification and applies coveredPointIds directly when there are no candidate points", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(agent as any, "callModelForToolInput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A"],
    });
    await agent.createPodcastPlan();

    const chooseSpy = vi.spyOn(agent as any, "callModelForToolInput");
    chooseSpy.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Talk",
      coveredPointIds: [],
    });

    await agent.chooseNextSpeaker(script);

    // Only createPodcastPlan's call plus chooseNextSpeaker's call should have
    // happened — no verification call, since there were no claimed points.
    expect(chooseSpy).toHaveBeenCalledTimes(2);
  });
});

describe("DirectorAgent progress / wrap-up pacing", () => {
  it("drives progress and the nearly-out-of-time nudge from estimated duration, not turn count", async () => {
    // 300 words at 150 wpm = 2 minutes elapsed against a 2m20s budget
    // (140s) => ~86% duration progress, well past the 85% threshold,
    // even though only a single turn has been used out of a maxTurns of 10.
    const script = makeScript({
      speeches: [
        {
          id: "sp1",
          speaker: makeSpeaker("s1"),
          message: new Array(300).fill("word").join(" "),
          instructions: "",
          voice: makeSpeaker("s1").voice,
          voiceStyle: "neutral",
          timestamp: new Date(),
        },
      ],
    });
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 140 });

    vi.spyOn(agent as any, "callModelForToolInput").mockResolvedValueOnce({
      narrative: "plan",
      points: [],
    });
    await agent.createPodcastPlan();

    vi.spyOn(agent as any, "callModelForToolInput").mockResolvedValueOnce({
      speakerId: "s1",
      direction: "keep going",
      coveredPointIds: [],
    });

    const result = await agent.chooseNextSpeaker(script);

    expect(result.forceNearlyOutOfTime).toBe(true);
    expect(result.timeStatus).toContain("almost out of time");
  });

  it("does not treat rising turn count alone as progress when duration is still low", async () => {
    // No speeches ever added, so estimated elapsed duration stays at 0
    // regardless of how many turns are consumed; turnsUsed climbing toward
    // maxTurns should not trigger the nearly-out-of-time nudge on its own.
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 5, maxDuration: 600 });

    const callModelSpy = vi
      .spyOn(agent as any, "callModelForToolInput")
      .mockResolvedValue({
        speakerId: "s1",
        direction: "keep going",
        coveredPointIds: [],
      });
    callModelSpy.mockResolvedValueOnce({ narrative: "plan", points: [] });
    await agent.createPodcastPlan();

    // Consume turns up to (but not including) the maxTurns safety ceiling.
    let result;
    for (let i = 0; i < 4; i++) {
      result = await agent.chooseNextSpeaker(script);
    }

    expect(result!.forceNearlyOutOfTime).toBe(false);
    expect(result!.timeStatus).not.toContain("almost out of time");
  });

  it("still forces a hard close once turnsUsed reaches the maxTurns safety ceiling", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 3, maxDuration: 600 });

    const callModelSpy = vi
      .spyOn(agent as any, "callModelForToolInput")
      .mockResolvedValue({
        speakerId: "s1",
        direction: "keep going",
        coveredPointIds: [],
      });
    callModelSpy.mockResolvedValueOnce({ narrative: "plan", points: [] });
    await agent.createPodcastPlan();

    let result;
    for (let i = 0; i < 3; i++) {
      result = await agent.chooseNextSpeaker(script);
    }

    expect(result!.timeStatus).toContain("final turn");
    expect(result!.forceNearlyOutOfTime).toBe(false);
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
