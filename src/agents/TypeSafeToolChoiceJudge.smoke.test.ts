import "dotenv/config";
import { describe, expect, it } from "vitest";
import { chooseSpeakerToolWithTypeSafe, ToolChoiceRequest } from "./TypeSafeToolChoiceJudge";
import {
  INTERJECTION_TOOLS,
  INTERVIEWER_TOOLS,
  SpeakerAgentToolName as Tool,
} from "./speaker-tools";
import { TypeSafeJudgmentProvider } from "../providers/TypeSafeJudgmentProvider";
import { Speech } from "../types";

// Live check that the pre-chosen tool fits the moment. Several tools can be
// reasonable for one turn, so each case lists the acceptable ones. Skipped
// unless TYPESAFE_API_KEY is set.
const said = (name: string, message: string) =>
  ({ speaker: { id: name, name }, message }) as unknown as Speech;

const expert = { name: "Ben", personality: "space historian", epistemicRole: "expert" };
const guide = { name: "Ada", personality: "curious host", epistemicRole: "audience_guide" };

const cases: [string, ToolChoiceRequest, Tool[]][] = [
  [
    "expert answering a direct question",
    {
      kind: "turn",
      allowedTools: [Tool.SPEAK, Tool.EXPLAIN, Tool.QUOTE],
      recentSpeeches: [said("Ada", "Wait — how does a square filter go into a round socket?")],
      nextSpeaker: expert,
      directorGuidance: "Answer how the adaptor worked.",
    },
    [Tool.SPEAK, Tool.EXPLAIN],
  ],
  [
    "host checking understanding",
    {
      kind: "turn",
      allowedTools: INTERVIEWER_TOOLS,
      recentSpeeches: [
        said("Ben", "The lander's lithium hydroxide canisters were saturating, so carbon dioxide was building up faster than they could remove it."),
      ],
      nextSpeaker: guide,
      directorGuidance: "Restate that in plain words for listeners to check you've understood.",
    },
    [Tool.PARAPHRASE],
  ],
  [
    "host doubting a claim",
    {
      kind: "turn",
      allowedTools: INTERVIEWER_TOOLS,
      recentSpeeches: [said("Ben", "Honestly, the duct tape was the least impressive part of the whole rescue.")],
      nextSpeaker: guide,
      directorGuidance: "You don't buy that — push back with a real objection.",
    },
    [Tool.CHALLENGE],
  ],
  [
    "host moving the story on",
    {
      kind: "turn",
      allowedTools: INTERVIEWER_TOOLS,
      recentSpeeches: [said("Ben", "And with the filters rigged, the carbon dioxide levels finally started to fall.")],
      nextSpeaker: guide,
      directorGuidance: "Ask what happened next with re-entry.",
    },
    [Tool.SHORT_QUESTION],
  ],
  [
    "interjecting on a surprising detail",
    {
      kind: "interjection",
      allowedTools: INTERJECTION_TOOLS,
      recentSpeeches: [said("Ben", "They built the whole adaptor from plastic bags, cardboard and a flight manual cover — in under an hour.")],
      nextSpeaker: guide,
    },
    [Tool.INTERJECT, Tool.FILLER_COMMENT],
  ],
];

describe.skipIf(!process.env.TYPESAFE_API_KEY)("TypeSafe speaker tool choice (live)", () => {
  const provider = new TypeSafeJudgmentProvider({ timeoutMs: 15000 });

  it("pre-chooses a tool that fits the moment", async () => {
    const results = await Promise.all(
      cases.map(async ([name, request, acceptable]) => ({
        name,
        acceptable,
        decision: await chooseSpeakerToolWithTypeSafe(request, provider),
      }))
    );

    console.log(
      "tool choice results:",
      JSON.stringify(
        results.map(({ name, acceptable, decision }) => ({
          name,
          acceptable,
          got: decision.status === "ok" ? decision.value : decision.reason,
          confidence:
            decision.status === "ok" ? (decision.detail as { confidence: number }).confidence : undefined,
        }))
      )
    );
    for (const { acceptable, decision } of results) {
      expect(decision.status).toBe("ok");
      if (decision.status === "ok") expect(acceptable).toContain(decision.value);
    }
  }, 60000);
});
