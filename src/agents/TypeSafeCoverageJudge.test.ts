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
import { setJudgmentProvider } from "../services/judgment-runtime";
import { scriptedProvider, unavailableProvider } from "../test-support/judgments";

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

const items = [
  { id: "p1", text: "CO2 scrubber duct-tape hack" },
  { id: "p2", text: "Oxygen tank explosion" },
];

const request = (overrides: Partial<CoverageRequest> = {}): CoverageRequest => ({
  kind: "point",
  items,
  transcript: "HOST: The oxygen tank exploded two days into the flight.",
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
  it("confirms items the provider judges covered", async () => {
    setJudgmentProvider(scriptedProvider((id) => ({ type: "noul", probability: id === "item_1" ? 0.8 : 0.1 })));
    expect(await verifyCoverage(request())).toEqual(["p2"]);
  });

  it("confirms nothing when the provider is unavailable", async () => {
    setJudgmentProvider(unavailableProvider());
    expect(await verifyCoverage(request())).toEqual([]);
  });

  it("does not call the provider for no items", async () => {
    const provider = scriptedProvider(() => ({ type: "noul", probability: 0.9 }));
    setJudgmentProvider(provider);
    expect(await verifyCoverage(request({ items: [] }))).toEqual([]);
    expect(provider.calls).toEqual([]);
  });
});
