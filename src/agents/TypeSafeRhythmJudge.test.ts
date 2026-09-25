import { describe, expect, it, vi } from "vitest";
import { judgeRhythm, judgeRhythmWithTypeSafe } from "./TypeSafeRhythmJudge";
import {
  ConversationRhythmPolicy,
  RECENT_TURNS_ALL_BRIEF_REACTIONS,
  RECENT_TURNS_INFORMATION_HEAVY,
} from "./ConversationRhythmPolicy";
import { IJudgmentProvider } from "../providers/judgment-questions";
import { JudgmentRunner } from "../services/JudgmentRunner";
import { IJudgmentLog, JudgmentRecord } from "../services/JudgmentLog";
import { parseJudgmentModes } from "../services/judgment-modes";
import { Speech } from "../types";
import { SpeakerAgentToolName } from "./speaker-tools";

const said = (name: string, message: string, tool = SpeakerAgentToolName.SPEAK) =>
  ({ speaker: { id: name, name }, message, tool }) as unknown as Speech;

function choosing(option: string) {
  const judge = vi.fn(async () => ({
    status: "ok" as const,
    answers: {
      recent_conversation_rhythm: {
        type: "choice" as const,
        choice: option,
        probabilities: { [option]: 0.9 },
        confidence: 0.8,
      },
    },
  }));
  return { judge } as unknown as IJudgmentProvider & { judge: typeof judge };
}

const speeches = [said("Ada", "Wow."), said("Ben", "No way!")];

describe("judgeRhythmWithTypeSafe", () => {
  it.each([
    ["recent_turns_were_all_brief_reactions", RECENT_TURNS_ALL_BRIEF_REACTIONS],
    ["recent_turns_were_information_heavy", RECENT_TURNS_INFORMATION_HEAVY],
    ["recent_rhythm_is_varied", undefined],
  ])("maps %s to the policy's recommendation", async (option, expected) => {
    const decision = await judgeRhythmWithTypeSafe(
      { recentSpeeches: speeches, current: async () => undefined },
      choosing(option)
    );

    expect(decision).toMatchObject({ status: "ok", value: expected });
  });

  it("judges the words spoken, not the tools used", async () => {
    const provider = choosing("recent_rhythm_is_varied");

    await judgeRhythmWithTypeSafe(
      { recentSpeeches: speeches, current: async () => undefined },
      provider
    );

    expect((provider.judge.mock.calls[0] as unknown[])[0]).toEqual({
      recent_turns: ["Ada: Wow.", "Ben: No way!"],
    });
  });
});

describe("ConversationRhythmPolicy.recommendJudged", () => {
  it("returns nothing for fewer than two turns without asking", async () => {
    expect(await new ConversationRhythmPolicy().recommendJudged([said("Ada", "Hi.")])).toBeUndefined();
  });

  it("off by default: matches recommend()", async () => {
    const policy = new ConversationRhythmPolicy();
    const reactions = [
      said("Ada", "Wow.", SpeakerAgentToolName.INTERJECT),
      said("Ben", "No way!", SpeakerAgentToolName.FILLER_COMMENT),
    ];

    expect(await policy.recommendJudged(reactions)).toEqual(policy.recommend(reactions));
  });
});

describe("judgeRhythm", () => {
  it("shadow: compares recommendations by reason", async () => {
    const records: JudgmentRecord[] = [];
    const log: IJudgmentLog = {
      append: async (r) => void records.push(r),
      readAll: async () => records,
    };
    const runner = new JudgmentRunner(parseJudgmentModes("conversation-rhythm=shadow"), log);

    const result = await judgeRhythm(
      { recentSpeeches: speeches, current: async () => RECENT_TURNS_ALL_BRIEF_REACTIONS },
      { runner, provider: choosing("recent_turns_were_all_brief_reactions") }
    );

    expect(result).toBe(RECENT_TURNS_ALL_BRIEF_REACTIONS);
    expect(records[0]).toMatchObject({ judgment: "conversation-rhythm", agreed: true });
  });
});
