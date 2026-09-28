import { describe, expect, it, vi } from "vitest";
import { judgeRhythmWithTypeSafe } from "./TypeSafeRhythmJudge";
import {
  RECENT_TURNS_ALL_BRIEF_REACTIONS,
  RECENT_TURNS_INFORMATION_HEAVY,
} from "./ConversationRhythmPolicy";
import { IJudgmentProvider } from "../providers/judgment-questions";
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
      { recentSpeeches: speeches },
      choosing(option)
    );

    expect(decision).toMatchObject({ status: "ok", value: expected });
  });

  it("judges the words spoken, not the tools used", async () => {
    const provider = choosing("recent_rhythm_is_varied");

    await judgeRhythmWithTypeSafe({ recentSpeeches: speeches }, provider);

    expect((provider.judge.mock.calls[0] as unknown[])[0]).toEqual({
      recent_turns: ["Ada: Wow.", "Ben: No way!"],
    });
  });
});
