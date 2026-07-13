import { describe, expect, it, vi } from "vitest";
import { SpeakerAgent } from "./SpeakerAgent";
import { SpeakerAgentToolName } from "./speaker-tools";
import {
  AudienceValue,
  EditorialCardKind,
  EditorialMove,
  EnergyLevel,
  PodcastScript,
  Speaker,
  SourceType,
  VocalProviderName,
} from "../types";

function makeSpeaker(id: string, isExpert = false): Speaker {
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
    isExpert,
  };
}

function makeScript(
  speeches: PodcastScript["speeches"] = [],
  speakers: PodcastScript["speakers"] = [makeSpeaker("s1"), makeSpeaker("s2")]
): PodcastScript {
  return {
    id: "script-1",
    title: "Test Script",
    description: "A test script",
    speakers,
    speeches,
    materials: [],
    discussionPoints: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("SpeakerAgent stopReason threading", () => {
  it("carries stopReason from callModelWithTools onto the Speech returned by speak()", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "hello there",
      style: "calm",
      stopReason: "max_tokens",
    });

    const script = makeScript();
    const speech = await agent.speak(
      script.speeches,
      script.speakers,
      script.materials,
      script.title,
      script.description,
      "talk about x"
    );

    expect(speech.stopReason).toBe("max_tokens");
  });

  it("carries stopReason onto the Speech returned by interject()", async () => {
    const lastSpeech = {
      id: "sp1",
      speaker: makeSpeaker("s2"),
      message: "and then...",
      instructions: "",
      voice: makeSpeaker("s2").voice,
      voiceStyle: "neutral",
      timestamp: new Date(),
      tool: SpeakerAgentToolName.SPEAK,
    };
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.INTERJECT,
      message: "wow",
      style: "surprised",
      stopReason: "stop",
    });

    const speech = await agent.interject(lastSpeech);

    expect(speech.stopReason).toBe("stop");
  });
});

describe("SpeakerAgent editorial context", () => {
  it("receives the turn's audience value, editorial move and selected cards", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1", true));
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "That letter makes the success feel much less inevitable.",
      style: "warm",
      stopReason: "stop",
    });
    const script = makeScript();

    await agent.speak(
      script.speeches,
      script.speakers,
      script.materials,
      script.title,
      script.description,
      "Tell the story.",
      "",
      false,
      false,
      false,
      {
        speakerId: "s1",
        goal: "Humanise the subject.",
        move: EditorialMove.TellStory,
        cardIds: ["card-1"],
        audienceValue: AudienceValue.Connection,
        desiredEnergy: EnergyLevel.Warm,
      },
      [
        {
          id: "card-1",
          materialId: "m1",
          kind: EditorialCardKind.Story,
          content: "She kept the rejection letter above her desk.",
          evidence: [],
          relatedCardIds: [],
          tags: [],
        },
      ]
    );

    const prompt = (call.mock.calls[0][0] as any)[0].content as string;
    expect(prompt).toContain("Editorial move: tell_story");
    expect(prompt).toContain("Primary audience value: connection");
    expect(prompt).toContain("She kept the rejection letter");
  });
});

describe("SpeakerAgent.interject tool set", () => {
  it("offers CHALLENGE alongside INTERJECT and FILLER_COMMENT", async () => {
    const lastSpeech = {
      id: "sp1",
      speaker: makeSpeaker("s2"),
      message: "and then...",
      instructions: "",
      voice: makeSpeaker("s2").voice,
      voiceStyle: "neutral",
      timestamp: new Date(),
      tool: SpeakerAgentToolName.SPEAK,
    };
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const spy = vi
      .spyOn(agent as any, "callModelWithTools")
      .mockResolvedValue({
        toolName: SpeakerAgentToolName.CHALLENGE,
        message: "wait, is that actually true?",
        style: "skeptical",
        stopReason: "stop",
      });

    await agent.interject(lastSpeech);

    const offeredTools = spy.mock.calls[0][1] as { name: string }[];
    expect(offeredTools.map((tool) => tool.name)).toEqual([
      SpeakerAgentToolName.INTERJECT,
      SpeakerAgentToolName.FILLER_COMMENT,
      SpeakerAgentToolName.CHALLENGE,
    ]);
  });
});

describe("SpeakerAgent.speak tool set for solo episodes", () => {
  it("only offers SPEAK, QUOTE, and ONE_LINER when there is a single speaker", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const spy = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "hello there",
      style: "calm",
      stopReason: "stop",
    });

    const script1 = makeScript([], [makeSpeaker("s1")]);
    await agent.speak(
      script1.speeches,
      script1.speakers,
      script1.materials,
      script1.title,
      script1.description,
      "talk about x"
    );

    const offeredTools = spy.mock.calls[0][1] as { name: string }[];
    expect(offeredTools.map((tool) => tool.name)).toEqual([
      SpeakerAgentToolName.SPEAK,
      SpeakerAgentToolName.ONE_LINER,
      SpeakerAgentToolName.QUOTE,
    ]);
  });

  it("offers the full tool set when there are multiple speakers and the speaker is an expert", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1", true));
    const spy = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "hello there",
      style: "calm",
      stopReason: "stop",
    });

    const scriptMulti = makeScript();
    await agent.speak(
      scriptMulti.speeches,
      scriptMulti.speakers,
      scriptMulti.materials,
      scriptMulti.title,
      scriptMulti.description,
      "talk about x"
    );

    const offeredTools = spy.mock.calls[0][1] as { name: string }[];
    expect(offeredTools.length).toBeGreaterThan(3);
    expect(offeredTools.map((tool) => tool.name)).toContain(
      SpeakerAgentToolName.SPEAK
    );
  });

  it("lets audience guides reframe or tell prepared stories as well as react", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1", false));
    const spy = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.INTERJECT,
      message: "wow",
      style: "surprised",
      stopReason: "stop",
    });

    const scriptMulti = makeScript();
    await agent.speak(
      scriptMulti.speeches,
      scriptMulti.speakers,
      scriptMulti.materials,
      scriptMulti.title,
      scriptMulti.description,
      "talk about x"
    );

    const offeredTools = spy.mock.calls[0][1] as { name: string }[];
    const toolNames = offeredTools.map((tool) => tool.name);
    expect(new Set(toolNames)).toEqual(
      new Set([
        SpeakerAgentToolName.SPEAK,
        SpeakerAgentToolName.INTERJECT,
        SpeakerAgentToolName.FILLER_COMMENT,
        SpeakerAgentToolName.SHORT_QUESTION,
        SpeakerAgentToolName.ONE_LINER,
        SpeakerAgentToolName.CHALLENGE,
      ])
    );
    expect(toolNames.length).toBe(6);
  });

  it("tells a solo audience guide to make the material accessible", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1", false));
    const spy = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "hello there",
      style: "calm",
      stopReason: "stop",
    });

    const script1 = makeScript([], [makeSpeaker("s1")]);
    await agent.speak(
      script1.speeches,
      script1.speakers,
      script1.materials,
      script1.title,
      script1.description,
      "talk about x"
    );

    const prompt = (spy.mock.calls[0] as any)[0][0].content as string;
    expect(prompt).toContain("make the material accessible and engaging");
    expect(prompt).toContain("without claiming unsupported expertise");
  });
});

describe("SpeakerAgent expertise nudge", () => {
  it("tells experts to answer confidently without feigning ignorance", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1", true));
    const spy = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "hello there",
      style: "calm",
      stopReason: "stop",
    });

    const script2 = makeScript();
    await agent.speak(
      script2.speeches,
      script2.speakers,
      script2.materials,
      script2.title,
      script2.description,
      "talk about x"
    );

    const prompt = (spy.mock.calls[0] as any)[0][0].content as string;
    expect(prompt).toContain("answer from the material with appropriate confidence");
    expect(prompt).toContain("Do not feign ignorance");
  });

  it("lets audience guides contribute without introducing unsupported facts", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1", false));
    const spy = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "hello there",
      style: "calm",
      stopReason: "stop",
    });

    const script2b = makeScript();
    await agent.speak(
      script2b.speeches,
      script2b.speakers,
      script2b.materials,
      script2b.title,
      script2b.description,
      "talk about x"
    );

    const prompt = (spy.mock.calls[0] as any)[0][0].content as string;
    expect(prompt).toContain("ask, react, challenge, reframe, illustrate");
    expect(prompt).toContain("never introduce unsupported facts");
  });
});

describe("SpeakerAgent requestSummary", () => {
  it("forces the SUMMARIZE tool and raises the token budget when requestSummary is true", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const spy = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SUMMARIZE,
      message: "quick recap of a, b, and c",
      style: "brisk",
      stopReason: "stop",
    });

    const script3 = makeScript();
    await agent.speak(
      script3.speeches,
      script3.speakers,
      script3.materials,
      script3.title,
      script3.description,
      "catch up on remaining points",
      "",
      false,
      true
    );

    const offeredTools = spy.mock.calls[0][1] as { name: string }[];
    expect(offeredTools.map((tool) => tool.name)).toEqual([
      SpeakerAgentToolName.SUMMARIZE,
    ]);
    expect(spy.mock.calls[0][2]).toBe(120);
  });

  it("still forces NEARLY_OUT_OF_TIME over SUMMARIZE when both flags are true", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const spy = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.NEARLY_OUT_OF_TIME,
      message: "we're almost out of time",
      style: "urgent",
      stopReason: "stop",
    });

    const script4 = makeScript();
    await agent.speak(
      script4.speeches,
      script4.speakers,
      script4.materials,
      script4.title,
      script4.description,
      "wrap up",
      "almost out of time",
      true,
      true
    );

    const offeredTools = spy.mock.calls[0][1] as { name: string }[];
    expect(offeredTools.map((tool) => tool.name)).toEqual([
      SpeakerAgentToolName.NEARLY_OUT_OF_TIME,
    ]);
  });
});

describe("SpeakerAgent expert material lookup via RAGService", () => {
  it("uses RAGService.searchRelevantContent keyed on direction when ragService is provided", async () => {
    const searchRelevantContent = vi.fn().mockResolvedValue([
      {
        id: "d1",
        content: "Deep sea creatures glow.",
        metadata: { title: "Bioluminescence" },
      },
    ]);
    const ragService = { searchRelevantContent } as unknown as import("../rag").RAGService;
    const agent = new SpeakerAgent(makeSpeaker("s1", true), ragService);
    const spy = vi
      .spyOn(agent as any, "callModelWithTools")
      .mockResolvedValue({
        toolName: SpeakerAgentToolName.SPEAK,
        message: "hello there",
        style: "calm",
        stopReason: "stop",
      });

    const script5 = makeScript();
    await agent.speak(
      script5.speeches,
      script5.speakers,
      script5.materials,
      script5.title,
      script5.description,
      "talk about bioluminescence"
    );

    expect(searchRelevantContent).toHaveBeenCalledWith(
      "talk about bioluminescence",
      3
    );
    const prompt = (spy.mock.calls[0] as any)[0][0].content as string;
    expect(prompt).toContain("Bioluminescence: Deep sea creatures glow.");
  });

  it("falls back to script.materials when ragService is not provided", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1", true));
    const spy = vi
      .spyOn(agent as any, "callModelWithTools")
      .mockResolvedValue({
        toolName: SpeakerAgentToolName.SPEAK,
        message: "hello there",
        style: "calm",
        stopReason: "stop",
      });

    const script = makeScript();
    script.materials = [
      {
        id: "m1",
        title: "Fallback Material",
        content: "Naive content.",
        source: "test",
        sourceType: SourceType.Manual,
        metadata: {},
        createdAt: new Date(),
      },
    ];

    await agent.speak(
      script.speeches,
      script.speakers,
      script.materials,
      script.title,
      script.description,
      "talk about x"
    );

    const prompt = (spy.mock.calls[0] as any)[0][0].content as string;
    expect(prompt).toContain("Fallback Material: Naive content.");
  });

  it("falls back to script.materials when RAGService search throws", async () => {
    const searchRelevantContent = vi
      .fn()
      .mockRejectedValue(new Error("vector store unavailable"));
    const ragService = { searchRelevantContent } as unknown as import("../rag").RAGService;
    const agent = new SpeakerAgent(makeSpeaker("s1", true), ragService);
    const spy = vi
      .spyOn(agent as any, "callModelWithTools")
      .mockResolvedValue({
        toolName: SpeakerAgentToolName.SPEAK,
        message: "hello there",
        style: "calm",
        stopReason: "stop",
      });

    const script = makeScript();
    script.materials = [
      {
        id: "m1",
        title: "Fallback Material",
        content: "Naive content.",
        source: "test",
        sourceType: SourceType.Manual,
        metadata: {},
        createdAt: new Date(),
      },
    ];

    await agent.speak(
      script.speeches,
      script.speakers,
      script.materials,
      script.title,
      script.description,
      "talk about x"
    );

    const prompt = (spy.mock.calls[0] as any)[0][0].content as string;
    expect(prompt).toContain("Fallback Material: Naive content.");
  });
});
