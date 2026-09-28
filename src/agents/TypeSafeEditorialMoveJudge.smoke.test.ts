import "dotenv/config";
import { describe, expect, it } from "vitest";
import { chooseEditorialMoveWithTypeSafe } from "./TypeSafeEditorialMoveJudge";
import { TypeSafeJudgmentProvider } from "../providers/TypeSafeJudgmentProvider";
import { EditorialMove as Move, Speech } from "../types";

// Live check that the judged move matches what the direction asks for,
// including directions that don't name the move. Skipped unless
// TYPESAFE_API_KEY is set.
const recent = [
  { speaker: { name: "Ben" }, message: "Two days out, an oxygen tank exploded and they lost most of their power." },
  { speaker: { name: "Ada" }, message: "So they climbed into the lunar module as a lifeboat." },
] as unknown as Speech[];

const cases: [string, Move[]][] = [
  ["Find out from Ben what the crew tried first once they were in the lander.", [Move.Question]],
  ["Help listeners picture just how cramped and cold it was in there — something they can see.", [Move.Illustrate, Move.Humanise]],
  ["Ada isn't convinced the duct tape deserves all the credit — have her say so.", [Move.Challenge]],
  ["Bring in what the astronauts' families were going through back on Earth.", [Move.Humanise, Move.AddContext]],
  ["We've done the rescue; take us on to the re-entry.", [Move.Transition]],
  ["Have Ben say what this teaches us about engineering under pressure.", [Move.FindMeaning]],
];

describe.skipIf(!process.env.TYPESAFE_API_KEY)("TypeSafe editorial move (live)", () => {
  it("picks a move that matches the direction", async () => {
    const provider = new TypeSafeJudgmentProvider({ timeoutMs: 15000 });
    const results = await Promise.all(
      cases.map(async ([direction, acceptable]) => ({
        direction,
        acceptable,
        decision: await chooseEditorialMoveWithTypeSafe(
          { recentSpeeches: recent, direction },
          provider
        ),
      }))
    );
    console.log(
      "editorial moves:",
      JSON.stringify(
        results.map(({ direction, acceptable, decision }) => ({
          direction: direction.slice(0, 40),
          acceptable,
          got: decision.status === "ok" ? decision.value : decision.reason,
          confidence: decision.status === "ok" ? (decision.detail as any).confidence : undefined,
        }))
      )
    );
    for (const { acceptable, decision } of results) {
      expect(decision.status).toBe("ok");
      if (decision.status === "ok") expect(acceptable).toContain(decision.value);
    }
  }, 60000);
});
