import { describe, expect, it, vi } from "vitest";
import { filterResearch, filterResearchWithTypeSafe } from "./TypeSafeResearchFilter";
import { IJudgmentProvider, JudgmentQuestions } from "../providers/judgment-questions";
import { JudgmentRunner } from "./JudgmentRunner";
import { IJudgmentLog, JudgmentRecord } from "./JudgmentLog";
import { parseJudgmentModes } from "./judgment-modes";
import { PodcastMaterial, ResearchMaterial, SourceType } from "../types";

const result = (title: string): ResearchMaterial => ({
  title,
  content: `content of ${title}`,
  source: "perplexity",
  sourceType: SourceType.Research,
  metadata: { citations: [`https://example.com/${title}`] },
});

/** Named questions get the given probability; others default to "passes the check". */
function answering(probabilities: Record<string, number>) {
  const judge = vi.fn(async (_state: unknown, questions: JudgmentQuestions) => ({
    status: "ok" as const,
    answers: Object.fromEntries(
      Object.keys(questions).map((id) => [
        id,
        {
          type: "noul",
          probability: probabilities[id] ?? (id.endsWith("repeats_existing_material") ? 0.05 : 0.95),
        },
      ])
    ),
  }));
  return { judge } as unknown as IJudgmentProvider & { judge: typeof judge };
}

const existing = [{ title: "Old", content: "old content" } as PodcastMaterial];
const request = {
  query: "Apollo 13 CO2 fix",
  results: [result("a"), result("b"), result("c"), result("d")],
  loadExistingMaterials: async () => existing,
};

describe("filterResearchWithTypeSafe", () => {
  it("rejects results that fail any check, with a reason per check", async () => {
    const decision = await filterResearchWithTypeSafe(
      request,
      answering({
        result_1_addresses_the_query: 0.1,
        result_2_is_grounded_in_its_sources: 0.2,
        result_3_repeats_existing_material: 0.9,
      }),
      0.5
    );

    expect(decision).toMatchObject({
      status: "ok",
      value: [
        { title: "b", reason: "does not address the research query" },
        { title: "c", reason: "not grounded in its cited sources" },
        { title: "d", reason: "mostly repeats existing material" },
      ],
    });
  });

  it("reports every failing reason, most decisive first", async () => {
    const decision = await filterResearchWithTypeSafe(
      { ...request, results: [result("a")] },
      answering({
        result_0_addresses_the_query: 0.3,
        result_0_is_grounded_in_its_sources: 0.02,
      }),
      0.5
    );

    expect(decision).toMatchObject({
      value: [
        {
          title: "a",
          reason: "not grounded in its cited sources; does not address the research query",
        },
      ],
    });
  });

  it("sends results with their citations, and skips the duplicate check with no existing material", async () => {
    const provider = answering({});

    await filterResearchWithTypeSafe(
      { ...request, results: [result("a")], loadExistingMaterials: async () => [] },
      provider,
      0.5
    );

    const [state, questions] = provider.judge.mock.calls[0];
    expect((state as any).results[0].citations).toEqual(["https://example.com/a"]);
    expect(Object.keys(questions)).toEqual([
      "result_0_addresses_the_query",
      "result_0_is_grounded_in_its_sources",
    ]);
  });
});

describe("filterResearch", () => {
  it("off by default: rejects nothing and never loads existing materials", async () => {
    const load = vi.fn(async () => existing);

    const rejected = await filterResearch({ ...request, loadExistingMaterials: load });

    expect(rejected).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it("shadow: keeps everything and logs what TypeSafe would reject", async () => {
    const records: JudgmentRecord[] = [];
    const log: IJudgmentLog = { append: async (r) => void records.push(r), readAll: async () => records };
    const runner = new JudgmentRunner(parseJudgmentModes("research-filter=shadow"), log);

    const rejected = await filterResearch(request, {
      runner,
      provider: answering({ result_0_addresses_the_query: 0.1 }),
    });

    expect(rejected).toEqual([]);
    expect(records[0]).toMatchObject({
      judgment: "research-filter",
      agreed: false,
      typesafe: [{ title: "a", reason: "does not address the research query" }],
    });
  });
});
