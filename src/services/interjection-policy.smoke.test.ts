import "dotenv/config";
import { describe, expect, it } from "vitest";
import { calibrate, judgeInterjectionNaturalness } from "./interjection-policy";
import { TypeSafeJudgmentProvider } from "../providers/TypeSafeJudgmentProvider";

const cases: [string, string, "high" | "low"][] = [
  ["surprising detail", "And here's the wild part — they built the adaptor from plastic bags, cardboard and a flight manual cover, in under an hour.", "high"],
  ["vivid moment", "Imagine it: three men, a freezing cabin, and water beading on every panel for four days.", "high"],
  ["provocative claim", "Honestly, I think the duct tape story is the most overrated part of the whole rescue.", "high"],
  ["flat fact", "The mission launched in April 1970.", "low"],
  ["flat fact two", "The spacecraft had three modules.", "low"],
  ["question to co-host", "So what do you think mission control should have done about re-entry?", "low"],
];

describe.skipIf(!process.env.TYPESAFE_API_KEY)("interjection naturalness (live, labelled)", () => {
  it("interjects after striking turns and rarely after flat ones", async () => {
    const provider = new TypeSafeJudgmentProvider({ timeoutMs: 15000 });
    const results = await Promise.all(
      cases.map(async ([name, text, expected]) => {
        const decision = await judgeInterjectionNaturalness(text, "Ben", provider);
        if (decision.status !== "ok") throw new Error(`${name}: ${decision.reason}`);
        return { name, expected, chance: calibrate(decision.value), probability: decision.value };
      })
    );
    console.log("interjection chances:", JSON.stringify(results));
    for (const r of results) {
      if (r.expected === "high") expect(r.chance, r.name).toBeGreaterThanOrEqual(0.5);
      else expect(r.chance, r.name).toBeLessThanOrEqual(0.2);
    }
  }, 60000);
});
