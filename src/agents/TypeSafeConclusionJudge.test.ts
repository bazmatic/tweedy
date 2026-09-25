import { describe, expect, it, vi } from "vitest";
import {
  judgeConversationCompleteWithTypeSafe,
  verifyConversationComplete,
} from "./TypeSafeConclusionJudge";
import { IJudgmentProvider } from "../providers/judgment-questions";
import { JudgmentRunner } from "../services/JudgmentRunner";
import { IJudgmentLog, JudgmentRecord } from "../services/JudgmentLog";
import { parseJudgmentModes } from "../services/judgment-modes";

function fakeProvider(probability: number) {
  const judge = vi.fn(async () => ({
    status: "ok" as const,
    answers: { complete: { type: "noul" as const, probability } },
  }));
  return { judge } as unknown as IJudgmentProvider & { judge: typeof judge };
}

function memoryRunner(modes: string) {
  const records: JudgmentRecord[] = [];
  const log: IJudgmentLog = {
    append: async (r) => void records.push(r),
    readAll: async () => records,
  };
  return { records, runner: new JudgmentRunner(parseJudgmentModes(modes), log) };
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
  it("is off by default and only runs the current check", async () => {
    const { runner, records } = memoryRunner("");
    const provider = fakeProvider(0.9);

    const complete = await verifyConversationComplete(
      { transcript, current: async () => false },
      { runner, provider }
    );

    expect(complete).toBe(false);
    expect(provider.judge).not.toHaveBeenCalled();
    expect(records).toEqual([]);
  });

  it("shadow: acts on the current check and logs agreement with the probability", async () => {
    const { runner, records } = memoryRunner("conversation-complete=shadow");

    const complete = await verifyConversationComplete(
      { transcript, current: async () => false },
      { runner, provider: fakeProvider(0.9) }
    );

    expect(complete).toBe(false);
    expect(records[0]).toMatchObject({
      judgment: "conversation-complete",
      current: false,
      typesafe: true,
      typesafeDetail: { probability: 0.9 },
      agreed: false,
      state: { transcriptTail: transcript },
    });
  });

  it("logs only the tail of a long transcript", async () => {
    const { runner, records } = memoryRunner("*=shadow");
    const long = "x".repeat(2000) + "goodbye";

    await verifyConversationComplete(
      { transcript: long, current: async () => true },
      { runner, provider: fakeProvider(0.9) }
    );

    const logged = (records[0].state as { transcriptTail: string }).transcriptTail;
    expect(logged.length).toBeLessThan(700);
    expect(logged.endsWith("goodbye")).toBe(true);
  });

  it("on: acts on TypeSafe and falls back to the current check when unavailable", async () => {
    const { runner } = memoryRunner("conversation-complete=on");
    const current = vi.fn(async () => false);

    const live = await verifyConversationComplete(
      { transcript, current },
      { runner, provider: fakeProvider(0.9) }
    );
    const fallback = await verifyConversationComplete(
      { transcript, current },
      {
        runner,
        provider: { judge: async () => ({ status: "unavailable", reason: "x" }) },
      }
    );

    expect(live).toBe(true);
    expect(fallback).toBe(false);
    expect(current).toHaveBeenCalledTimes(1);
  });
});
