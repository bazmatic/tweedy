import { describe, expect, it, vi } from "vitest";
import {
  chooseSpeakerTool,
  chooseSpeakerToolWithTypeSafe,
  ToolChoiceRequest,
} from "./TypeSafeToolChoiceJudge";
import { SpeakerAgentToolName } from "./speaker-tools";
import { IJudgmentProvider } from "../providers/judgment-questions";
import { setJudgmentProvider } from "../services/judgment-runtime";
import { unavailableProvider } from "../test-support/judgments";
import { Speech } from "../types";

const said = (name: string, message: string) =>
  ({ speaker: { id: name, name }, message }) as unknown as Speech;

function choosing(option: string) {
  const judge = vi.fn(async () => ({
    status: "ok" as const,
    answers: {
      kind_of_turn_to_take: {
        type: "choice" as const,
        choice: option,
        probabilities: { [option]: 0.9 },
        confidence: 0.8,
      },
    },
  }));
  return { judge } as unknown as IJudgmentProvider & { judge: typeof judge };
}

const request: ToolChoiceRequest = {
  kind: "turn",
  allowedTools: [
    SpeakerAgentToolName.SPEAK,
    SpeakerAgentToolName.ONE_LINER,
    SpeakerAgentToolName.CHALLENGE,
  ],
  recentSpeeches: [said("Ada", "So the fix was literally duct tape?")],
  nextSpeaker: { name: "Ben", personality: "space historian", epistemicRole: "expert" },
  directorGuidance: "Explain how the adaptor worked.",
  turnGoal: "Explain the CO2 fix.",
};

describe("chooseSpeakerToolWithTypeSafe", () => {
  it("offers only the allowed tools, under descriptive option names", async () => {
    const provider = choosing("make_one_short_point");

    await chooseSpeakerToolWithTypeSafe(request, provider);

    const [state, questions] = provider.judge.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, { type: string; criteria: Record<string, string> }>,
    ];
    expect(Object.keys(questions.kind_of_turn_to_take.criteria)).toEqual([
      "make_one_short_point",
      "land_one_sharp_sentence",
      "push_back_with_an_objection",
    ]);
    expect(state).toEqual({
      recent_conversation: ["Ada: So the fix was literally duct tape?"],
      next_speaker: { name: "Ben", personality: "space historian", epistemic_role: "expert" },
      director_guidance: "Explain how the adaptor worked.",
      turn_goal: "Explain the CO2 fix.",
    });
  });

  it("maps the chosen option back to its tool", async () => {
    const decision = await chooseSpeakerToolWithTypeSafe(
      request,
      choosing("push_back_with_an_objection")
    );

    expect(decision).toMatchObject({
      status: "ok",
      value: SpeakerAgentToolName.CHALLENGE,
      detail: { option: "push_back_with_an_objection", confidence: 0.8 },
    });
  });

  it("is unavailable if the chosen option is not an allowed tool", async () => {
    const decision = await chooseSpeakerToolWithTypeSafe(
      request,
      choosing("recap_several_points")
    );

    expect(decision.status).toBe("unavailable");
  });
});

describe("chooseSpeakerTool", () => {
  it("narrows to the chosen tool", async () => {
    setJudgmentProvider(choosing("push_back_with_an_objection"));
    expect(await chooseSpeakerTool(request)).toEqual([SpeakerAgentToolName.CHALLENGE]);
  });

  it("offers the full allowed set when the provider is unavailable", async () => {
    setJudgmentProvider(unavailableProvider());
    expect(await chooseSpeakerTool(request)).toEqual(request.allowedTools);
  });

  it("does not ask when only one tool is allowed", async () => {
    const provider = choosing("make_one_short_point");
    setJudgmentProvider(provider);
    expect(
      await chooseSpeakerTool({ ...request, allowedTools: [SpeakerAgentToolName.SPEAK] })
    ).toEqual([SpeakerAgentToolName.SPEAK]);
    expect(provider.judge).not.toHaveBeenCalled();
  });
});
