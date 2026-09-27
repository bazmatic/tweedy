import { describe, expect, it, vi } from "vitest";
import {
  judgeConversationCompleteWithTypeSafe,
  verifyConversationComplete,
} from "./TypeSafeConclusionJudge";
import { IJudgmentProvider } from "../providers/judgment-questions";
import { setJudgmentProvider } from "../services/judgment-runtime";
import { scriptedProvider, unavailableProvider } from "../test-support/judgments";

function fakeProvider(probability: number) {
  const judge = vi.fn(async () => ({
    status: "ok" as const,
    answers: { complete: { type: "noul" as const, probability } },
  }));
  return { judge } as unknown as IJudgmentProvider & { judge: typeof judge };
}

const transcript = "HOST: That's all for today — thanks for listening, see you next time!";

describe("judgeConversationCompleteWithTypeSafe", () => {
  it("asks one noul over the transcript and applies the threshold", async () => {
    const provider = fakeProvider(0.62);

    const decision = await judgeConversationCompleteWithTypeSafe(
      transcript,
      provider,
      0.5
    );

    expect(decision).toEqual({
      status: "ok",
      value: true,
      detail: { probability: 0.62 },
    });
    const [state, questions] = provider.judge.mock.calls[0] as unknown as [
      unknown,
      Record<string, { type: string; instructions: string }>,
    ];
    expect(state).toEqual({ transcript });
    expect(questions.complete.type).toBe("noul");
    expect(questions.complete.instructions).toContain("natural, satisfying conclusion");
  });

  it("respects a stricter configured threshold", async () => {
    const decision = await judgeConversationCompleteWithTypeSafe(
      transcript,
      fakeProvider(0.62),
      0.8
    );

    expect(decision).toMatchObject({ status: "ok", value: false });
  });

  it("passes through an unavailable result", async () => {
    const provider: IJudgmentProvider = {
      judge: async () => ({ status: "unavailable", reason: "HTTP 529" }),
    };

    expect(
      await judgeConversationCompleteWithTypeSafe(transcript, provider, 0.5)
    ).toEqual({ status: "unavailable", reason: "HTTP 529" });
  });
});

describe("verifyConversationComplete", () => {
  it("is complete when the provider judges a natural conclusion", async () => {
    setJudgmentProvider(scriptedProvider(() => ({ type: "noul", probability: 0.9 })));
    expect(await verifyConversationComplete({ transcript })).toBe(true);
  });

  it("is not complete when the provider is unavailable", async () => {
    setJudgmentProvider(unavailableProvider());
    expect(await verifyConversationComplete({ transcript })).toBe(false);
  });
});
