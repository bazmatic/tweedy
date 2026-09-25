import { describe, expect, it, vi } from "vitest";
import {
  chooseSpeakerToolWithTypeSafe,
  predictSpeakerTool,
  ToolChoiceRequest,
} from "./TypeSafeToolChoiceJudge";
import { SpeakerAgentToolName } from "./speaker-tools";
import { IJudgmentProvider } from "../providers/judgment-questions";
import { JudgmentRunner } from "../services/JudgmentRunner";
import { IJudgmentLog, JudgmentRecord } from "../services/JudgmentLog";
import { parseJudgmentModes } from "../services/judgment-modes";
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

function memoryRunner(modes: string) {
  const records: JudgmentRecord[] = [];
  const log: IJudgmentLog = {
    append: async (r) => void records.push(r),
    readAll: async () => records,
  };
  return { records, runner: new JudgmentRunner(parseJudgmentModes(modes), log) };
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

describe("predictSpeakerTool", () => {
  it("does not ask when only one tool is allowed", async () => {
    const { runner, records } = memoryRunner("*=on");
    const provider = choosing("make_one_short_point");

    const prediction = await predictSpeakerTool(
      { ...request, allowedTools: [SpeakerAgentToolName.SPEAK] },
      { runner, provider }
    );
    await prediction.settle(SpeakerAgentToolName.SPEAK);

    expect(prediction.actOn).toBeUndefined();
    expect(provider.judge).not.toHaveBeenCalled();
    expect(records).toEqual([]);
  });

  it("shadow: logs agreement against the tool the model picked, per kind", async () => {
    const { runner, records } = memoryRunner("speaker-tool=shadow");

    const prediction = await predictSpeakerTool(request, {
      runner,
      provider: choosing("land_one_sharp_sentence"),
    });
    await prediction.settle(SpeakerAgentToolName.ONE_LINER);

    expect(prediction.actOn).toBeUndefined();
    expect(records[0]).toMatchObject({
      judgment: "speaker-tool.turn",
      current: SpeakerAgentToolName.ONE_LINER,
      typesafe: SpeakerAgentToolName.ONE_LINER,
      agreed: true,
    });
  });

  it("on: returns the tool to force generation to", async () => {
    const { runner } = memoryRunner("speaker-tool.interjection=on");

    const prediction = await predictSpeakerTool(
      { ...request, kind: "interjection" },
      { runner, provider: choosing("push_back_with_an_objection") }
    );

    expect(prediction.actOn).toBe(SpeakerAgentToolName.CHALLENGE);
  });
});
