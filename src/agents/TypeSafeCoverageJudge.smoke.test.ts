import "dotenv/config";
import { describe, expect, it } from "vitest";
import { judgeCoverageWithTypeSafe } from "./TypeSafeCoverageJudge";
import { TypeSafeJudgmentProvider } from "../providers/TypeSafeJudgmentProvider";

// Live check of the director verifier's own adversarial example. Skipped
// unless TYPESAFE_API_KEY is set (in the environment or a cwd .env).
describe.skipIf(!process.env.TYPESAFE_API_KEY)(
  "TypeSafe coverage judge (live)",
  () => {
    it("does not count a topically-adjacent mention as coverage", async () => {
      const decision = await judgeCoverageWithTypeSafe(
        {
          kind: "point",
          items: [
            { id: "scrubber", text: "CO2 scrubber duct-tape hack" },
            { id: "tank", text: "Oxygen tank explosion crippled the service module" },
          ],
          transcript:
            "HOST: Two days out, an oxygen tank exploded and crippled the service module.\n" +
            "GUEST: Right, and suddenly the crew had lost most of their power and oxygen.",
        },
        new TypeSafeJudgmentProvider({ timeoutMs: 15000 }),
        0.5
      );

      expect(decision.status).toBe("ok");
      if (decision.status !== "ok") return;
      console.log("coverage probabilities:", decision.detail);
      expect(decision.value).toEqual(["tank"]);
    });
  }
);
