import { beforeEach, describe, expect, it, vi } from "vitest";
import { Speech } from "../types";
import { setJudgmentProvider } from "../services/judgment-runtime";
import {
  ConversationalObligation,
  ResponseModeContext,
  ResponseModePolicy,
} from "./ResponseModePolicy";
import { SpeakerAgentToolName } from "./speaker-tools";

const judgeMock = vi.fn();

const ada = { id: "ada", name: "Ada", personality: "curious host" } as any;
const ben = { id: "ben", name: "Ben", personality: "space historian" } as any;
const said = (speaker: any, message: string, tool?: SpeakerAgentToolName) =>
  ({ speaker, message, tool }) as unknown as Speech;

const context = (speeches: Speech[], overrides: Partial<ResponseModeContext> = {}) => ({
  speaker: ben,
  speeches,
  isSolo: false,
  isFinalTurn: false,
  forceNearlyOutOfTime: false,
  requestSummary: false,
  ...overrides,
});

function typesafeChooses(option: string) {
  judgeMock.mockResolvedValueOnce({
    status: "ok",
    answers: {
      reply_owed_to_previous_turn: {
        type: "choice",
        choice: option,
        probabilities: {},
        confidence: 0.9,
      },
    },
  });
}

describe("ResponseModePolicy.resolveObligation", () => {
  const policy = new ResponseModePolicy();
  beforeEach(() => {
    judgeMock.mockReset();
    setJudgmentProvider({ judge: judgeMock });
  });

  it("treats an unpunctuated request as a question to answer", async () => {
    typesafeChooses("answer_the_question_just_asked");

    const obligation = await policy.resolveObligation(
      context([said(ada, "Tell me how they kept breathing after that")])
    );

    expect(obligation).toBe(ConversationalObligation.AnswerQuestion);
  });

  it("treats a rhetorical question as no pending obligation", async () => {
    typesafeChooses("no_pending_obligation");

    const obligation = await policy.resolveObligation(
      context([said(ada, "Isn't that incredible? Duct tape saved three lives.")])
    );

    expect(obligation).toBe(ConversationalObligation.ExecuteBrief);
  });

  it("keeps the tool-label protocol deterministic without asking TypeSafe", async () => {
    const afterTease = await policy.resolveObligation(
      context([said(ada, "And that's where it gets strange.", SpeakerAgentToolName.TEASE)])
    );
    const afterChallenge = await policy.resolveObligation(
      context([said(ada, "I don't buy it.", SpeakerAgentToolName.CHALLENGE)])
    );

    expect(afterTease).toBe(ConversationalObligation.InviteContinuation);
    expect(afterChallenge).toBe(ConversationalObligation.AnswerChallenge);
    expect(judgeMock).not.toHaveBeenCalled();
  });

  it("does not ask for the first turn or turns that ignore obligations", async () => {
    expect(await policy.resolveObligation(context([]))).toBe(
      ConversationalObligation.ExecuteBrief
    );
    const previous = [said(ada, "What happened next?")];
    for (const overrides of [
      { isSolo: true },
      { isFinalTurn: true },
      { forceNearlyOutOfTime: true },
      { forceColdOpen: true },
    ]) {
      expect(await policy.resolveObligation(context(previous, overrides))).toBeUndefined();
    }
    expect(judgeMock).not.toHaveBeenCalled();
  });

  it("selectTools uses a resolved obligation over the synchronous default", () => {
    const speeches = [said(ada, "Isn't that incredible? Duct tape saved three lives.")];

    const byRule = policy.selectTools(context(speeches));
    const byJudgment = policy.selectTools(
      context(speeches, { obligation: ConversationalObligation.AnswerChallenge })
    );

    expect(byJudgment).toEqual([SpeakerAgentToolName.SPEAK, SpeakerAgentToolName.CHALLENGE]);
    expect(byJudgment).not.toEqual(byRule);
  });
});
