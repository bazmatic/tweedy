import { describe, expect, it, vi } from "vitest";
import {
  auditEpisodeTurns,
  auditEpisodeTurnsWithTypeSafe,
} from "./TypeSafeEpisodeAuditJudge";
import { IJudgmentProvider, JudgmentQuestions } from "../providers/judgment-questions";
import { JudgmentRunner } from "../services/JudgmentRunner";
import { IJudgmentLog, JudgmentRecord } from "../services/JudgmentLog";
import { parseJudgmentModes } from "../services/judgment-modes";
import { Speech } from "../types";

const said = (id: string, message: string) =>
  ({ id, speaker: { name: id.startsWith("a") ? "Ada" : "Ben" }, message }) as unknown as Speech;

const speeches = [said("a1", "Welcome."), said("b1", "Hi."), said("a2", "And that saved them."), said("b2", "Goodbye.")];

/** Answers turn i's Choice with choices[i] (default no_local_defect) at probability p[i] (default 0.9). */
function defects(choices: Record<number, string>, p: Record<number, number> = {}) {
  const judge = vi.fn(async (_state: unknown, questions: JudgmentQuestions) => ({
    status: "ok" as const,
    answers: Object.fromEntries(
      Object.keys(questions).map((id) => {
        const index = Number(id.split("_").at(-1));
        const option = choices[index] ?? "no_local_defect";
        const probability = p[index] ?? 0.9;
        return [id, { type: "choice", choice: option, probabilities: { [option]: probability }, confidence: probability }];
      })
    ),
  }));
  return { judge } as unknown as IJudgmentProvider & { judge: typeof judge };
}

const request = { speeches, maxIssues: 3, current: async () => [] };

describe("auditEpisodeTurnsWithTypeSafe", () => {
  it("asks one Choice per turn, with the closing option only on the final turn", async () => {
    const provider = defects({});

    await auditEpisodeTurnsWithTypeSafe(request, provider, 0.5);

    const [state, questions] = provider.judge.mock.calls[0];
    expect((state as any).transcript[2]).toEqual({ speaker: "Ada", text: "And that saved them." });
    expect(Object.keys(questions)).toEqual([
      "most_serious_defect_in_turn_0",
      "most_serious_defect_in_turn_1",
      "most_serious_defect_in_turn_2",
      "most_serious_defect_in_turn_3",
    ]);
    const options = (index: number) => Object.keys((questions as any)[`most_serious_defect_in_turn_${index}`].criteria);
    expect(options(0)).not.toContain("closing_misstates_the_episode");
    expect(options(3)).toContain("closing_misstates_the_episode");
    expect(options(0)).toContain("no_local_defect");
  });

  it("maps flagged turns to audit issues, most confident first, capped", async () => {
    const decision = await auditEpisodeTurnsWithTypeSafe(
      { ...request, maxIssues: 2 },
      defects(
        { 1: "repeats_earlier_content", 2: "consequence_before_its_setup", 3: "closing_misstates_the_episode" },
        { 1: 0.6, 2: 0.95, 3: 0.8 }
      ),
      0.5
    );

    expect(decision).toMatchObject({
      status: "ok",
      value: [
        { speechId: "a2", category: "dependency_order", reason: "States a consequence before its setup" },
        { speechId: "b2", category: "closing_accuracy" },
      ],
    });
  });

  it("ignores defects below the threshold", async () => {
    const decision = await auditEpisodeTurnsWithTypeSafe(
      request,
      defects({ 2: "repeats_earlier_content" }, { 2: 0.4 }),
      0.5
    );

    expect(decision).toMatchObject({ status: "ok", value: [] });
  });
});

describe("auditEpisodeTurns", () => {
  it("shadow: acts on the LLM audit and compares which turns were flagged", async () => {
    const records: JudgmentRecord[] = [];
    const log: IJudgmentLog = { append: async (r) => void records.push(r), readAll: async () => records };
    const runner = new JudgmentRunner(parseJudgmentModes("episode-audit=shadow"), log);
    const llmIssues = [{ speechId: "a2", category: "continuity" as const, reason: "x" }];

    const issues = await auditEpisodeTurns(
      { ...request, current: async () => llmIssues },
      { runner, provider: defects({ 2: "consequence_before_its_setup" }) }
    );

    expect(issues).toBe(llmIssues);
    expect(records[0]).toMatchObject({ judgment: "episode-audit", agreed: true });
  });
});
