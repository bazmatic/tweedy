import { describe, expect, it, vi } from "vitest";
import {
  DIRECTOR_DIRECTION_PROMPT_TEMPLATES,
  resolveDirectorDirectionPromptTemplate,
} from "./director-direction-prompt";
import { logger } from "../../utils/logger";

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

  it("logs a warning naming the unknown id and the registry when variantId is unrecognized", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    resolveDirectorDirectionPromptTemplate("does-not-exist");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0];
    expect(message).toContain("does-not-exist");
    expect(message).toContain("default");
    expect(message).toContain("concise");
    warnSpy.mockRestore();
  });

  it("stays silent when variantId is undefined (no override requested)", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    resolveDirectorDirectionPromptTemplate(undefined);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("resolves the concise variant and renders distinctly from default", () => {
    const template = resolveDirectorDirectionPromptTemplate("concise");
    expect(template).toBe(DIRECTOR_DIRECTION_PROMPT_TEMPLATES.concise);
    const rendered = template(vars);
    expect(rendered).not.toBe(DIRECTOR_DIRECTION_PROMPT_TEMPLATES.default(vars));
    expect(rendered).toContain("[orientation][discourse][fixed-speaker]");
    expect(rendered).toContain("## Pacing & Rhythm[pacing]");
    expect(rendered).toContain("Decide which speaker should talk next.");
  });
});
