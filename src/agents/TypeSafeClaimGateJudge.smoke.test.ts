import "dotenv/config";
import { describe, expect, it } from "vitest";
import { gateClaimsWithTypeSafe, ClaimGateRequest } from "./TypeSafeClaimGateJudge";
import { TypeSafeJudgmentProvider } from "../providers/TypeSafeJudgmentProvider";

// Live check of the claim gate's policy on whole turns, including text that
// breaks regex sentence splitting (abbreviations, decimals). Skipped unless
// TYPESAFE_API_KEY is set.
const saidSoFar = [
  "Ada: Today we're talking about Apollo 13, the 1970 Moon mission that went badly wrong.",
  "Ben: Two days out, an oxygen tank exploded and the crew lost most of their power and oxygen.",
  "Ada: So the three of them moved into the lunar module and used it as a lifeboat.",
];
const base = {
  saidSoFar,
  blockedClaims: [],
  contributionTargets: [],
};

const cases: [string, ClaimGateRequest, boolean][] = [
  [
    "new detail with abbreviations and decimals",
    {
      ...base,
      candidateTurn:
        "Flight director Gene Kranz — 'Mr. Steady' to his team — watched the cabin's CO2 reading climb past 7.5 mm, well beyond the usual limit.",
    },
    true,
  ],
  [
    "substantial repetition",
    {
      ...base,
      candidateTurn:
        "Right, so an oxygen tank blew up two days into the flight, and the crew lost most of their power and oxygen.",
    },
    false,
  ],
  [
    "payoff before its prerequisite",
    {
      ...base,
      candidateTurn: "And once the taped-up adaptor was in, the carbon dioxide levels dropped back to safe.",
      blockedClaims: [
        { id: "adaptor-payoff", text: "The improvised adaptor brought the carbon dioxide levels back down." },
      ],
    },
    false,
  ],
  [
    "repetition that establishes a planned claim",
    {
      ...base,
      candidateTurn:
        "Yes, they were in the lander as a lifeboat — and its round filters couldn't take the main ship's square spares.",
      contributionTargets: [
        { id: "filter-mismatch", text: "The lander's filter sockets were round but the spare filters were square." },
      ],
    },
    true,
  ],
];

describe.skipIf(!process.env.TYPESAFE_API_KEY)("TypeSafe claim gate (live)", () => {
  const provider = new TypeSafeJudgmentProvider({ timeoutMs: 15000 });

  it("applies the claim gate policy to whole turns", async () => {
    const results = await Promise.all(
      cases.map(async ([name, request, expected]) => ({
        name,
        expected,
        decision: await gateClaimsWithTypeSafe(request, provider),
      }))
    );
    console.log(
      "claim gate results:",
      JSON.stringify(
        results.map(({ name, expected, decision }) => ({
          name,
          expected,
          got: decision.status === "ok" ? decision.value.accepted : decision.reason,
          detail: decision.status === "ok" ? decision.detail : undefined,
        }))
      )
    );
    for (const { expected, decision } of results) {
      expect(decision).toMatchObject({ status: "ok", value: { accepted: expected } });
    }
  }, 60000);
});
