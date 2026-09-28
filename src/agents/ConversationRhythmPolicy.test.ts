import { describe, expect, it } from "vitest";
import {
  ConversationRhythmPolicy,
  RECENT_TURNS_ALL_BRIEF_REACTIONS,
  RECENT_TURNS_INFORMATION_HEAVY,
} from "./ConversationRhythmPolicy";
import { setJudgmentProvider } from "../services/judgment-runtime";
import { scriptedProvider, unavailableProvider } from "../test-support/judgments";
import { Speech } from "../types";

const said = (message: string) => ({ speaker: { id: "a", name: "Ada" }, message }) as unknown as Speech;
const speeches = [said("Wow."), said("No way!")];
const rhythm = (choice: string) =>
  scriptedProvider(() => ({ type: "choice", choice, probabilities: {}, confidence: 0.9 }));

describe("ConversationRhythmPolicy.recommend", () => {
  const policy = new ConversationRhythmPolicy();

  it.each([
    ["recent_turns_were_all_brief_reactions", RECENT_TURNS_ALL_BRIEF_REACTIONS],
    ["recent_turns_were_information_heavy", RECENT_TURNS_INFORMATION_HEAVY],
    ["recent_rhythm_is_varied", undefined],
  ])("maps %s to its recommendation", async (choice, expected) => {
    setJudgmentProvider(rhythm(choice));
    expect(await policy.recommend(speeches)).toBe(expected);
  });

  it("gives no guidance when the provider is unavailable", async () => {
    setJudgmentProvider(unavailableProvider());
    expect(await policy.recommend(speeches)).toBeUndefined();
  });

  it("does not ask with fewer than two turns", async () => {
    const provider = rhythm("recent_rhythm_is_varied");
    setJudgmentProvider(provider);
    expect(await policy.recommend([said("Hi.")])).toBeUndefined();
    expect(provider.calls).toEqual([]);
  });
});
