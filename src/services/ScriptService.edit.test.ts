import { describe, expect, it, vi } from "vitest";
import { SpeakerAgentToolName } from "../agents/speaker-tools";
import { ScriptEditTurnAction } from "../types";
import { ScriptService } from "./ScriptService";
import { makeScriptFixture } from "./__tests__/fixtures";

function makeScript() {
  const script = makeScriptFixture({
    messages: ["Original one.", "Original two."],
  });
  script.speeches[0].instructions = "warmly";
  script.speeches[1].instructions = "naturally";
  script.speeches[1].tool = SpeakerAgentToolName.SHORT_QUESTION;
  return script;
}

describe("ScriptService editable imports", () => {
  it("applies copy-on-write turns and commits their order through the script", async () => {
    const script = makeScript();
    const update = vi.fn().mockResolvedValue({ id: script.id });
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: "replacement-1" })
      .mockResolvedValueOnce({ id: "addition-1" });
    const removeCreatedSpeech = vi.fn();
    const service = new ScriptService(
      { update } as any,
      {} as any,
      {} as any,
      {} as any,
      { create, delete: removeCreatedSpeech } as any,
      {} as any
    );
    vi.spyOn(service, "getScript").mockResolvedValue(script);

    const result = await service.applyEditedScriptImport({
      scriptId: script.id,
      expectedRevision: script.updatedAt.toISOString(),
      summary: {
        added: 1,
        removed: 0,
        edited: 1,
        unchanged: 1,
        reordered: true,
      },
      turns: [
        {
          sourceId: "speech-2",
          speakerSlug: "ada",
          message: "Edited two.",
          mode: SpeakerAgentToolName.SPEAK,
          action: ScriptEditTurnAction.Replace,
        },
        {
          sourceId: "speech-1",
          speakerSlug: "ada",
          message: "Original one.",
          mode: SpeakerAgentToolName.SPEAK,
          action: ScriptEditTurnAction.Reuse,
        },
        {
          speakerSlug: "ada",
          message: "Added.",
          mode: SpeakerAgentToolName.SPEAK,
          action: ScriptEditTurnAction.Add,
        },
      ],
    });

    expect(result.edited).toBe(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        message: "Edited two.",
        instructions: "naturally",
        tool: SpeakerAgentToolName.SPEAK,
      })
    );
    expect(update).toHaveBeenCalledWith(
      script.id,
      expect.objectContaining({
        speechIds: ["replacement-1", "speech-1", "addition-1"],
        knowledgeLedger: { introducedCards: [] },
        terminologyLedger: { explainedTerms: [] },
      })
    );
    expect(removeCreatedSpeech).not.toHaveBeenCalled();
  });
});
