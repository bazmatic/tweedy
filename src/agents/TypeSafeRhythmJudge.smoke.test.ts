import "dotenv/config";
import { describe, expect, it } from "vitest";
import { judgeRhythmWithTypeSafe } from "./TypeSafeRhythmJudge";
import {
  RECENT_TURNS_ALL_BRIEF_REACTIONS,
  RECENT_TURNS_INFORMATION_HEAVY,
} from "./ConversationRhythmPolicy";
import { TypeSafeJudgmentProvider } from "../providers/TypeSafeJudgmentProvider";
import { SpeakerAgentToolName as Tool } from "./speaker-tools";
import { Speech } from "../types";

// Live check of rhythm judged from content, including turns whose tool
// labels misstate what they carry. Skipped unless TYPESAFE_API_KEY is set.
const said = (name: string, message: string, tool: Tool) =>
  ({ speaker: { id: name, name }, message, tool }) as unknown as Speech;

const cases: [string, Speech[], unknown][] = [
  [
    "all brief reactions",
    [said("Ada", "Oh, wow.", Tool.FILLER_COMMENT), said("Ben", "No way!", Tool.INTERJECT), said("Ada", "Huh, really?", Tool.SHORT_QUESTION)],
    RECENT_TURNS_ALL_BRIEF_REACTIONS,
  ],
  [
    "dense back-to-back explanation",
    [
      said("Ben", "The lithium hydroxide canisters absorb carbon dioxide chemically, and each one saturates after a fixed load.", Tool.SPEAK),
      said("Ada", "And the lander's canisters were sized for two people for about two days, not three people for four.", Tool.SPEAK),
      said("Ben", "Which meant the partial pressure of CO2 climbed steadily, past the point where crews start getting headaches and impaired judgement.", Tool.EXPLAIN),
    ],
    RECENT_TURNS_INFORMATION_HEAVY,
  ],
  [
    "varied rhythm",
    [
      said("Ben", "They taped the square filters into the round sockets with plastic bags and cardboard.", Tool.SPEAK),
      said("Ada", "Duct tape saved them?", Tool.SHORT_QUESTION),
      said("Ben", "Pretty much — and it held for the rest of the flight.", Tool.SPEAK),
    ],
    undefined,
  ],
  [
    "reaction-tool labels on substantive turns",
    [
      said("Ada", "So the lander was built for two astronauts for two days, but it had to keep three alive for four.", Tool.ONE_LINER),
      said("Ben", "Right, and its round CO2 canisters couldn't take the command module's square spares.", Tool.ONE_LINER),
      said("Ada", "So mission control had to invent an adaptor from whatever the crew had on board.", Tool.ONE_LINER),
    ],
    "not-brief-reactions",
  ],
];

describe.skipIf(!process.env.TYPESAFE_API_KEY)("TypeSafe conversation rhythm (live)", () => {
  const provider = new TypeSafeJudgmentProvider({ timeoutMs: 15000 });

  it("judges rhythm from what was said", async () => {
    const results = await Promise.all(
      cases.map(async ([name, speeches, expected]) => ({
        name,
        expected,
        decision: await judgeRhythmWithTypeSafe({ recentSpeeches: speeches }, provider),
      }))
    );
    console.log(
      "rhythm results:",
      JSON.stringify(
        results.map(({ name, decision }) => ({
          name,
          typesafe: decision.status === "ok" ? (decision.detail as any).choice : decision.reason,
          confidence: decision.status === "ok" ? (decision.detail as any).confidence : undefined,
        }))
      )
    );
    for (const { expected, decision } of results) {
      expect(decision.status).toBe("ok");
      if (decision.status !== "ok") continue;
      if (expected === "not-brief-reactions") {
        expect(decision.value).not.toBe(RECENT_TURNS_ALL_BRIEF_REACTIONS);
      } else {
        expect(decision.value).toBe(expected);
      }
    }
  }, 60000);
});
