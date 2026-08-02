import { describe, expect, it, vi } from "vitest";
import { SpeakerAgent } from "./SpeakerAgent";
import { ModelTask } from "../providers/ModelRoutingPolicy";
import { SpeakerAgentToolName } from "./speaker-tools";
import {
  AudienceProfile,
  AudienceValue,
  ConversationalDevice,
  EditorialCardKind,
  EditorialMove,
  EnergyLevel,
  EpistemicRole,
  PodcastScript,
  SourceAccess,
  Speaker,
  SourceType,
  UncertaintyStyle,
  VocalProviderName,
  AiProviderName,
} from "../types";
import { appConfig } from "../utils/config";

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
    roleProfile: isExpert
      ? {
          epistemicRole: EpistemicRole.Expert,
          sourceAccess: SourceAccess.Full,
          uncertaintyStyle: UncertaintyStyle.Precise,
        }
      : {
          epistemicRole: EpistemicRole.AudienceGuide,
          sourceAccess: SourceAccess.HeardOnly,
          uncertaintyStyle: UncertaintyStyle.ListenerSurrogate,
        },
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
    const speech = await agent.speak(script, "talk about x");

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

describe("SpeakerAgent conversation messages", () => {
  it("uses system instructions and role-based transcript messages", async () => {
    const s1 = makeSpeaker("s1");
    const s2 = makeSpeaker("s2");
    const agent = new SpeakerAgent(s1);
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "That is my answer.",
      style: "calm",
      stopReason: "stop",
    });
    const script = makeScript(
      [
        {
          id: "speech-1",
          speaker: s1,
          message: "Here is my opening thought.",
          instructions: "",
          voice: s1.voice,
          voiceStyle: s1.voiceStyle,
          timestamp: new Date(),
          tool: SpeakerAgentToolName.SPEAK,
        },
        {
          id: "speech-2",
          speaker: s2,
          message: "What do you mean by that?",
          instructions: "",
          voice: s2.voice,
          voiceStyle: s2.voiceStyle,
          timestamp: new Date(),
          tool: SpeakerAgentToolName.SHORT_QUESTION,
        },
      ],
      [s1, s2]
    );

    await agent.speak(script, "Answer the question.");

    const messages = call.mock.calls[0][1] as any[];
    expect(messages).toEqual([
      expect.objectContaining({ role: "system" }),
      { role: "assistant", content: "Here is my opening thought." },
      { role: "user", content: "[Speaker s2] What do you mean by that?" },
    ]);
    expect(messages[0].content).not.toContain("Here is my opening thought.");
    expect(messages.at(-1)?.content).toBe(
      "[Speaker s2] What do you mean by that?"
    );
  });

  it("passes an interjection target as a separate spoken message", async () => {
    const s1 = makeSpeaker("s1");
    const s2 = makeSpeaker("s2");
    const agent = new SpeakerAgent(s1);
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.INTERJECT,
      message: "Really?",
      style: "surprised",
      stopReason: "stop",
    });

    await agent.interject({
      id: "speech-1",
      speaker: s2,
      message: "The result doubled overnight.",
      instructions: "",
      voice: s2.voice,
      voiceStyle: s2.voiceStyle,
      timestamp: new Date(),
      tool: SpeakerAgentToolName.SPEAK,
    });

    expect(call.mock.calls[0][1]).toEqual([
      expect.objectContaining({ role: "system" }),
      { role: "user", content: "[Speaker s2] The result doubled overnight." },
    ]);
  });
});

describe("SpeakerAgent output integrity", () => {
  it("falls back instead of persisting an interjection with a leaked model artifact", async () => {
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
      toolName: SpeakerAgentToolName.FILLER_COMMENT,
      message:
        "<___ what's the best way to fill the space here? <tag>thinking</tag></___>\nHm, so maybe there is something intentional here.",
      style: "curious",
      stopReason: "stop",
    });

    const speech = await agent.interject(lastSpeech);

    expect(speech.message).not.toContain("<tag>");
    expect(["Hmm...", "Ah ok.", "Huh.", "Wow.", "Oh..."]).toContain(
      speech.message
    );
  });

  it("retries speak() when the model leaks a non-speech artifact, succeeding on a clean retry", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const call = vi
      .spyOn(agent as any, "callModelWithTools")
      .mockResolvedValueOnce({
        toolName: SpeakerAgentToolName.SPEAK,
        message: "<tag>thinking</tag> here's my real answer",
        style: "curious",
        stopReason: "stop",
      })
      .mockResolvedValueOnce({
        toolName: SpeakerAgentToolName.SPEAK,
        message: "Here's my real answer.",
        style: "curious",
        stopReason: "stop",
      });

    const script = makeScript();
    const speech = await agent.speak(script, "talk about x");

    expect(speech.message).toBe("Here's my real answer.");
    expect(call).toHaveBeenCalledTimes(2);
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

    script.audienceProfile = AudienceProfile.General;
    script.terminologyLedger = {
      explainedTerms: [
        {
          term: "mycelium",
          plainLanguageMeaning: "the underground fungal network",
          explainedBySpeakerId: "s2",
          explainedAtTurn: 1,
        },
      ],
    };

    await agent.speak(script, "Tell the story.", {
      turnBrief: {
        speakerId: "s1",
        goal: "Humanise the subject.",
        move: EditorialMove.TellStory,
        cardIds: ["card-1"],
        audienceValue: AudienceValue.Connection,
        desiredEnergy: EnergyLevel.Warm,
      },
      editorialCards: [
        {
          id: "card-1",
          materialId: "m1",
          kind: EditorialCardKind.Story,
          content: "She kept the rejection letter above her desk.",
          significance: "",
          evidence: [],
          relatedCardIds: [],
          tags: [],
          keyTerms: [],
          storyValue: 5,
        },
      ],
    });

    expect(call.mock.calls[0][0]).toBe(ModelTask.SpeechGeneration);
    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).toContain("Editorial move: tell_story");
    expect(prompt).toContain("Primary audience value: connection");
    expect(prompt).toContain("She kept the rejection letter");
    expect(prompt).toContain("Audience Profile: general");
    expect(prompt).toContain("likely to be unfamiliar");
    expect(prompt).toContain("Previously explained terms: mycelium");
    expect(prompt).toContain("Name what pronouns or shorthand refer to");
  });
});

describe("SpeakerAgent director guidance framing", () => {
  it("frames the Director's guidance as a recommendation subordinate to character and flow", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "Sure.",
      style: "warm",
      stopReason: "stop",
    });
    const script = makeScript();

    await agent.speak(script, "Establish the foundational claim directly.");

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).toContain("Treat it as a recommendation, not a script");
    expect(prompt).toContain(
      "your character's voice and the natural flow of what was just said come first"
    );
    expect(prompt).toContain(
      "still satisfy anything above or below that would otherwise get this turn rejected"
    );
    expect(prompt).toContain(
      "DIRECTOR GUIDANCE: Establish the foundational claim directly."
    );
  });
});

describe("SpeakerAgent central analogy", () => {
  it("injects the central analogy into the speaker prompt", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "Right, so the accounts hold the data.",
      style: "curious",
      stopReason: "stop",
    });
    const script = makeScript();

    await agent.speak(script, "Tell the story.", {
      centralAnalogy: "accounts are USB drives",
    });

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).toContain("accounts are USB drives");
  });

  it("asks for a callback to the analogy on the final turn", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.CLOSING_STATEMENT,
      message: "Thanks for listening.",
      style: "warm",
      stopReason: "stop",
    });
    const script = makeScript();

    await agent.speak(script, "Wrap up.", {
      isFinalTurn: true,
      centralAnalogy: "accounts are USB drives",
    });

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).toContain("call back to the analogy");
  });

  it("directs the closer to answer a co-host's unanswered question before signing off", async () => {
    const s1 = makeSpeaker("s1");
    const s2 = makeSpeaker("s2");
    const agent = new SpeakerAgent(s1);
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.CLOSING_STATEMENT,
      message: "Thanks for listening.",
      style: "warm",
      stopReason: "stop",
    });
    const script = makeScript(
      [
        {
          id: "speech-1",
          speaker: s2,
          message: "What does algorithmic complexity actually mean here?",
          instructions: "",
          voice: s2.voice,
          voiceStyle: s2.voiceStyle,
          timestamp: new Date(),
          tool: SpeakerAgentToolName.NEARLY_OUT_OF_TIME,
        },
      ],
      [s1, s2]
    );

    await agent.speak(script, "Wrap up.", { isFinalTurn: true });

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).toContain("briefly answer the question");
    expect(prompt).toContain("algorithmic complexity");
  });
});

describe("SpeakerAgent trail-off handoffs", () => {
  it("directs completion when the previous speech trails off with an em dash", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "Right, exactly.",
      style: "calm",
      stopReason: "stop",
    });
    const speeches = [
      {
        id: "sp1",
        speaker: makeSpeaker("s2"),
        message: "and that changes everything because—",
        instructions: "",
        voice: makeSpeaker("s2").voice,
        voiceStyle: "neutral",
        timestamp: new Date(),
        tool: SpeakerAgentToolName.SPEAK,
      },
    ];
    const script = makeScript(speeches);

    await agent.speak(script, "talk about x");

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).toMatch(/complete the sentence they started/i);
  });

  it("does not direct completion when the previous speech does not trail off", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "Right, exactly.",
      style: "calm",
      stopReason: "stop",
    });
    const speeches = [
      {
        id: "sp1",
        speaker: makeSpeaker("s2"),
        message: "and that changes everything.",
        instructions: "",
        voice: makeSpeaker("s2").voice,
        voiceStyle: "neutral",
        timestamp: new Date(),
        tool: SpeakerAgentToolName.SPEAK,
      },
    ];
    const script = makeScript(speeches);

    await agent.speak(script, "talk about x");

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).not.toMatch(/complete the sentence they started/i);
  });

  it("does not direct completion when the speaker trailing off is the same speaker", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "Right, exactly.",
      style: "calm",
      stopReason: "stop",
    });
    const speeches = [
      {
        id: "sp1",
        speaker: makeSpeaker("s1"),
        message: "and that changes everything because—",
        instructions: "",
        voice: makeSpeaker("s1").voice,
        voiceStyle: "neutral",
        timestamp: new Date(),
        tool: SpeakerAgentToolName.SPEAK,
      },
    ];
    const script = makeScript(speeches);

    await agent.speak(script, "talk about x");

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).not.toMatch(/complete the sentence they started/i);
  });

  it("instructs bridging from a co-host's substantive setup before new material", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "Right, exactly.",
      style: "calm",
      stopReason: "stop",
    });
    const speeches = [
      {
        id: "sp1",
        speaker: makeSpeaker("s2"),
        message: "So the whole system runs on a feedback loop.",
        instructions: "",
        voice: makeSpeaker("s2").voice,
        voiceStyle: "neutral",
        timestamp: new Date(),
        tool: SpeakerAgentToolName.SPEAK,
      },
    ];
    const script = makeScript(speeches);

    await agent.speak(script, "talk about x");

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).toMatch(/briefly connect to what .* just said/i);
    expect(prompt).toContain("So the whole system runs on a feedback loop.");
  });

  it("does not instruct bridging when the previous speech was only a brief reaction", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "Right, exactly.",
      style: "calm",
      stopReason: "stop",
    });
    const speeches = [
      {
        id: "sp1",
        speaker: makeSpeaker("s2"),
        message: "Wait, really?",
        instructions: "",
        voice: makeSpeaker("s2").voice,
        voiceStyle: "neutral",
        timestamp: new Date(),
        tool: SpeakerAgentToolName.INTERJECT,
      },
    ];
    const script = makeScript(speeches);

    await agent.speak(script, "talk about x");

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).not.toMatch(/briefly connect to what .* just said/i);
  });

  it("does not instruct bridging on the final (closing) turn", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.CLOSING_STATEMENT,
      message: "Thanks for listening, see you next time!",
      style: "warm",
      stopReason: "stop",
    });
    const speeches = [
      {
        id: "sp1",
        speaker: makeSpeaker("s2"),
        message: "So the whole system runs on a feedback loop.",
        instructions: "",
        voice: makeSpeaker("s2").voice,
        voiceStyle: "neutral",
        timestamp: new Date(),
        tool: SpeakerAgentToolName.SPEAK,
      },
    ];
    const script = makeScript(speeches);

    await agent.speak(script, "wrap up", { isFinalTurn: true });

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).not.toMatch(/briefly connect to what .* just said/i);
  });

  it("instructs a trail-off delivery when the device is trail_off", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "and that changes everything because—",
      style: "calm",
      stopReason: "stop",
    });
    const script = makeScript();

    await agent.speak(script, "Tell the story.", {
      turnBrief: {
        speakerId: "s1",
        goal: "Build anticipation.",
        move: EditorialMove.TellStory,
        cardIds: [],
        audienceValue: AudienceValue.Momentum,
        desiredEnergy: EnergyLevel.Warm,
        device: ConversationalDevice.TrailOff,
      },
    });

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).toMatch(/end .*mid-clause.*em dash/i);
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

    expect(spy.mock.calls[0][0]).toBe(ModelTask.Interjection);
    const offeredTools = spy.mock.calls[0][2] as { name: string }[];
    expect(offeredTools.map((tool) => tool.name)).toEqual([
      SpeakerAgentToolName.INTERJECT,
      SpeakerAgentToolName.FILLER_COMMENT,
      SpeakerAgentToolName.CHALLENGE,
      SpeakerAgentToolName.PARAPHRASE,
      SpeakerAgentToolName.AGREE,
    ]);
  });

  it("keeps expert interjections grounded in the expert stance", async () => {
    const lastSpeaker = makeSpeaker("s2");
    const lastSpeech = {
      id: "sp1",
      speaker: lastSpeaker,
      message: "Fungi produce electrical spikes.",
      instructions: "",
      voice: lastSpeaker.voice,
      voiceStyle: "neutral",
      timestamp: new Date(),
      tool: SpeakerAgentToolName.SPEAK,
    };
    const agent = new SpeakerAgent(makeSpeaker("expert", true));
    const spy = vi
      .spyOn(agent as any, "callModelWithTools")
      .mockResolvedValue({
        toolName: SpeakerAgentToolName.FILLER_COMMENT,
        message: "Exactly.",
        style: "assured",
        stopReason: "stop",
      });

    await agent.interject(lastSpeech);

    const prompt = (spy.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).toContain("Epistemic Role: expert");
    expect(prompt).toContain("Do not perform surprise or confusion");
  });
});

describe("SpeakerAgent retry feedback", () => {
  it("renders retry feedback in its own labeled section without duplicating it elsewhere", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "A calmer version of the same point.",
      style: "calm",
      stopReason: "stop",
    });
    const script = makeScript();

    await agent.speak(script, "Tell the story.", {
      retryFeedback:
        'Your previous attempt at this turn was rejected: Too abrupt. What you said: "That\'s it, we\'re done." Revise to fix that specific problem while keeping the same goal — don\'t just reword it.',
    });

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    const occurrences = prompt.split("Your previous attempt at this turn was rejected").length - 1;
    expect(occurrences).toBe(1);
    expect(prompt).toContain("Revision note:");
    expect(prompt).toContain('That\'s it, we\'re done.');
  });

  it("omits the retry feedback section entirely when absent", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "hello there",
      style: "calm",
      stopReason: "stop",
    });
    const script = makeScript();

    await agent.speak(script, "talk about x");

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).not.toContain("Revision note:");
  });
});

describe("SpeakerAgent rules section grouping", () => {
  it("groups accessibility, length, style, and formatting rules under distinct headers", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "hello there",
      style: "calm",
      stopReason: "stop",
    });
    const script = makeScript();

    await agent.speak(script, "talk about x");

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    const accessibilityIndex = prompt.indexOf("## Audience & Accessibility");
    const lengthIndex = prompt.indexOf("## Length & Delivery");
    const styleIndex = prompt.indexOf("## Conversational Style");
    const formattingIndex = prompt.indexOf("## Formatting");

    expect(accessibilityIndex).toBeGreaterThan(-1);
    expect(lengthIndex).toBeGreaterThan(accessibilityIndex);
    expect(styleIndex).toBeGreaterThan(lengthIndex);
    expect(formattingIndex).toBeGreaterThan(styleIndex);
    expect(prompt.slice(formattingIndex)).toContain(
      "never use markdown emphasis"
    );
    expect(prompt.slice(styleIndex, formattingIndex)).toContain(
      "using Australian/British spelling"
    );
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
    await agent.speak(script1, "talk about x");

    const offeredTools = spy.mock.calls[0][2] as { name: string }[];
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
    await agent.speak(scriptMulti, "talk about x");

    const offeredTools = spy.mock.calls[0][2] as { name: string }[];
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
    await agent.speak(scriptMulti, "talk about x");

    const offeredTools = spy.mock.calls[0][2] as { name: string }[];
    const toolNames = offeredTools.map((tool) => tool.name);
    expect(new Set(toolNames)).toEqual(
      new Set([
        SpeakerAgentToolName.SPEAK,
        SpeakerAgentToolName.INTERJECT,
        SpeakerAgentToolName.FILLER_COMMENT,
        SpeakerAgentToolName.SHORT_QUESTION,
        SpeakerAgentToolName.ONE_LINER,
        SpeakerAgentToolName.CHALLENGE,
        SpeakerAgentToolName.PARAPHRASE,
        SpeakerAgentToolName.AGREE,
      ])
    );
    expect(toolNames.length).toBe(8);
  });

  it("tells a solo audience guide they may ask, react, challenge, reframe or illustrate", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1", false));
    const spy = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "hello there",
      style: "calm",
      stopReason: "stop",
    });

    const script1 = makeScript([], [makeSpeaker("s1")]);
    await agent.speak(script1, "talk about x");

    const prompt = (spy.mock.calls[0] as any)[1][0].content as string;
    expect(prompt).toContain(
      "you may ask, react, challenge, reframe, illustrate or tell a prepared story"
    );
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
    await agent.speak(script2, "talk about x");

    const prompt = (spy.mock.calls[0] as any)[1][0].content as string;
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
    await agent.speak(script2b, "talk about x");

    const prompt = (spy.mock.calls[0] as any)[1][0].content as string;
    expect(prompt).toContain("ask, react, challenge, reframe, illustrate");
    expect(prompt).toContain("never introduce unsupported facts");
  });
});

describe("SpeakerAgent requestSummary", () => {
  it("offers the SUMMARIZE tool alongside the normal toolset and raises the token budget when requestSummary is true", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const spy = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SUMMARIZE,
      message: "quick recap of a, b, and c",
      style: "brisk",
      stopReason: "stop",
    });

    const script3 = makeScript();
    await agent.speak(script3, "catch up on remaining points", {
      requestSummary: true,
    });

    const offeredTools = spy.mock.calls[0][2] as { name: string }[];
    const offeredNames = offeredTools.map((tool) => tool.name);
    expect(offeredNames).toContain(SpeakerAgentToolName.SUMMARIZE);
    expect(offeredNames).toContain(SpeakerAgentToolName.SPEAK);
    expect(spy.mock.calls[0][3]).toBeGreaterThanOrEqual(400);
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
    await agent.speak(script4, "wrap up", {
      timeStatus: "almost out of time",
      forceNearlyOutOfTime: true,
      requestSummary: true,
    });

    const offeredTools = spy.mock.calls[0][2] as { name: string }[];
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
    await agent.speak(script5, "talk about bioluminescence");

    expect(searchRelevantContent).toHaveBeenCalledWith(
      "talk about bioluminescence",
      3
    );
    const prompt = (spy.mock.calls[0] as any)[1][0].content as string;
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

    const prompt = (spy.mock.calls[0] as any)[1][0].content as string;
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

    const prompt = (spy.mock.calls[0] as any)[1][0].content as string;
    expect(prompt).toContain("Fallback Material: Naive content.");
  });
});

describe("SpeakerAgent provider override", () => {
  it("passes an explicit provider through to BaseAgent", () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"), undefined, {
      provider: AiProviderName.OpenAI,
    });
    expect((agent as any).provider).toBe(AiProviderName.OpenAI);
  });

  it("falls back to BaseAgent's default provider when none is given", () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    expect((agent as any).provider).toBe(appConfig.defaultAiProvider);
  });
});
