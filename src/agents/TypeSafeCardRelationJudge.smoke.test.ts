import "dotenv/config";
import { describe, expect, it } from "vitest";
import { extractCardRelationsWithTypeSafe } from "./TypeSafeCardRelationJudge";
import { TypeSafeJudgmentProvider } from "../providers/TypeSafeJudgmentProvider";
import { CardRelationType as R } from "../types";

// Live check of relation labels on card groups. Skipped unless
// TYPESAFE_API_KEY is set.
const c = (id: string, content: string) => ({ id, content, significance: "" });

const cases: [string, ReturnType<typeof c>[], string[]][] = [
  ["cause", [c("tank", "An oxygen tank exploded two days into the flight."), c("power", "The crew lost most of their electrical power and oxygen.")], [R.CausesOrLeadsTo]],
  ["contrast", [c("calm", "The crew's radio calls stayed remarkably calm throughout."), c("panic", "Inside mission control, engineers described near-panic in the first hour.")], [R.Contrasts]],
  ["answer", [c("q", "How could square filters possibly fit into round sockets?"), c("a", "Engineers devised an adaptor from duct tape, plastic bags and cardboard.")], [R.AnswersQuestion]],
  ["unrelated", [c("food", "The astronauts' food was freeze-dried and rehydrated with water."), c("tv", "Television networks had stopped broadcasting the mission before the accident.")], ["none"]],
];

describe.skipIf(!process.env.TYPESAFE_API_KEY)("TypeSafe card relations (live)", () => {
  it("labels card groups by how they relate", async () => {
    const decision = await extractCardRelationsWithTypeSafe(
      { candidateGroups: cases.map(([, group]) => group), current: async () => [] },
      new TypeSafeJudgmentProvider({ timeoutMs: 15000 })
    );
    console.log("card relations:", JSON.stringify(decision.status === "ok" ? decision.detail : decision));
    expect(decision.status).toBe("ok");
    if (decision.status !== "ok") return;
    cases.forEach(([, group, acceptable]) => {
      const edge = decision.value.find((e) => e.cardIds.includes(group[0].id));
      expect(acceptable).toContain(edge?.relationType ?? "none");
    });
  }, 60000);
});
