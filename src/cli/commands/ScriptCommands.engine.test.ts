import { describe, expect, it, vi } from "vitest";
import { createScriptCommands } from "./ScriptCommands";
import { AudienceProfile } from "../../types";
import { appConfig } from "../../utils/config";

describe("script generate engine selection", () => {
  it.each(["legacy", "mastra"] as const)(
    "passes an explicit %s selection to ScriptService",
    async (engine) => {
      const generateScript = vi.fn().mockResolvedValue({
        id: "script-14",
        title: "Selected engine",
        speakers: [],
        speeches: [],
        materials: [],
        audienceProfile: AudienceProfile.General,
      });
      const service = { generateScript } as any;
      const command = createScriptCommands(service);
      command.exitOverride();

      await command.parseAsync(
        [
          "generate",
          "--title",
          "Selected engine",
          "--speakers",
          "speaker-1",
          "--engine",
          engine,
        ],
        { from: "user" }
      );

      expect(generateScript).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Selected engine" }),
        { engine }
      );
    }
  );

  it("uses the configured Mastra default when --engine is omitted", async () => {
    const generateScript = vi.fn().mockResolvedValue({
      id: "script-15",
      title: "Default engine",
      speakers: [],
      speeches: [],
      materials: [],
      audienceProfile: AudienceProfile.General,
    });
    const command = createScriptCommands({ generateScript } as any);
    command.exitOverride();

    await command.parseAsync(
      [
        "generate",
        "--title",
        "Default engine",
        "--speakers",
        "speaker-1",
      ],
      { from: "user" }
    );

    expect(appConfig.conversationWorkflowEngine).toBe("mastra");
    expect(generateScript).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Default engine" }),
      { engine: "mastra" }
    );
  });
});
