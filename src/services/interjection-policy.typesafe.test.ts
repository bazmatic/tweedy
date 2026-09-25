import { describe, expect, it, vi } from "vitest";
import { decideInterjection } from "./interjection-policy";
import { IJudgmentProvider } from "../providers/judgment-questions";
import { JudgmentRunner } from "./JudgmentRunner";
import { IJudgmentLog, JudgmentRecord } from "./JudgmentLog";
import { parseJudgmentModes } from "./judgment-modes";
import { SpeakerAgentToolName } from "../agents/speaker-tools";

function naturalness(probability: number) {
  const judge = vi.fn(async () => ({
    status: "ok" as const,
    answers: { cohost_would_jump_in: { type: "noul" as const, probability } },
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

const turn = (message: string, overrides = {}) => ({
  speaker: { name: "Ben" } as any,
  message,
  tool: SpeakerAgentToolName.ONE_LINER,
  ...overrides,
});

describe("decideInterjection", () => {
  it("keeps the structural rules without asking TypeSafe", async () => {
    const { runner } = memoryRunner("interjection=on");
    const provider = naturalness(0);

    expect(await decideInterjection(turn("Something."), 1, 0, { runner, provider })).toBe(false);
    expect(
      await decideInterjection(turn("Cut off mid—", { stopReason: "max_tokens" }), 2, 0.99, {
        runner,
        provider,
      })
    ).toBe(true);
    expect(provider.judge).not.toHaveBeenCalled();
  });

  it("off: uses the length-and-chance rule", async () => {
    const { runner } = memoryRunner("");

    // A one-liner is not a long-form tool, so the rule never interjects.
    expect(
      await decideInterjection(turn("They built it from a flight manual cover!"), 2, 0, {
        runner,
        provider: naturalness(1),
      })
    ).toBe(false);
  });

  it("on: samples the judged probability with the roll", async () => {
    const { runner } = memoryRunner("interjection=on");
    const provider = naturalness(0.7);
    const speech = turn("They built it from a flight manual cover!");

    expect(await decideInterjection(speech, 2, 0.69, { runner, provider })).toBe(true);
    expect(await decideInterjection(speech, 2, 0.71, { runner, provider })).toBe(false);
  });

  it("shadow: acts on the rule and logs the probability and roll", async () => {
    const { runner, records } = memoryRunner("interjection=shadow");

    const decided = await decideInterjection(
      turn("They built it from a flight manual cover!"),
      2,
      0.2,
      { runner, provider: naturalness(0.9) }
    );

    expect(decided).toBe(false);
    expect(records[0]).toMatchObject({
      judgment: "interjection",
      current: false,
      typesafe: true,
      agreed: false,
      typesafeDetail: { probability: 0.9, roll: 0.2 },
    });
  });
});
