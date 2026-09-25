import { describe, expect, it, vi } from "vitest";
import {
  extractCardRelations,
  extractCardRelationsWithTypeSafe,
} from "./TypeSafeCardRelationJudge";
import { IJudgmentProvider, JudgmentQuestions } from "../providers/judgment-questions";
import { JudgmentRunner } from "../services/JudgmentRunner";
import { IJudgmentLog, JudgmentRecord } from "../services/JudgmentLog";
import { parseJudgmentModes } from "../services/judgment-modes";
import { CardRelationType } from "../types";

const card = (id: string) => ({ id, content: `content ${id}`, significance: `why ${id}` });
const groups = [[card("a"), card("b")], [card("c"), card("d"), card("e")]];

function labelling(choices: string[]) {
  const judge = vi.fn(async (_state: unknown, questions: JudgmentQuestions) => ({
    status: "ok" as const,
    answers: Object.fromEntries(
      Object.keys(questions).map((id, index) => [
        id,
        { type: "choice", choice: choices[index], probabilities: {}, confidence: 0.8 },
      ])
    ),
  }));
  return { judge } as unknown as IJudgmentProvider & { judge: typeof judge };
}

describe("extractCardRelationsWithTypeSafe", () => {
  it("asks one Choice per group and turns related groups into edges", async () => {
    const provider = labelling([CardRelationType.Contrasts, "no_meaningful_connection"]);

    const decision = await extractCardRelationsWithTypeSafe(
      { candidateGroups: groups, current: async () => [] },
      provider
    );

    expect(decision).toMatchObject({
      status: "ok",
      value: [
        {
          cardIds: ["a", "b"],
          relationType: CardRelationType.Contrasts,
          rationale: expect.stringContaining("different directions"),
        },
      ],
    });
    const [state, questions] = provider.judge.mock.calls[0];
    expect((state as any).groups[1]).toHaveLength(3);
    expect(Object.keys(questions)).toEqual(["relation_within_group_0", "relation_within_group_1"]);
    expect(Object.keys((questions as any).relation_within_group_0.criteria)).toContain(
      "no_meaningful_connection"
    );
  });
});

describe("extractCardRelations", () => {
  it("shadow: agrees when each group gets the same relation or none", async () => {
    const records: JudgmentRecord[] = [];
    const log: IJudgmentLog = { append: async (r) => void records.push(r), readAll: async () => records };
    const runner = new JudgmentRunner(parseJudgmentModes("card-relations=shadow"), log);
    const llmEdges = [
      // The LLM may keep only a subset of a group; it still counts as that group's label.
      { cardIds: ["c", "d"], relationType: CardRelationType.Extends, rationale: "x" },
    ];

    const edges = await extractCardRelations(
      { candidateGroups: groups, current: async () => llmEdges },
      { runner, provider: labelling(["no_meaningful_connection", CardRelationType.Extends]) }
    );
    await extractCardRelations(
      { candidateGroups: groups, current: async () => llmEdges },
      { runner, provider: labelling([CardRelationType.Supports, CardRelationType.Extends]) }
    );

    expect(edges).toBe(llmEdges);
    expect(records.map((r) => r.agreed)).toEqual([true, false]);
  });
});
