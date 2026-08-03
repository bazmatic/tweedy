import { describe, expect, it, vi } from "vitest";
import {
  SPEAKER_SPEECH_PROMPT_TEMPLATES,
  resolveSpeakerSpeechPromptTemplate,
} from "./speaker-speech-prompt";
import { logger } from "../../utils/logger";

const vars = {
  speakerName: "Alex",
  personality: "curious",
  voiceStyle: "warm",
  epistemicRole: "informed_host",
  sourceAccess: "prepared_cards",
  uncertaintyStyle: "exploratory",
  audienceProfile: "general",
  mannerismsLine: "",
  coHostsLine: "",
  title: "The Episode",
  recapSection: "",
  rulesAndMaterialsSection: "[rules]",
  guidanceSection: "[guidance]",
  closingPromptAddendum: "",
};

describe("resolveSpeakerSpeechPromptTemplate", () => {
  it("returns the default template when no variant id is given", () => {
    expect(resolveSpeakerSpeechPromptTemplate(undefined)).toBe(
      SPEAKER_SPEECH_PROMPT_TEMPLATES.default
    );
  });

  it("falls back to the default template for an unknown id", () => {
    expect(resolveSpeakerSpeechPromptTemplate("does-not-exist")).toBe(
      SPEAKER_SPEECH_PROMPT_TEMPLATES.default
    );
  });

  it("interpolates every var into the default template", () => {
    const rendered = SPEAKER_SPEECH_PROMPT_TEMPLATES.default(vars);
    expect(rendered).toContain("You are Alex, a podcast speaker");
    expect(rendered).toContain("[rules]");
    expect(rendered).toContain("[guidance]");
    expect(rendered).toContain("Respond naturally as Alex.");
  });

  it("logs a warning naming the unknown id and the registry when variantId is unrecognized", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    resolveSpeakerSpeechPromptTemplate("does-not-exist");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0];
    expect(message).toContain("does-not-exist");
    expect(message).toContain("default");
    expect(message).toContain("concise");
    warnSpy.mockRestore();
  });

  it("stays silent when variantId is undefined (no override requested)", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    resolveSpeakerSpeechPromptTemplate(undefined);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("resolves the concise variant and renders distinctly from default", () => {
    const template = resolveSpeakerSpeechPromptTemplate("concise");
    expect(template).toBe(SPEAKER_SPEECH_PROMPT_TEMPLATES.concise);
    const rendered = template(vars);
    expect(rendered).not.toBe(SPEAKER_SPEECH_PROMPT_TEMPLATES.default(vars));
    expect(rendered).toContain("Alex");
    expect(rendered).toContain("[rules]");
    expect(rendered).toContain("[guidance]");
  });
});
