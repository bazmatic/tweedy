import { describe, expect, it, vi } from "vitest";
import {
  judgeCoverageWithTypeSafe,
  verifyCoverage,
  CoverageRequest,
} from "./TypeSafeCoverageJudge";
import {
  IJudgmentProvider,
  JudgmentQuestions,
  JudgmentResult,
} from "../providers/judgment-questions";
import { JudgmentRunner } from "../services/JudgmentRunner";
import { IJudgmentLog, JudgmentRecord } from "../services/JudgmentLog";
import { parseJudgmentModes } from "../services/judgment-modes";

function fakeProvider(probabilities: number[]) {
  const judge = vi.fn(
    async (_state: unknown, questions: JudgmentQuestions) =>
      ({
        status: "ok",
        answers: Object.fromEntries(
          Object.keys(questions).map((id, i) => [
            id,
            { type: "noul", probability: probabilities[i] },
          ])
        ),
      }) as unknown as JudgmentResult<JudgmentQuestions>
  );
  return { judge } as IJudgmentProvider & { judge: typeof judge };
}

function memoryRunner(modes: string) {
  const records: JudgmentRecord[] = [];
  const log: IJudgmentLog = {
    append: async (r) => void records.push(r),
    readAll: async () => records,
  };
  return { records, runner: new JudgmentRunner(parseJudgmentModes(modes), log) };
}

const items = [
  { id: "p1", text: "CO2 scrubber duct-tape hack" },
  { id: "p2", text: "Oxygen tank explosion" },
];

const request = (overrides: Partial<CoverageRequest> = {}): CoverageRequest => ({
  kind: "point",
  items,
  transcript: "HOST: The oxygen tank exploded two days into the flight.",
  current: async () => ["p1", "p2"],
  ...overrides,
});

describe("judgeCoverageWithTypeSafe", () => {
  it("asks one noul per item and confirms those at or above the threshold", async () => {
    const provider = fakeProvider([0.2, 0.5]);

    const decision = await judgeCoverageWithTypeSafe(request(), provider, 0.5);

    expect(decision).toEqual({
      status: "ok",
      value: ["p2"],
      detail: { probabilities: { p1: 0.2, p2: 0.5 } },
    });
    const [state, questions] = provider.judge.mock.calls[0];
    expect(state).toEqual({
      transcript: "HOST: The oxygen tank exploded two days into the flight.",
    });
    expect(Object.values(questions)).toHaveLength(2);
    expect(questions.item_0).toMatchObject({ type: "noul" });
    expect(questions.item_0.instructions).toContain("CO2 scrubber duct-tape hack");
    expect(questions.item_0.instructions).toContain("topically-adjacent");
  });

  it("uses kind-specific rubrics and passes the candidate turn as state", async () => {
    const provider = fakeProvider([0.9]);

    await judgeCoverageWithTypeSafe(
      request({
        kind: "discourse",
        items: [items[0]],
        candidateTurn: "GUEST: They taped a square filter into a round socket.",
      }),
      provider,
      0.5
    );

    const [state, questions] = provider.judge.mock.calls[0];
    expect(state).toMatchObject({
      candidate_turn: "GUEST: They taped a square filter into a round socket.",
    });
    expect(questions.item_0.instructions).toContain("causal or explanatory meaning");
  });

  it("does not call the provider when there are no items", async () => {
    const provider = fakeProvider([]);

    const decision = await judgeCoverageWithTypeSafe(
      request({ items: [] }),
      provider,
      0.5
    );

    expect(decision).toEqual({ status: "ok", value: [] });
    expect(provider.judge).not.toHaveBeenCalled();
  });

  it("passes through an unavailable result", async () => {
    const provider: IJudgmentProvider = {
      judge: async () => ({ status: "unavailable", reason: "HTTP 529" }),
    };

    const decision = await judgeCoverageWithTypeSafe(request(), provider, 0.5);

    expect(decision).toEqual({ status: "unavailable", reason: "HTTP 529" });
  });
});

describe("verifyCoverage", () => {
  it("is off by default and only runs the current verifier", async () => {
    const { runner, records } = memoryRunner("");
    const provider = fakeProvider([0.9, 0.9]);

    const confirmed = await verifyCoverage(request(), { runner, provider });

    expect(confirmed).toEqual(["p1", "p2"]);
    expect(provider.judge).not.toHaveBeenCalled();
    expect(records).toEqual([]);
  });

  it("shadow: acts on the current verifier and logs the TypeSafe verdict per kind", async () => {
    const { runner, records } = memoryRunner("coverage=shadow");
    const provider = fakeProvider([0.1, 0.8]);

    const confirmed = await verifyCoverage(request(), { runner, provider });

    expect(confirmed).toEqual(["p1", "p2"]);
    expect(records[0]).toMatchObject({
      judgment: "coverage.point",
      current: ["p1", "p2"],
      typesafe: ["p2"],
      typesafeDetail: { probabilities: { p1: 0.1, p2: 0.8 } },
      agreed: false,
      state: { items },
    });
  });

  it("treats the same ids in a different order as agreement", async () => {
    const { runner, records } = memoryRunner("coverage.point=shadow");

    await verifyCoverage(
      request({ current: async () => ["p2", "p1"] }),
      { runner, provider: fakeProvider([0.9, 0.9]) }
    );

    expect(records[0].agreed).toBe(true);
  });

  it("on: acts on TypeSafe and falls back to the current verifier when unavailable", async () => {
    const { runner } = memoryRunner("coverage=on");
    const current = vi.fn(async () => ["p1"]);

    const live = await verifyCoverage(request({ current }), {
      runner,
      provider: fakeProvider([0.1, 0.9]),
    });
    const fallback = await verifyCoverage(request({ current }), {
      runner,
      provider: { judge: async () => ({ status: "unavailable", reason: "x" }) },
    });

    expect(live).toEqual(["p2"]);
    expect(fallback).toEqual(["p1"]);
    expect(current).toHaveBeenCalledTimes(1);
  });

  it("propagates current-verifier errors so the caller's fallback still applies", async () => {
    const { runner } = memoryRunner("coverage=shadow");

    await expect(
      verifyCoverage(
        request({
          current: async () => {
            throw new Error("model failed");
          },
        }),
        { runner, provider: fakeProvider([0.9, 0.9]) }
      )
    ).rejects.toThrow("model failed");
  });
});
