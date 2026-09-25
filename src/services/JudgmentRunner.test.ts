import { describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { JudgmentRunner, TypeSafeDecision } from "./JudgmentRunner";
import {
  IJudgmentLog,
  JsonlJudgmentLog,
  JudgmentRecord,
  summarizeAgreement,
} from "./JudgmentLog";
import { parseJudgmentModes, resolveJudgmentMode } from "./judgment-modes";

class MemoryLog implements IJudgmentLog {
  records: JudgmentRecord[] = [];
  async append(record: JudgmentRecord) {
    this.records.push(record);
  }
  async readAll() {
    return this.records;
  }
}

const ok = <T>(value: T): TypeSafeDecision<T> => ({ status: "ok", value });
const unavailable = { status: "unavailable", reason: "HTTP 529" } as const;

function setup(modes: string) {
  const log = new MemoryLog();
  const runner = new JudgmentRunner(parseJudgmentModes(modes), log);
  return { log, runner };
}

describe("parseJudgmentModes", () => {
  it("defaults every judgment to off when unset", () => {
    expect(resolveJudgmentMode(parseJudgmentModes(undefined), "coverage")).toBe("off");
    expect(resolveJudgmentMode(parseJudgmentModes(""), "coverage")).toBe("off");
  });

  it("parses name=mode pairs and a wildcard default", () => {
    const modes = parseJudgmentModes(" coverage=on , *=shadow ");
    expect(resolveJudgmentMode(modes, "coverage")).toBe("on");
    expect(resolveJudgmentMode(modes, "anything-else")).toBe("shadow");
  });

  it("lets dotted judgments inherit from their prefix unless named", () => {
    const modes = parseJudgmentModes("coverage=shadow,coverage.point=on");
    expect(resolveJudgmentMode(modes, "coverage.point")).toBe("on");
    expect(resolveJudgmentMode(modes, "coverage.discourse")).toBe("shadow");
    expect(resolveJudgmentMode(modes, "coverageish")).toBe("off");
  });

  it("rejects malformed entries and unknown modes", () => {
    expect(() => parseJudgmentModes("coverage")).toThrow(/expected name=mode/);
    expect(() => parseJudgmentModes("coverage=maybe")).toThrow(/off, shadow or on/);
  });
});

describe("JudgmentRunner", () => {
  it("off: runs only the current path and logs nothing", async () => {
    const { log, runner } = setup("");
    const typesafe = vi.fn();

    const result = await runner.run({
      judgment: "coverage",
      current: async () => "current",
      typesafe,
    });

    expect(result).toBe("current");
    expect(typesafe).not.toHaveBeenCalled();
    expect(log.records).toEqual([]);
  });

  it("shadow: acts on current and logs both with agreement", async () => {
    const { log, runner } = setup("coverage=shadow");

    const result = await runner.run({
      judgment: "coverage",
      current: async () => ["p1", "p2"],
      typesafe: async () => ok(["p1"]),
      state: { pointIds: ["p1", "p2"] },
    });

    expect(result).toEqual(["p1", "p2"]);
    expect(log.records).toHaveLength(1);
    expect(log.records[0]).toMatchObject({
      judgment: "coverage",
      mode: "shadow",
      current: ["p1", "p2"],
      typesafe: ["p1"],
      agreed: false,
      actedOn: "current",
      state: { pointIds: ["p1", "p2"] },
    });
  });

  it("shadow: uses a custom agreement function", async () => {
    const { log, runner } = setup("coverage=shadow");

    await runner.run({
      judgment: "coverage",
      current: async () => ["b", "a"],
      typesafe: async () => ok(["a", "b"]),
      agrees: (x, y) => [...x].sort().join() === [...y].sort().join(),
    });

    expect(log.records[0].agreed).toBe(true);
  });

  it("shadow: TypeSafe failures and throws never change the acted-on decision", async () => {
    const { log, runner } = setup("*=shadow");

    const fromUnavailable = await runner.run({
      judgment: "a",
      current: async () => 1,
      typesafe: async () => unavailable,
    });
    const fromThrow = await runner.run({
      judgment: "b",
      current: async () => 2,
      typesafe: async () => {
        throw new Error("boom");
      },
    });

    expect(fromUnavailable).toBe(1);
    expect(fromThrow).toBe(2);
    expect(log.records.map((r) => r.typesafeUnavailableReason)).toEqual([
      "HTTP 529",
      "boom",
    ]);
    expect(log.records.every((r) => r.agreed === undefined)).toBe(true);
  });

  it("shadow: a failing log does not fail the decision", async () => {
    const runner = new JudgmentRunner(parseJudgmentModes("*=shadow"), {
      append: async () => {
        throw new Error("disk full");
      },
      readAll: async () => [],
    });

    await expect(
      runner.run({
        judgment: "a",
        current: async () => "current",
        typesafe: async () => ok("typesafe"),
      })
    ).resolves.toBe("current");
  });

  it("shadow: propagates errors from the current path", async () => {
    const { runner } = setup("*=shadow");

    await expect(
      runner.run({
        judgment: "a",
        current: async () => {
          throw new Error("llm failed");
        },
        typesafe: async () => ok("typesafe"),
      })
    ).rejects.toThrow("llm failed");
  });

  it("on: acts on TypeSafe without running the current path", async () => {
    const { log, runner } = setup("coverage=on");
    const current = vi.fn(async () => "current");

    const result = await runner.run({
      judgment: "coverage",
      current,
      typesafe: async () => ok("typesafe"),
    });

    expect(result).toBe("typesafe");
    expect(current).not.toHaveBeenCalled();
    expect(log.records[0]).toMatchObject({
      mode: "on",
      typesafe: "typesafe",
      actedOn: "typesafe",
    });
  });

  it("on: falls back to the current path when TypeSafe is unavailable", async () => {
    const { log, runner } = setup("coverage=on");

    const result = await runner.run({
      judgment: "coverage",
      current: async () => "current",
      typesafe: async () => unavailable,
    });

    expect(result).toBe("current");
    expect(log.records[0]).toMatchObject({
      mode: "on",
      actedOn: "current",
      typesafeUnavailableReason: "HTTP 529",
    });
  });
});

describe("JsonlJudgmentLog and summarizeAgreement", () => {
  it("round-trips records and summarises agreement per judgment", async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "judgments-"));
    const log = new JsonlJudgmentLog(path.join(dir, "nested", "log.jsonl"));
    expect(await log.readAll()).toEqual([]);

    const base = { mode: "shadow", timestamp: "t", actedOn: "current" } as const;
    await log.append({ ...base, judgment: "coverage", agreed: true });
    await log.append({ ...base, judgment: "coverage", agreed: false });
    await log.append({ ...base, judgment: "coverage", typesafeUnavailableReason: "x" });
    await log.append({ ...base, judgment: "complete", agreed: true });

    const summaries = summarizeAgreement(await log.readAll());

    expect(summaries).toEqual([
      {
        judgment: "complete",
        total: 1,
        compared: 1,
        agreed: 1,
        disagreed: 0,
        unavailable: 0,
        agreementRate: 1,
      },
      {
        judgment: "coverage",
        total: 3,
        compared: 2,
        agreed: 1,
        disagreed: 1,
        unavailable: 1,
        agreementRate: 0.5,
      },
    ]);
  });
});
