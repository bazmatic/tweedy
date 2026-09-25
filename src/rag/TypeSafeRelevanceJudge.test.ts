import { describe, expect, it, vi } from "vitest";
import {
  rerankByRelevance,
  rerankByRelevanceWithTypeSafe,
} from "./TypeSafeRelevanceJudge";
import { IJudgmentProvider, JudgmentQuestions } from "../providers/judgment-questions";
import { JudgmentRunner } from "../services/JudgmentRunner";
import { IJudgmentLog, JudgmentRecord } from "../services/JudgmentLog";
import { parseJudgmentModes } from "../services/judgment-modes";
import { Document } from "../types";

const doc = (id: string, content = `content ${id}`) => ({ id, content, metadata: {} }) as Document;
const candidates = [doc("a"), doc("b"), doc("c"), doc("d")];

function relevance(values: number[]) {
  const judge = vi.fn(async (_state: unknown, questions: JudgmentQuestions) => ({
    status: "ok" as const,
    answers: Object.fromEntries(
      Object.keys(questions).map((id, index) => [id, { type: "score", score: values[index], confidence: 0.8 }])
    ),
  }));
  return { judge } as unknown as IJudgmentProvider & { judge: typeof judge };
}

const request = { query: "How did they fix the CO2?", candidates, limit: 2, current: async () => candidates.slice(0, 2) };

describe("rerankByRelevanceWithTypeSafe", () => {
  it("drops candidates below the floor and reranks the rest, up to the limit", async () => {
    const decision = await rerankByRelevanceWithTypeSafe(request, relevance([0.4, 2.9, 1.2, 2.1]), 1.5);

    expect(decision).toMatchObject({ status: "ok" });
    if (decision.status !== "ok") return;
    expect(decision.value.map((d) => d.id)).toEqual(["b", "d"]);
    expect(decision.detail).toEqual({ relevance: { a: 0.4, b: 2.9, c: 1.2, d: 2.1 } });
  });

  it("can return fewer than the limit when little is relevant", async () => {
    const decision = await rerankByRelevanceWithTypeSafe(request, relevance([0.2, 0.9, 1.0, 1.6]), 1.5);

    expect(decision.status === "ok" && decision.value.map((d) => d.id)).toEqual(["d"]);
  });

  it("judges an excerpt of long documents, with the query as state", async () => {
    const provider = relevance([3]);
    const long = doc("long", "x".repeat(5000));

    await rerankByRelevanceWithTypeSafe({ ...request, candidates: [long] }, provider, 1.5);

    const [state, questions] = provider.judge.mock.calls[0];
    expect((state as any).query).toBe("How did they fix the CO2?");
    expect((state as any).documents[0]).toHaveLength(2000);
    expect(Object.keys(questions)).toEqual(["relevance_of_document_0"]);
  });
});

describe("rerankByRelevance", () => {
  it("shadow: returns the similarity top-k and compares the returned set", async () => {
    const records: JudgmentRecord[] = [];
    const log: IJudgmentLog = { append: async (r) => void records.push(r), readAll: async () => records };
    const runner = new JudgmentRunner(parseJudgmentModes("rag-relevance=shadow"), log);

    const docs = await rerankByRelevance(request, { runner, provider: relevance([2.5, 2.9, 0, 0]) });

    expect(docs.map((d) => d.id)).toEqual(["a", "b"]);
    expect(records[0]).toMatchObject({ judgment: "rag-relevance", agreed: true });
  });
});
