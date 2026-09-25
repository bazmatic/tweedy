import "dotenv/config";
import { describe, expect, it } from "vitest";
import { filterResearchWithTypeSafe } from "./TypeSafeResearchFilter";
import { TypeSafeJudgmentProvider } from "../providers/TypeSafeJudgmentProvider";
import { PodcastMaterial, ResearchMaterial, SourceType } from "../types";

// Live check of the research filter on one good result and three that
// should be skipped. Skipped unless TYPESAFE_API_KEY is set.
const r = (title: string, content: string, citations: string[]): ResearchMaterial => ({
  title,
  content,
  source: "perplexity",
  sourceType: SourceType.Research,
  metadata: { citations },
});

const existing = [
  {
    title: "Apollo 13 overview",
    content:
      "Apollo 13 launched in April 1970. Two days out, an oxygen tank in the service module exploded, and the crew used the lunar module as a lifeboat to return safely to Earth.",
  } as PodcastMaterial,
];

const results = [
  r("CO2 adaptor", "To stop carbon dioxide building up in the lunar module, engineers designed an adaptor from duct tape, plastic bags and cardboard so the command module's square lithium hydroxide canisters fitted the lander's round sockets [1][2].", ["https://www.nasa.gov/apollo13-co2", "https://airandspace.si.edu/apollo-13"]),
  r("Space tourism prices", "Commercial suborbital flights now cost several hundred thousand dollars per seat, with prices expected to fall as launch cadence increases [1].", ["https://example.com/space-tourism"]),
  r("Apollo 13 summary", "Apollo 13 launched in April 1970; two days into the flight an oxygen tank exploded, and the astronauts used the lunar module as a lifeboat to get home safely [1].", ["https://en.wikipedia.org/wiki/Apollo_13"]),
  r("Hidden sabotage theory", "Some believe the tank explosion was deliberate sabotage covered up by NASA, and that the real CO2 fix was a secret device never shown to the public.", []),
];

describe.skipIf(!process.env.TYPESAFE_API_KEY)("TypeSafe research filter (live)", () => {
  it("keeps the good result and skips off-topic, duplicate and speculative ones", async () => {
    const decision = await filterResearchWithTypeSafe(
      {
        query: "How did the Apollo 13 crew deal with rising carbon dioxide?",
        results,
        loadExistingMaterials: async () => existing,
      },
      new TypeSafeJudgmentProvider({ timeoutMs: 20000 }),
      0.5
    );
    console.log("research filter:", JSON.stringify(decision));
    expect(decision.status).toBe("ok");
    if (decision.status !== "ok") return;
    const rejected = new Set(decision.value.map((x) => x.title));
    expect(rejected.has("CO2 adaptor")).toBe(false);
    expect(rejected.has("Space tourism prices")).toBe(true);
    expect(rejected.has("Apollo 13 summary")).toBe(true);
    expect(rejected.has("Hidden sabotage theory")).toBe(true);
  }, 60000);
});
