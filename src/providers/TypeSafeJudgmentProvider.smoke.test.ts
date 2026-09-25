import "dotenv/config";
import { describe, expect, it } from "vitest";
import { TypeSafeJudgmentProvider } from "./TypeSafeJudgmentProvider";
import { choice, noul, score } from "./judgment-questions";

// Live smoke test against the real TypeSafe API. Skipped unless
// TYPESAFE_API_KEY is set (in the environment or a cwd .env).
describe.skipIf(!process.env.TYPESAFE_API_KEY)(
  "TypeSafeJudgmentProvider (live)",
  () => {
    it("returns a typed choice, noul and score", async () => {
      const result = await new TypeSafeJudgmentProvider({
        timeoutMs: 15000,
      }).judge(
        { message: "I was charged twice this month and need a refund today!" },
        {
          team: choice("Which team should handle this message?", {
            billing: "Payments, invoicing, refunds",
            technical: "Bugs, outages, integrations",
          }),
          urgent: noul("Does the message convey urgency?"),
          anger: score("How frustrated is the customer?", [
            "Calm",
            "Frustrated",
            "Very angry",
          ]),
        }
      );

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.answers.team.choice).toBe("billing");
      expect(result.answers.urgent.probability).toBeGreaterThan(0.5);
      expect(typeof result.answers.anger.score).toBe("number");
    });
  }
);
