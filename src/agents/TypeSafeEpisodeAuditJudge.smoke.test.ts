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
      { speeches, maxIssues: 3 },
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
    expect(decision.value.find((i) => i.speechId === "t1")?.category).toBe("dependency_order");
    expect(decision.value.find((i) => i.speechId === "t5")?.category).toBe("substantial_repetition");
  }, 60000);

  it("flags missing context and broken continuity", async () => {
    const lines: [string, string, string][] = [
      ["u0", "Ada", "Welcome back. Today: how mission control handled the Apollo 13 crisis."],
      ["u1", "Ben", "It all came down to the Kranz rule, really — once that kicked in, nobody panicked."],
      ["u2", "Ada", "Hang on — what was the first thing flight control actually did after the explosion?"],
      ["u3", "Ben", "The food on board was freeze-dried, and the crew rehydrated it with water from the fuel cells."],
      ["u4", "Ada", "That's our time. Thanks for listening, and see you next time."],
    ];
    const speeches = lines.map(([id, name, message]) => ({ id, speaker: { name }, message }) as unknown as Speech);
    const decision = await auditEpisodeTurnsWithTypeSafe(
      { speeches, maxIssues: 3 },
      new TypeSafeJudgmentProvider({ timeoutMs: 20000 }),
      0.5
    );
    console.log("episode audit 2:", JSON.stringify(decision));
    if (decision.status !== "ok") throw new Error(decision.reason);
    const byTurn = Object.fromEntries(decision.value.map((i) => [i.speechId, i.category]));
    expect(byTurn.u1).toBe("listener_context");
    expect(byTurn.u3).toBe("continuity");
    expect(byTurn.u0).toBeUndefined();
    expect(byTurn.u2).toBeUndefined();
  }, 60000);
});
