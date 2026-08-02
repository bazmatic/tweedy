import { describe, expect, it } from "vitest";
import {
  DIRECTOR_DIRECTION_PROMPT_TEMPLATES,
  resolveDirectorDirectionPromptTemplate,
} from "./director-direction-prompt";

const vars = {
  orientationNote: "[orientation]",
  discourseNote: "[discourse]",
  fixedSpeakerNote: "[fixed-speaker]",
  pacingSection: "[pacing]",
};

describe("resolveDirectorDirectionPromptTemplate", () => {
  it("returns the default template when no variant id is given", () => {
    const template = resolveDirectorDirectionPromptTemplate(undefined);
    expect(template).toBe(DIRECTOR_DIRECTION_PROMPT_TEMPLATES.default);
  });

  it("returns a registered template by id", () => {
    DIRECTOR_DIRECTION_PROMPT_TEMPLATES["test-variant"] = () => "custom";
    const template = resolveDirectorDirectionPromptTemplate("test-variant");
    expect(template(vars)).toBe("custom");
    delete DIRECTOR_DIRECTION_PROMPT_TEMPLATES["test-variant"];
  });

  it("falls back to the default template for an unknown id", () => {
    const template = resolveDirectorDirectionPromptTemplate("does-not-exist");
    expect(template).toBe(DIRECTOR_DIRECTION_PROMPT_TEMPLATES.default);
  });

  it("interpolates every var into the default template", () => {
    const rendered = DIRECTOR_DIRECTION_PROMPT_TEMPLATES.default(vars);
    expect(rendered).toContain("[orientation][discourse][fixed-speaker]");
    expect(rendered).toContain("## Pacing & Rhythm[pacing]");
    expect(rendered).toContain("Decide which speaker should talk next.");
    expect(rendered).toContain("## Device Assignment");
  });
});
