import "dotenv/config";
import { describe, expect, it } from "vitest";
import { auditEpisodeTurnsWithTypeSafe } from "./TypeSafeEpisodeAuditJudge";
import { TypeSafeJudgmentProvider } from "../providers/TypeSafeJudgmentProvider";
import { Speech } from "../types";

// Live check: a short transcript with two planted defects (a payoff before
// its setup, and a verbatim repeat). Skipped unless TYPESAFE_API_KEY is set.
const lines: [string, string, string][] = [
  ["t0", "Ada", "Welcome to the show. Today: Apollo 13, the 1970 Moon mission that went badly wrong."],
  ["t1", "Ben", "And in the end, the taped-up adaptor is what brought the carbon dioxide back down."],
  ["t2", "Ada", "Let's start at the beginning — what actually went wrong?"],
  ["t3", "Ben", "Two days out, an oxygen tank exploded and the crew lost most of their power and oxygen."],
  ["t4", "Ada", "So they moved into the lunar module, the little lander, and used it as a lifeboat."],
  ["t5", "Ben", "Right — two days out, an oxygen tank exploded and they lost most of their power and oxygen."],
  ["t6", "Ada", "That's our story. Thanks for listening, and see you next time."],
];
const speeches = lines.map(
  ([id, name, message]) => ({ id, speaker: { name }, message }) as unknown as Speech
);

describe.skipIf(!process.env.TYPESAFE_API_KEY)("TypeSafe episode audit (live)", () => {
  it("flags the planted defects and leaves clean turns alone", async () => {
    const decision = await auditEpisodeTurnsWithTypeSafe(
      { speeches, maxIssues: 3, current: async () => [] },
      new TypeSafeJudgmentProvider({ timeoutMs: 20000 }),
      0.5
    );

    console.log("episode audit:", JSON.stringify(decision));
    expect(decision.status).toBe("ok");
    if (decision.status !== "ok") return;
    const flagged = decision.value.map((issue) => issue.speechId);
    expect(flagged).toContain("t1");
    expect(flagged).toContain("t5");
    expect(flagged).not.toContain("t3");
    expect(flagged).not.toContain("t4");
  }, 60000);
});
