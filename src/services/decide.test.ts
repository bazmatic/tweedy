import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { decide } from "./decide";
import { JsonlDecisionLog } from "./DecisionLog";
import { logger } from "../utils/logger";

describe("decide", () => {
  afterEach(() => {
    delete process.env.JUDGMENT_LOG_PATH;
    vi.restoreAllMocks();
  });

  it("returns the provider's value", async () => {
    expect(
      await decide({ judgment: "x", ask: async () => ({ status: "ok", value: 7 }), fallback: 0 })
    ).toBe(7);
  });

  it("returns the fallback and warns when the provider is unavailable", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const value = await decide({
      judgment: "coverage.point",
      ask: async () => ({ status: "unavailable", reason: "HTTP 529" }),
      fallback: [] as string[],
    });
    expect(value).toEqual([]);
    expect(warn.mock.calls[0][0]).toContain('"coverage.point"');
    expect(warn.mock.calls[0][0]).toContain("HTTP 529");
  });

  it("returns the fallback when the provider throws", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    expect(
      await decide({ judgment: "x", ask: async () => { throw new Error("boom"); }, fallback: "safe" })
    ).toBe("safe");
  });

  it("logs nothing unless JUDGMENT_LOG_PATH is set, then logs each decision", async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "decisions-"));
    const file = path.join(dir, "log.jsonl");
    await decide({ judgment: "a", ask: async () => ({ status: "ok", value: 1 }), fallback: 0 });
    expect(fs.existsSync(file)).toBe(false);

    process.env.JUDGMENT_LOG_PATH = file;
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    await decide({ judgment: "a", ask: async () => ({ status: "ok", value: 1, detail: { p: 0.9 } }), fallback: 0, state: { q: 1 } });
    await decide({ judgment: "b", ask: async () => ({ status: "unavailable", reason: "down" }), fallback: 0 });

    const records = await new JsonlDecisionLog(file).readAll();
    expect(records).toMatchObject([
      { judgment: "a", value: 1, detail: { p: 0.9 }, state: { q: 1 }, usedFallback: false },
      { judgment: "b", value: 0, usedFallback: true, fallbackReason: "down" },
    ]);
  });

  it("still returns the value when the log cannot be written", async () => {
    process.env.JUDGMENT_LOG_PATH = "/dev/null/cannot/write.jsonl";
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    expect(
      await decide({ judgment: "a", ask: async () => ({ status: "ok", value: 3 }), fallback: 0 })
    ).toBe(3);
  });
});
