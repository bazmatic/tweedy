import { describe, expect, it, vi } from "vitest";
import { SpeakerAgent } from "./SpeakerAgent";
import { SpeakerAgentToolName } from "./speaker-tools";
import {
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

    const speech = await agent.speak(makeScript(), "talk about x");

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

    const speech = await agent.interject(makeScript([lastSpeech]));

    expect(speech.stopReason).toBe("stop");
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

    await agent.interject(makeScript([lastSpeech]));

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

    await agent.speak(makeScript([], [makeSpeaker("s1")]), "talk about x");

    const offeredTools = spy.mock.calls[0][1] as { name: string }[];
    expect(offeredTools.map((tool) => tool.name)).toEqual([
      SpeakerAgentToolName.SPEAK,
      SpeakerAgentToolName.ONE_LINER,
      SpeakerAgentToolName.QUOTE,
    ]);
  });

  it("offers the full tool set when there are multiple speakers", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const spy = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "hello there",
      style: "calm",
      stopReason: "stop",
    });

    await agent.speak(makeScript(), "talk about x");

    const offeredTools = spy.mock.calls[0][1] as { name: string }[];
    expect(offeredTools.length).toBeGreaterThan(3);
  });

  it("nudges non-experts toward only ONE_LINER as the short tool when solo", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1", false));
    const spy = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "hello there",
      style: "calm",
      stopReason: "stop",
    });

    await agent.speak(makeScript([], [makeSpeaker("s1")]), "talk about x");

    const prompt = (spy.mock.calls[0] as any)[0][0].content as string;
    expect(prompt).toContain(`favor short tools (${SpeakerAgentToolName.ONE_LINER})`);
    expect(prompt).not.toContain(SpeakerAgentToolName.FILLER_COMMENT);
  });
});

describe("SpeakerAgent expertise nudge", () => {
  it("tells experts to favor the speak tool", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1", true));
    const spy = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "hello there",
      style: "calm",
      stopReason: "stop",
    });

    await agent.speak(makeScript(), "talk about x");

    const prompt = (spy.mock.calls[0] as any)[0][0].content as string;
    expect(prompt).toContain("favor the speak tool");
  });

  it("tells non-experts to favor short tools and use speak rarely", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1", false));
    const spy = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "hello there",
      style: "calm",
      stopReason: "stop",
    });

    await agent.speak(makeScript(), "talk about x");

    const prompt = (spy.mock.calls[0] as any)[0][0].content as string;
    expect(prompt).toContain("favor short tools");
    expect(prompt).toContain("reserve speak for the occasional genuine point");
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

    await agent.speak(
      makeScript(),
      "catch up on remaining points",
      "",
      false,
      true
    );

    const offeredTools = spy.mock.calls[0][1] as { name: string }[];
    expect(offeredTools.map((tool) => tool.name)).toEqual([
      SpeakerAgentToolName.SUMMARIZE,
    ]);
    expect(spy.mock.calls[0][2]).toBe(180);
  });

  it("still forces NEARLY_OUT_OF_TIME over SUMMARIZE when both flags are true", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const spy = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.NEARLY_OUT_OF_TIME,
      message: "we're almost out of time",
      style: "urgent",
      stopReason: "stop",
    });

    await agent.speak(makeScript(), "wrap up", "almost out of time", true, true);

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

    await agent.speak(makeScript(), "talk about bioluminescence");

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

    await agent.speak(script, "talk about x");

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

    await agent.speak(script, "talk about x");

    const prompt = (spy.mock.calls[0] as any)[0][0].content as string;
    expect(prompt).toContain("Fallback Material: Naive content.");
  });
});
