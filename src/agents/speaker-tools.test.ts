import { describe, expect, it } from "vitest";
import {
  INTERJECTION_TOOLS,
  SHORT_REACTION_TOOLS,
  SpeakerAgentToolName,
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
});
