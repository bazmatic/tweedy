import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EpistemicRole,
  PodcastScript,
  SourceAccess,
  Speaker,
  Speech,
  UncertaintyStyle,
  VocalProviderName,
} from "../types";
import { JudgmentRunner } from "../services/JudgmentRunner";
import { parseJudgmentModes } from "../services/judgment-modes";
import { SpeakerAgent } from "./SpeakerAgent";
import { getToolMaxTokens, SpeakerAgentToolName } from "./speaker-tools";

// Route the speaker's tool pre-choice through "on" mode with a scripted
// TypeSafe provider (other judgments stay off); vi.mock is hoisted.
const { judgeMock } = vi.hoisted(() => ({ judgeMock: vi.fn() }));
vi.mock("../services/judgment-runtime", () => ({
  getJudgmentRunner: () =>
    new JudgmentRunner(parseJudgmentModes("speaker-tool=on"), {
      append: async () => {},
      readAll: async () => [],
    }),
  getJudgmentProvider: () => ({ judge: judgeMock }),
}));

const speaker = (id: string): Speaker => ({
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
  roleProfile: {
    epistemicRole: EpistemicRole.AudienceGuide,
    sourceAccess: SourceAccess.HeardOnly,
    uncertaintyStyle: UncertaintyStyle.ListenerSurrogate,
  },
});

const s1 = speaker("s1");
const s2 = speaker("s2");
const script = (speeches: Speech[]): PodcastScript => ({
  id: "script-1",
  title: "Test Script",
  description: "A test script",
  speakers: [s1, s2],
  speeches,
  materials: [],
  discussionPoints: [],
  createdAt: new Date(),
  updatedAt: new Date(),
});
const earlier: Speech = {
  id: "e1",
  speaker: s2,
  message: "The spare filters were square and the sockets were round.",
  instructions: "",
  voice: s2.voice,
  voiceStyle: s2.voiceStyle,
  timestamp: new Date(),
  tool: SpeakerAgentToolName.SPEAK,
};

function typesafeChooses(option: string) {
  judgeMock.mockImplementation(async (_state, questions) =>
    "kind_of_turn_to_take" in questions
      ? {
          status: "ok",
          answers: {
            kind_of_turn_to_take: {
              type: "choice",
              choice: option,
              probabilities: {},
              confidence: 0.9,
            },
          },
        }
      : { status: "unavailable", reason: "not scripted" }
  );
}

describe("SpeakerAgent with speaker-tool=on", () => {
  beforeEach(() => {
    judgeMock.mockReset();
  });

  it("forces generation to the pre-chosen tool and its token limit", async () => {
    typesafeChooses("land_one_sharp_sentence");
    const agent = new SpeakerAgent(s1);
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.ONE_LINER,
      message: "So it was arts and crafts that saved them.",
      style: "wry",
      stopReason: "tool_use",
    });

    const speech = await agent.speak(script([earlier]), "React to the filter problem.");

    const [, , tools, maxTokens] = call.mock.calls[0] as [unknown, unknown, { name: string }[], number];
    expect(tools.map((tool) => tool.name)).toEqual([SpeakerAgentToolName.ONE_LINER]);
    expect(maxTokens).toBeLessThanOrEqual(getToolMaxTokens(SpeakerAgentToolName.ONE_LINER));
    expect(speech.tool).toBe(SpeakerAgentToolName.ONE_LINER);
  });

  it("offers the full allowed set when TypeSafe is unavailable", async () => {
    judgeMock.mockResolvedValue({ status: "unavailable", reason: "HTTP 529" });
    const agent = new SpeakerAgent(s1);
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "They built an adaptor out of whatever was on board.",
      style: "",
      stopReason: "tool_use",
    });

    await agent.speak(script([earlier]), "Explain the fix.");

    const [, , tools] = call.mock.calls[0] as [unknown, unknown, { name: string }[]];
    expect(tools.length).toBeGreaterThan(1);
  });

  it("forces an interjection to the pre-chosen tool", async () => {
    typesafeChooses("push_back_with_an_objection");
    const agent = new SpeakerAgent(s1);
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.CHALLENGE,
      message: "Hang on, tape holding for four days? I'm not convinced.",
      style: "sceptical",
      stopReason: "tool_use",
    });

    await agent.interject(earlier);

    const [, , tools] = call.mock.calls[0] as [unknown, unknown, { name: string }[]];
    expect(tools.map((tool) => tool.name)).toEqual([SpeakerAgentToolName.CHALLENGE]);
  });
});
