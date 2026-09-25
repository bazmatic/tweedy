import "dotenv/config";
import { describe, expect, it } from "vitest";
import { decideInterjection } from "./interjection-policy";
import { JudgmentRunner } from "./JudgmentRunner";
import { JudgmentRecord } from "./JudgmentLog";
import { parseJudgmentModes } from "./judgment-modes";
import { TypeSafeJudgmentProvider } from "../providers/TypeSafeJudgmentProvider";
import { SpeakerAgentToolName } from "../agents/speaker-tools";

// Live check that the naturalness probability ranks turns sensibly. Skipped
// unless TYPESAFE_API_KEY is set.
const turns = {
  surprising:
    "And here's the wild part — they built the adaptor from plastic bags, cardboard and the cover of a flight manual, in under an hour.",
  question: "So what do you think mission control should have done about re-entry?",
  flat: "The mission launched in April 1970.",
};

describe.skipIf(!process.env.TYPESAFE_API_KEY)("TypeSafe interjection (live)", () => {
  it("rates a surprising detail as a more natural moment than a question or a flat fact", async () => {
    const records: JudgmentRecord[] = [];
    const runner = new JudgmentRunner(parseJudgmentModes("interjection=shadow"), {
      append: async (r) => void records.push(r),
      readAll: async () => records,
    });
    const provider = new TypeSafeJudgmentProvider({ timeoutMs: 15000 });

    const probabilities: Record<string, number> = {};
    for (const [name, message] of Object.entries(turns)) {
      const before = records.length;
      await decideInterjection(
        { speaker: { name: "Ben" } as any, message, tool: SpeakerAgentToolName.SPEAK },
        2,
        0.5,
        { runner, provider }
      );
      probabilities[name] = (records[before].typesafeDetail as { probability: number }).probability;
    }

    console.log("interjection probabilities:", JSON.stringify(probabilities));
    expect(probabilities.surprising).toBeGreaterThan(0.5);
    expect(probabilities.surprising).toBeGreaterThan(probabilities.question);
    expect(probabilities.surprising).toBeGreaterThan(probabilities.flat);
  }, 60000);
});
