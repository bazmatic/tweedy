import { describe, expect, it } from "vitest";
import {
  SPEAKER_SPEECH_PROMPT_TEMPLATES,
  resolveSpeakerSpeechPromptTemplate,
} from "./speaker-speech-prompt";

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
});
