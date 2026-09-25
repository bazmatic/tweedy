import "dotenv/config";
import { describe, expect, it } from "vitest";
import { scoreStoryValuesWithTypeSafe } from "./TypeSafeStoryValueJudge";
import { TypeSafeJudgmentProvider } from "../providers/TypeSafeJudgmentProvider";

// Live check that story-value Scores rank cards sensibly. Skipped unless
// TYPESAFE_API_KEY is set.
const cards = [
  { id: "raw_statistic", content: "The Apollo 13 mission lasted 5 days, 22 hours and 54 minutes." },
  { id: "flat_fact", content: "The Apollo spacecraft had a command module, a service module and a lunar module." },
  { id: "hook", content: "With carbon dioxide rising, the crew built a life-saving filter adaptor out of duct tape, plastic bags, a sock and the cover of their flight plan." },
];

describe.skipIf(!process.env.TYPESAFE_API_KEY)("TypeSafe card story value (live)", () => {
  it("ranks a vivid hook above a flat fact and a raw statistic", async () => {
    const decision = await scoreStoryValuesWithTypeSafe(
      { podcastTitle: "Apollo 13: Houston, we've had a problem", cards, current: async () => ({}) },
      new TypeSafeJudgmentProvider({ timeoutMs: 15000 })
    );
    console.log("story values:", JSON.stringify(decision));
    expect(decision.status).toBe("ok");
    if (decision.status !== "ok") return;
    const v = decision.value;
    expect(v.hook).toBeGreaterThanOrEqual(7);
    expect(v.hook).toBeGreaterThan(v.flat_fact);
    expect(v.hook).toBeGreaterThan(v.raw_statistic);
    expect(v.raw_statistic).toBeLessThanOrEqual(5);
  }, 60000);
});
