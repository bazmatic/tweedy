import { describe, expect, it, vi } from "vitest";
import {
  ClaimGateRequest,
  gateClaims,
  gateClaimsWithTypeSafe,
} from "./TypeSafeClaimGateJudge";
import { IJudgmentProvider, JudgmentQuestions } from "../providers/judgment-questions";
import { JudgmentRunner } from "../services/JudgmentRunner";
import { IJudgmentLog, JudgmentRecord } from "../services/JudgmentLog";
import { parseJudgmentModes } from "../services/judgment-modes";

/** Answers each named question with its probability, and everything else 0.05. */
function answering(probabilities: Record<string, number>) {
  const judge = vi.fn(async (_state: unknown, questions: JudgmentQuestions) => ({
    status: "ok" as const,
    answers: Object.fromEntries(
      Object.keys(questions).map((id) => [
        id,
        { type: "noul", probability: probabilities[id] ?? 0.05 },
      ])
    ),
  }));
  return { judge } as unknown as IJudgmentProvider & { judge: typeof judge };
}

const request = (overrides: Partial<ClaimGateRequest> = {}): ClaimGateRequest => ({
  candidateTurn: "Dr. Kranz said CO2 hit 3.5 percent before the adaptor went in.",
  saidSoFar: ["Ada: The oxygen tank exploded two days out."],
  blockedClaims: [{ id: "payoff", text: "The adaptor brought CO2 levels back down." }],
  contributionTargets: [{ id: "mechanism", text: "Square filters were taped into round sockets." }],
  current: async () => ({ accepted: true }),
  ...overrides,
});

describe("gateClaimsWithTypeSafe", () => {
  it("asks descriptively named yes/no questions over the whole turn", async () => {
    const provider = answering({});

    await gateClaimsWithTypeSafe(request(), provider, 0.5);

    const [state, questions] = provider.judge.mock.calls[0];
    expect(state).toEqual({
      said_so_far: ["Ada: The oxygen tank exploded two days out."],
      candidate_turn: "Dr. Kranz said CO2 hit 3.5 percent before the adaptor went in.",
    });
    expect(Object.keys(questions).sort()).toEqual([
      "establishes_planned_claim_mechanism",
      "repeats_what_listeners_already_heard",
      "states_claim_before_prerequisites_payoff",
    ]);
  });

  it("accepts a new, in-order turn", async () => {
    expect(await gateClaimsWithTypeSafe(request(), answering({}), 0.5)).toMatchObject({
      status: "ok",
      value: { accepted: true },
    });
  });

  it("rejects a claim stated before its prerequisites, first", async () => {
    const decision = await gateClaimsWithTypeSafe(
      request(),
      answering({
        states_claim_before_prerequisites_payoff: 0.9,
        establishes_planned_claim_mechanism: 0.9,
      }),
      0.5
    );

    expect(decision).toMatchObject({
      status: "ok",
      value: {
        accepted: false,
        reason: "Claim payoff appears before its listener prerequisites",
      },
    });
  });

  it("rejects repetition that establishes no planned claim", async () => {
    const decision = await gateClaimsWithTypeSafe(
      request(),
      answering({ repeats_what_listeners_already_heard: 0.9 }),
      0.5
    );

    expect(decision).toMatchObject({
      value: {
        accepted: false,
        reason: "Candidate substantially repeats claims listeners already heard",
      },
    });
  });

  it("accepts repetition that still establishes a planned target claim", async () => {
    const decision = await gateClaimsWithTypeSafe(
      request(),
      answering({
        repeats_what_listeners_already_heard: 0.9,
        establishes_planned_claim_mechanism: 0.8,
      }),
      0.5
    );

    expect(decision).toMatchObject({ value: { accepted: true } });
  });

  it("does not ask about repetition on the first turn, or call at all with nothing to ask", async () => {
    const provider = answering({});

    const decision = await gateClaimsWithTypeSafe(
      request({ saidSoFar: [], blockedClaims: [], contributionTargets: [] }),
      provider,
      0.5
    );

    expect(decision).toEqual({ status: "ok", value: { accepted: true } });
    expect(provider.judge).not.toHaveBeenCalled();
  });
});

describe("gateClaims", () => {
  it("shadow: acts on the embedding gate and compares acceptance", async () => {
    const records: JudgmentRecord[] = [];
    const log: IJudgmentLog = {
      append: async (r) => void records.push(r),
      readAll: async () => records,
    };
    const runner = new JudgmentRunner(parseJudgmentModes("claim-gate=shadow"), log);

    const verdict = await gateClaims(request(), {
      runner,
      provider: answering({ repeats_what_listeners_already_heard: 0.9 }),
    });

    expect(verdict).toEqual({ accepted: true });
    expect(records[0]).toMatchObject({
      judgment: "claim-gate",
      agreed: false,
      typesafe: { accepted: false },
    });
  });
});
