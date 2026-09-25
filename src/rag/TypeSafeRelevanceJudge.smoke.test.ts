import "dotenv/config";
import { describe, expect, it } from "vitest";
import { rerankByRelevanceWithTypeSafe, DEFAULT_RELEVANCE_FLOOR } from "./TypeSafeRelevanceJudge";
import { TypeSafeJudgmentProvider } from "../providers/TypeSafeJudgmentProvider";
import { Document } from "../types";

// A small labelled set of query/document pairs for the RAG relevance
// rerank, run live. Each query's candidates are what a similarity search
// might plausibly return: some relevant, some same-topic but unhelpful.
// Skipped unless TYPESAFE_API_KEY is set.
type Labelled = { id: string; content: string; relevant: boolean };

const set: { query: string; docs: Labelled[] }[] = [
  {
    query: "How did the Apollo 13 crew deal with rising carbon dioxide?",
    docs: [
      { id: "adaptor", content: "Engineers devised an adaptor from duct tape, plastic bags and cardboard so the command module's square lithium hydroxide canisters could be used in the lunar module's round sockets.", relevant: true },
      { id: "co2-levels", content: "By the third day the partial pressure of carbon dioxide in the lunar module was approaching dangerous levels because its own canisters were saturated.", relevant: true },
      { id: "launch", content: "Apollo 13 launched from Kennedy Space Center on 11 April 1970 atop a Saturn V rocket.", relevant: false },
      { id: "crew-bios", content: "Jim Lovell was a veteran of Gemini 7, Gemini 12 and Apollo 8 before commanding Apollo 13.", relevant: false },
    ],
  },
  {
    query: "What caused the oxygen tank explosion?",
    docs: [
      { id: "thermostat", content: "Damaged thermostatic switches, rated for 28 volts rather than the 65 volts used in ground tests, let heater temperatures soar during a pre-flight detanking and scorched the wiring insulation.", relevant: true },
      { id: "stir", content: "When the crew switched on the tank's stirring fans, a spark from the damaged wiring ignited the insulation and the tank ruptured.", relevant: true },
      { id: "splashdown", content: "The command module splashed down in the South Pacific near the recovery ship USS Iwo Jima.", relevant: false },
      { id: "moon-landing-cancelled", content: "The planned landing at the Fra Mauro highlands was reassigned to Apollo 14.", relevant: false },
    ],
  },
  {
    query: "How did the crew survive the cold on the way home?",
    docs: [
      { id: "power-down", content: "To save battery power the lunar module was run with almost everything switched off, and cabin temperatures fell to around 3°C.", relevant: true },
      { id: "condensation", content: "Water condensed on the walls and panels, and the crew slept little because of the cold.", relevant: true },
      { id: "tv-broadcast", content: "Before the accident, US networks declined to carry the crew's live television broadcast.", relevant: false },
      { id: "rocket-stages", content: "The Saturn V's third stage was deliberately crashed into the Moon to test seismometers.", relevant: false },
    ],
  },
];

describe.skipIf(!process.env.TYPESAFE_API_KEY)("TypeSafe RAG relevance (live, labelled)", () => {
  it("keeps relevant documents and drops same-topic distractors", async () => {
    const provider = new TypeSafeJudgmentProvider({ timeoutMs: 20000 });
    let keptRelevant = 0;
    let keptIrrelevant = 0;
    let totalRelevant = 0;
    const rows: string[] = [];

    for (const { query, docs } of set) {
      const decision = await rerankByRelevanceWithTypeSafe(
        {
          query,
          candidates: docs.map(({ id, content }) => ({ id, content, metadata: {} }) as Document),
          limit: 4,
          current: async () => [],
        },
        provider,
        DEFAULT_RELEVANCE_FLOOR
      );
      expect(decision.status).toBe("ok");
      if (decision.status !== "ok") continue;
      const kept = new Set(decision.value.map((doc) => doc.id));
      const relevance = (decision.detail as { relevance: Record<string, number> }).relevance;
      for (const doc of docs) {
        if (doc.relevant) totalRelevant++;
        if (kept.has(doc.id)) doc.relevant ? keptRelevant++ : keptIrrelevant++;
        rows.push(`${doc.relevant ? "R" : "-"} ${kept.has(doc.id) ? "kept" : "drop"} ${relevance[doc.id].toFixed(2)} ${doc.id}`);
      }
    }

    console.log("rag relevance:\n" + rows.join("\n"));
    console.log(`kept relevant ${keptRelevant}/${totalRelevant}, kept irrelevant ${keptIrrelevant}`);
    expect(keptRelevant).toBeGreaterThanOrEqual(totalRelevant - 1);
    expect(keptIrrelevant).toBeLessThanOrEqual(1);
  }, 90000);
});
