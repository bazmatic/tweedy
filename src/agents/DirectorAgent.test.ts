import { describe, expect, it, vi } from "vitest";
import { DirectorAgent } from "./DirectorAgent";
import { ModelTask } from "../providers/ModelRoutingPolicy";
import { SpeakerAgentToolName } from "./speaker-tools";
import {
  EditorialCardKind,
  AudienceValue,
  BeatPurpose,
  EditorialMove,
  EnergyLevel,
  PodcastMaterial,
  PodcastScript,
  SourceType,
  Speaker,
  Speech,
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

function appendClosingSpeech(script: PodcastScript): void {
  const speaker = script.speakers[0];
  script.speeches.push({
    id: "closing",
    speaker,
    message: "Thanks for listening. Until next time.",
    instructions: "warm",
    voice: speaker.voice,
    voiceStyle: speaker.voiceStyle,
    timestamp: new Date(),
    tool: SpeakerAgentToolName.CLOSING_STATEMENT,
  });
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
  it("builds the plan prompt from prepared materials, not raw content", async () => {
    const material = makeMaterial();
    const script = makeScript({ materials: [material] });
    const materialPreparer = {
      prepare: vi.fn().mockResolvedValue({
        materialId: material.id,
        synopsis: "A concise podcast-ready summary of the article.",
        cards: [
          {
            id: "m1-card-1",
            materialId: material.id,
            kind: EditorialCardKind.Surprise,
            content: "A memorable detail.",
            evidence: [],
            relatedCardIds: [],
            tags: [],
          },
        ],
      }),
    };
    const agent = new DirectorAgent(
      script,
      { maxTurns: 10, maxDuration: 600 },
      { materialPreparer }
    );

    const callModelForStructuredOutputSpy = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({
        narrative: "Open with intros, then dig in.",
        points: ["Point A"],
      });

    await agent.createPodcastPlan();

    expect(callModelForStructuredOutputSpy.mock.calls[0][0]).toBe(
      ModelTask.EpisodePlanning
    );
    const promptContent = (callModelForStructuredOutputSpy.mock.calls[0][1] as any)[0]
      .content as string;
    expect(promptContent).toContain("A concise podcast-ready summary of the article.");
    expect(promptContent).not.toContain(material.content);
  });

  it("assigns sequential ids to points and stores them on the script", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValue({
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

  it("stores a listener-centred sequence of conversation beats", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValue({
      narrative: "Hook, explain, then pay off.",
      points: ["A turning point"],
      beats: [
        {
          purpose: BeatPurpose.Hook,
          goal: "Open with the surprising rejection letter.",
          cardIds: ["m1-card-1"],
          desiredEnergy: EnergyLevel.Curious,
          targetTurns: 1,
        },
      ],
    });

    await agent.createPodcastPlan();

    expect(script.conversationBeats).toEqual([
      expect.objectContaining({
        id: "b1",
        purpose: BeatPurpose.Hook,
        goal: "Open with the surprising rejection letter.",
        covered: false,
      }),
    ]);
  });
});

describe("DirectorAgent editorial turn briefs", () => {
  it("returns the selected move and audience value as a structured brief", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    const call = vi.spyOn(agent as any, "callModelForStructuredOutput");
    call.mockResolvedValueOnce({ narrative: "plan", points: [] });
    await agent.createPodcastPlan();
    call.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Tell the short backstage story.",
      goal: "Humanise the subject.",
      move: EditorialMove.TellStory,
      audienceValue: AudienceValue.Connection,
      desiredEnergy: EnergyLevel.Warm,
      cardIds: ["m1-card-1"],
      coveredPointIds: [],
    });

    const result = await agent.chooseNextSpeaker(script);

    expect(result.turnBrief).toEqual(
      expect.objectContaining({
        speakerId: "s1",
        goal: "Humanise the subject.",
        move: EditorialMove.TellStory,
        audienceValue: AudienceValue.Connection,
        desiredEnergy: EnergyLevel.Warm,
      })
    );
  });

  it("tracks completed conversation beats independently of discussion points", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
    const call = vi.spyOn(agent as any, "callModelForStructuredOutput");
    call.mockResolvedValueOnce({
      narrative: "plan",
      points: ["The main topic"],
      beats: [
        {
          purpose: BeatPurpose.Hook,
          goal: "Open with a vivid detail.",
        },
      ],
    });
    await agent.createPodcastPlan();
    call.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Move into the main topic.",
      coveredPointIds: [],
      coveredBeatIds: ["b1"],
    });

    await agent.chooseNextSpeaker(script);

    expect(script.conversationBeats?.[0]).toEqual(
      expect.objectContaining({ covered: true, coveredAtTurn: 1 })
    );
    expect(script.discussionPoints[0].covered).toBe(false);
  });
});

describe("DirectorAgent.chooseNextSpeaker coverage tracking", () => {
  it("marks points covered from coveredPointIds and reflects it on the next call's prompt", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A", "Point B"],
    });
    await agent.createPodcastPlan();

    const chooseSpy = vi.spyOn(agent as any, "callModelForStructuredOutput");
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

    const prompt = (chooseSpy.mock.calls[3][1] as any)[0].content as string;
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

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["CO2 scrubber duct-tape hack"],
    });
    await agent.createPodcastPlan();

    const chooseSpy = vi.spyOn(agent as any, "callModelForStructuredOutput");
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

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A"],
    });
    await agent.createPodcastPlan();

    const chooseSpy = vi.spyOn(agent as any, "callModelForStructuredOutput");
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

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: [],
    });
    await agent.createPodcastPlan();

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
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
      .spyOn(agent as any, "callModelForStructuredOutput")
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
      .spyOn(agent as any, "callModelForStructuredOutput")
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

describe("DirectorAgent.isConversationComplete", () => {
  it("returns false without a model call when there are no discussion points", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    const callModelSpy = vi.spyOn(agent as any, "callModelForStructuredOutput");

    const result = await agent.isConversationComplete(script);

    expect(result).toBe(false);
    expect(callModelSpy).not.toHaveBeenCalled();
  });

  it("returns false without a model call when some points are still uncovered", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A", "Point B"],
    });
    await agent.createPodcastPlan();

    const callModelSpy = vi.spyOn(agent as any, "callModelForStructuredOutput");
    callModelSpy.mockClear();

    const result = await agent.isConversationComplete(script);

    expect(result).toBe(false);
    expect(callModelSpy).not.toHaveBeenCalled();
  });

  it("asks the model to judge natural conclusion once all points are covered, and returns true when it agrees", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A"],
    });
    await agent.createPodcastPlan();

    const chooseSpy = vi.spyOn(agent as any, "callModelForStructuredOutput");
    chooseSpy.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Talk about A",
      coveredPointIds: ["p1"],
    });
    chooseSpy.mockResolvedValueOnce({ confirmedPointIds: ["p1"] });
    await agent.chooseNextSpeaker(script);
    appendClosingSpeech(script);

    chooseSpy.mockResolvedValueOnce({ isComplete: true });

    const result = await agent.isConversationComplete(script);

    expect(result).toBe(true);
  });

  it("returns false when the model judges the conversation is not yet naturally concluded", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A"],
    });
    await agent.createPodcastPlan();

    const chooseSpy = vi.spyOn(agent as any, "callModelForStructuredOutput");
    chooseSpy.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Talk about A",
      coveredPointIds: ["p1"],
    });
    chooseSpy.mockResolvedValueOnce({ confirmedPointIds: ["p1"] });
    await agent.chooseNextSpeaker(script);
    appendClosingSpeech(script);

    chooseSpy.mockResolvedValueOnce({ isComplete: false });

    const result = await agent.isConversationComplete(script);

    expect(result).toBe(false);
  });

  it("returns false and does not throw if the completeness check fails", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A"],
    });
    await agent.createPodcastPlan();

    const chooseSpy = vi.spyOn(agent as any, "callModelForStructuredOutput");
    chooseSpy.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Talk about A",
      coveredPointIds: ["p1"],
    });
    chooseSpy.mockResolvedValueOnce({ confirmedPointIds: ["p1"] });
    await agent.chooseNextSpeaker(script);
    appendClosingSpeech(script);

    chooseSpy.mockRejectedValueOnce(new Error("model error"));

    const result = await agent.isConversationComplete(script);

    expect(result).toBe(false);
  });

  it("cannot finish after a summary without a dedicated sign-off", async () => {
    const script = makeScript();
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A"],
    });
    await agent.createPodcastPlan();

    const chooseSpy = vi.spyOn(agent as any, "callModelForStructuredOutput");
    chooseSpy.mockResolvedValueOnce({
      speakerId: "s1",
      direction: "Talk about A",
      coveredPointIds: ["p1"],
    });
    chooseSpy.mockResolvedValueOnce({ confirmedPointIds: ["p1"] });
    await agent.chooseNextSpeaker(script);

    const speaker = script.speakers[0];
    script.speeches.push({
      id: "summary",
      speaker,
      message: "That is the key takeaway.",
      instructions: "reflective",
      voice: speaker.voice,
      voiceStyle: speaker.voiceStyle,
      timestamp: new Date(),
      tool: SpeakerAgentToolName.SUMMARIZE,
    });
    chooseSpy.mockClear();

    const result = await agent.isConversationComplete(script);

    expect(result).toBe(false);
    expect(chooseSpy).not.toHaveBeenCalled();
  });
});

describe("DirectorAgent balance note", () => {
  function makeSpeech(speaker: Speaker, wordCount: number, id = "sp"): PodcastScript["speeches"][number] {
    return {
      id,
      speaker,
      message: new Array(wordCount).fill("word").join(" "),
      instructions: "",
      voice: speaker.voice,
      voiceStyle: "neutral",
      timestamp: new Date(),
    };
  }

  it("does not add a balance note before enough speeches have happened", async () => {
    const s1 = makeSpeaker("s1");
    const s2 = makeSpeaker("s2");
    const script = makeScript({
      speakers: [s1, s2],
      speeches: [makeSpeech(s1, 100, "sp1")],
    });
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    const chooseSpy = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValueOnce({ narrative: "plan", points: [] });
    await agent.createPodcastPlan();

    chooseSpy.mockResolvedValueOnce({
      speakerId: "s2",
      direction: "keep going",
      coveredPointIds: [],
    });
    await agent.chooseNextSpeaker(script);

    const prompt = (chooseSpy.mock.calls[1][1] as any)[0].content as string;
    expect(prompt).not.toContain("dominated the conversation");
  });

  it("flags a non-expert speaker who has dominated the word count", async () => {
    const s1 = makeSpeaker("s1");
    const s2 = makeSpeaker("s2");
    const script = makeScript({
      speakers: [s1, s2],
      speeches: [
        makeSpeech(s1, 100, "sp1"),
        makeSpeech(s2, 10, "sp2"),
        makeSpeech(s1, 100, "sp3"),
      ],
    });
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    const chooseSpy = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValueOnce({ narrative: "plan", points: [] });
    await agent.createPodcastPlan();

    chooseSpy.mockResolvedValueOnce({
      speakerId: "s2",
      direction: "keep going",
      coveredPointIds: [],
    });
    await agent.chooseNextSpeaker(script);

    const prompt = (chooseSpy.mock.calls[1][1] as any)[0].content as string;
    expect(prompt).toContain(`${s1.name} has dominated the conversation`);
  });

  it("does not flag an expert speaker even with a dominant word share", async () => {
    const s1: Speaker = { ...makeSpeaker("s1"), isExpert: true };
    const s2 = makeSpeaker("s2");
    const script = makeScript({
      speakers: [s1, s2],
      speeches: [
        makeSpeech(s1, 100, "sp1"),
        makeSpeech(s2, 10, "sp2"),
        makeSpeech(s1, 100, "sp3"),
      ],
    });
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    const chooseSpy = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValueOnce({ narrative: "plan", points: [] });
    await agent.createPodcastPlan();

    chooseSpy.mockResolvedValueOnce({
      speakerId: "s2",
      direction: "keep going",
      coveredPointIds: [],
    });
    await agent.chooseNextSpeaker(script);

    const prompt = (chooseSpy.mock.calls[1][1] as any)[0].content as string;
    expect(prompt).not.toContain("dominated the conversation");
  });
});

describe("DirectorAgent.reviewSpeech", () => {
  function makeReviewSpeech(): Speech {
    const speaker = makeSpeaker("s1");
    return {
      id: "sp1",
      speaker,
      message: "Original message.",
      instructions: "",
      voice: speaker.voice,
      voiceStyle: "neutral",
      timestamp: new Date(),
    };
  }

  it("returns the speech unchanged when the director judges it fine", async () => {
    const script = makeScript();
    const turnReviewer = {
      review: vi.fn().mockResolvedValue({
        accepted: true,
        clear: true,
        engaging: true,
        grounded: true,
        advancesBeat: true,
        addsVariety: true,
      }),
    };
    const agent = new DirectorAgent(
      script,
      { maxTurns: 10, maxDuration: 600 },
      { turnReviewer }
    );

    const speech = makeReviewSpeech();
    const result = await agent.reviewSpeech(speech, "Talk about X");

    expect(result.message).toBe("Original message.");
    expect(result.review?.accepted).toBe(true);
  });

  it("replaces the message with the director's revision when flagged", async () => {
    const script = makeScript();
    const turnReviewer = {
      review: vi
        .fn()
        .mockResolvedValueOnce({
          accepted: false,
          clear: true,
          engaging: true,
          grounded: true,
          advancesBeat: false,
          addsVariety: true,
          revisedMessage: "A tighter, corrected version.",
        })
        .mockResolvedValueOnce({
          accepted: true,
          clear: true,
          engaging: true,
          grounded: true,
          advancesBeat: true,
          addsVariety: true,
          roleConsistent: true,
          knowledgeConsistent: true,
        }),
    };
    const agent = new DirectorAgent(
      script,
      { maxTurns: 10, maxDuration: 600 },
      { turnReviewer }
    );

    const speech = makeReviewSpeech();
    const result = await agent.reviewSpeech(speech, "Talk about X, briefly");

    expect(result.message).toBe("A tighter, corrected version.");
    expect(result).not.toBe(speech);
    expect(turnReviewer.review).toHaveBeenCalledTimes(2);
  });

  it("keeps the original when the proposed revision is visibly truncated", async () => {
    const script = makeScript();
    const turnReviewer = {
      review: vi.fn().mockResolvedValue({
        accepted: false,
        clear: true,
        engaging: true,
        grounded: true,
        advancesBeat: false,
        addsVariety: true,
        revisedMessage: "A sprawling network weaving through the soil,",
      }),
    };
    const agent = new DirectorAgent(
      script,
      { maxTurns: 10, maxDuration: 600 },
      { turnReviewer }
    );

    const speech = makeReviewSpeech();
    const result = await agent.reviewSpeech(speech, "Talk about X");

    expect(result.message).toBe(speech.message);
    expect(turnReviewer.review).toHaveBeenCalledTimes(1);
  });

  it("returns the speech unchanged if the review call fails", async () => {
    const script = makeScript();
    const turnReviewer = {
      review: vi.fn().mockRejectedValue(new Error("model error")),
    };
    const agent = new DirectorAgent(
      script,
      { maxTurns: 10, maxDuration: 600 },
      { turnReviewer }
    );

    const speech = makeReviewSpeech();
    const result = await agent.reviewSpeech(speech, "Talk about X");

    expect(result.message).toBe(speech.message);
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

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A", "Point B", "Point C"],
    });
    await agent.createPodcastPlan();

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
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

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      narrative: "plan",
      points: ["Point A"],
    });
    await agent.createPodcastPlan();

    vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValueOnce({
      speakerId: "s1",
      direction: "keep going",
      coveredPointIds: [],
    });

    const result = await agent.chooseNextSpeaker(script);

    expect(result.requestSummary).toBe(false);
  });
});
