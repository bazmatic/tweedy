import "dotenv/config";
import { describe, expect, it } from "vitest";
import { judgeResponseObligationWithTypeSafe } from "./TypeSafeObligationJudge";
import { ConversationalObligation } from "./ResponseModePolicy";
import { TypeSafeJudgmentProvider } from "../providers/TypeSafeJudgmentProvider";
import { Speech } from "../types";

// Live check on the cases the trailing-"?" rule gets wrong, plus controls.
// Skipped unless TYPESAFE_API_KEY is set.
const said = (name: string, message: string) =>
  ({ speaker: { id: name, name }, message }) as unknown as Speech;

const setup = said("Ada", "Two days out, an oxygen tank exploded and the crew lost most of their power.");

const cases: [string, string, ConversationalObligation][] = [
  ["plain question", "So how did they keep breathing?", ConversationalObligation.AnswerQuestion],
  ["unpunctuated request", "Walk me through how they kept breathing after that", ConversationalObligation.AnswerQuestion],
  ["rhetorical question", "Can you imagine? Three people, a tiny lander, and four days to get home. It's staggering.", ConversationalObligation.ExecuteBrief],
  ["pushback as statement", "I'm not sure I buy that. A few strips of duct tape holding for four days sounds like myth.", ConversationalObligation.AnswerChallenge],
  ["plain statement", "What strikes me is how calm the crew sounded on the recordings.", ConversationalObligation.ExecuteBrief],
];

describe.skipIf(!process.env.TYPESAFE_API_KEY)(
  "TypeSafe response obligation (live)",
  () => {
    const provider = new TypeSafeJudgmentProvider({ timeoutMs: 15000 });

    it("judges what the next speaker owes the previous turn", async () => {
      const results = await Promise.all(
        cases.map(async ([name, message, expected]) => {
          const decision = await judgeResponseObligationWithTypeSafe(
            {
              recentSpeeches: [setup, said("Ben", message)],
              nextSpeakerName: "Ada",
            },
            provider
          );
          return { name, expected, decision };
        })
      );

      console.log(
        "obligation results:",
        JSON.stringify(
          results.map(({ name, expected, decision }) => ({
            name,
            expected,
            got: decision.status === "ok" ? decision.value : decision.reason,
            detail: decision.status === "ok" ? decision.detail : undefined,
          }))
        )
      );
      for (const { expected, decision } of results) {
        expect(decision).toMatchObject({ status: "ok", value: expected });
      }
    }, 60000);
  }
);
