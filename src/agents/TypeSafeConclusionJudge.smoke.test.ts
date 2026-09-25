import "dotenv/config";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONCLUSION_THRESHOLD,
  judgeConversationCompleteWithTypeSafe,
} from "./TypeSafeConclusionJudge";
import { TypeSafeJudgmentProvider } from "../providers/TypeSafeJudgmentProvider";

// Live contrast between a real wrap-up and a sign-off tacked onto an open
// thread. Skipped unless TYPESAFE_API_KEY is set.
describe.skipIf(!process.env.TYPESAFE_API_KEY)(
  "TypeSafe conclusion judge (live)",
  () => {
    const provider = new TypeSafeJudgmentProvider({ timeoutMs: 15000 });

    it("separates a natural wrap-up from a sign-off mid-thought", async () => {
      const wrapped = await judgeConversationCompleteWithTypeSafe(
        "HOST: So the duct-tape fix held, and all three came home.\n" +
          "GUEST: Proof that improvisation under pressure can save lives.\n" +
          "HOST: That's our story for today. Thanks for listening, and see you next time!",
        provider,
        DEFAULT_CONCLUSION_THRESHOLD
      );
      const midThought = await judgeConversationCompleteWithTypeSafe(
        "HOST: And that's when the second tank started venting too, which raises a question we haven't even touched —\n" +
          "GUEST: Wait, but what did mission control decide about re-entry? Nobody's said yet.\n" +
          "HOST: Thanks for listening, see you next time!",
        provider,
        DEFAULT_CONCLUSION_THRESHOLD
      );

      console.log("conclusion probabilities:", {
        wrapped: wrapped.status === "ok" ? wrapped.detail : wrapped,
        midThought: midThought.status === "ok" ? midThought.detail : midThought,
      });
      expect(wrapped).toMatchObject({ status: "ok", value: true });
      expect(midThought).toMatchObject({ status: "ok", value: false });
    });
  }
);
