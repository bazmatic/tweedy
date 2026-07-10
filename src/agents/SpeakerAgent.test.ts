import { describe, expect, it, vi } from "vitest";
import { SpeakerAgent } from "./SpeakerAgent";
import { SpeakerAgentToolName } from "./speaker-tools";
import {
  PodcastScript,
  Speaker,
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

function makeScript(speeches: PodcastScript["speeches"] = []): PodcastScript {
  return {
    id: "script-1",
    title: "Test Script",
    description: "A test script",
    speakers: [makeSpeaker("s1"), makeSpeaker("s2")],
    speeches,
    materials: [],
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
