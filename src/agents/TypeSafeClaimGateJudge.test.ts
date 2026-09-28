import { describe, expect, it } from "vitest";
import {
  ClaimGateRequest,
  gateClaims,
  gateClaimsWithTypeSafe,
} from "./TypeSafeClaimGateJudge";
import { setJudgmentProvider } from "../services/judgment-runtime";
import { nouls, unavailableProvider } from "../test-support/judgments";

const request = (overrides: Partial<ClaimGateRequest> = {}): ClaimGateRequest => ({
  candidateTurn: "Dr. Kranz said CO2 hit 3.5 percent before the adaptor went in.",
  saidSoFar: ["Ada: The oxygen tank exploded two days out."],
  blockedClaims: [{ id: "payoff", text: "The adaptor brought CO2 levels back down." }],
  contributionTargets: [{ id: "mechanism", text: "Square filters were taped into round sockets." }],
  ...overrides,
});

describe("gateClaimsWithTypeSafe", () => {
  it("asks descriptively named yes/no questions over the whole turn", async () => {
    const provider = nouls({});

    await gateClaimsWithTypeSafe(request(), provider);

    const [{ state, questions }] = provider.calls;
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
    expect(await gateClaimsWithTypeSafe(request(), nouls({}))).toMatchObject({
      status: "ok",
      value: { accepted: true },
    });
  });

  it("rejects a claim stated before its prerequisites, first", async () => {
    const decision = await gateClaimsWithTypeSafe(
      request(),
      nouls({
        states_claim_before_prerequisites_payoff: 0.9,
        establishes_planned_claim_mechanism: 0.9,
      })
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
      nouls({ repeats_what_listeners_already_heard: 0.9 })
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
      nouls({
        repeats_what_listeners_already_heard: 0.9,
        establishes_planned_claim_mechanism: 0.8,
      })
    );

    expect(decision).toMatchObject({ value: { accepted: true } });
  });

  it("needs clear evidence to reject: 0.75 before-setup and 0.6 repetition still pass", async () => {
    const decision = await gateClaimsWithTypeSafe(
      request(),
      nouls({
        states_claim_before_prerequisites_payoff: 0.75,
        repeats_what_listeners_already_heard: 0.6,
      })
    );

    expect(decision).toMatchObject({ value: { accepted: true } });
  });

  it("accepts per-check threshold overrides", async () => {
    const decision = await gateClaimsWithTypeSafe(
      request(),
      nouls({ states_claim_before_prerequisites_payoff: 0.6 }),
      { prerequisite: 0.5, repetition: 0.7, establishesTarget: 0.5 }
    );

    expect(decision).toMatchObject({ value: { accepted: false } });
  });

  it("does not ask about repetition on the first turn, or call at all with nothing to ask", async () => {
    const provider = nouls({});

    const decision = await gateClaimsWithTypeSafe(
      request({ saidSoFar: [], blockedClaims: [], contributionTargets: [] }),
      provider
    );

    expect(decision).toEqual({ status: "ok", value: { accepted: true } });
    expect(provider.calls).toEqual([]);
  });
});

describe("gateClaims", () => {
  it("returns the provider's verdict", async () => {
    setJudgmentProvider(nouls({ repeats_what_listeners_already_heard: 0.9 }));
    expect(await gateClaims(request())).toMatchObject({ accepted: false });
  });

  it("accepts when the provider is unavailable", async () => {
    setJudgmentProvider(unavailableProvider());
    expect(await gateClaims(request())).toEqual({ accepted: true });
  });
});
