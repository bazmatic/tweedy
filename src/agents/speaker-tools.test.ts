import { describe, expect, it } from "vitest";
import {
  INTERJECTION_TOOLS,
  SHORT_REACTION_TOOLS,
  SpeakerAgentToolName,
  SPEAKER_TOOL_DEFINITIONS,
  getToolDefinition,
  getToolMaxTokens,
  toLlmTools,
} from "./speaker-tools";

describe("speaker-tools", () => {
  it("includes CHALLENGE with the shared {message, style} schema when no filter is given", () => {
    const tools = toLlmTools();
    const challenge = tools.find(
      (tool) => tool.name === SpeakerAgentToolName.CHALLENGE
    );

    expect(challenge).toBeDefined();
    expect(challenge?.input_schema.type).toBe("object");
    expect(challenge?.input_schema.required).toEqual(["message", "style"]);
    expect(challenge?.input_schema.properties.message).toEqual({
      type: "string",
      description: "The spoken text to deliver.",
    });
    const style = challenge?.input_schema.properties.style as {
      type: string;
      description: string;
    };
    expect(style.type).toBe("string");
    expect(typeof style.description).toBe("string");
  });

  it("INTERJECTION_TOOLS resolves to INTERJECT, FILLER_COMMENT, CHALLENGE in order", () => {
    const tools = toLlmTools(INTERJECTION_TOOLS);

    expect(tools.map((tool) => tool.name)).toEqual([
      SpeakerAgentToolName.INTERJECT,
      SpeakerAgentToolName.FILLER_COMMENT,
      SpeakerAgentToolName.CHALLENGE,
    ]);
  });

  it("does not include CHALLENGE in SHORT_REACTION_TOOLS", () => {
    expect(SHORT_REACTION_TOOLS).not.toContain(SpeakerAgentToolName.CHALLENGE);
  });

  it("includes SUMMARIZE with the shared {message, style} schema", () => {
    const tools = toLlmTools();
    const summarize = tools.find(
      (tool) => tool.name === SpeakerAgentToolName.SUMMARIZE
    );

    expect(summarize).toBeDefined();
    expect(summarize?.input_schema.required).toEqual(["message", "style"]);
  });
});

describe("COLD_OPEN tool", () => {
  it("is defined with a sane token cap", () => {
    const definition = SPEAKER_TOOL_DEFINITIONS.find(
      (def) => def.name === SpeakerAgentToolName.COLD_OPEN
    );

    expect(definition).toBeDefined();
    expect(definition?.maxTokens).toBe(100);
    expect(getToolMaxTokens(SpeakerAgentToolName.COLD_OPEN)).toBe(100);
  });
});

describe("EXPLAIN tool", () => {
  it("defines explain with a 500 token budget", () => {
    expect(getToolMaxTokens(SpeakerAgentToolName.EXPLAIN)).toBe(500);
  });

  it("describes explain as multi-sentence expository", () => {
    const def = getToolDefinition(SpeakerAgentToolName.EXPLAIN);
    expect(def?.toolDescription).toMatch(/3-6 sentences/);
  });
});

describe("CHALLENGE tool", () => {
  it("gives CHALLENGE room for a substantive objection", () => {
    expect(getToolMaxTokens(SpeakerAgentToolName.CHALLENGE)).toBe(200);
    const def = getToolDefinition(SpeakerAgentToolName.CHALLENGE);
    expect(def?.toolDescription).toMatch(/2-3 sentences/);
  });
});
