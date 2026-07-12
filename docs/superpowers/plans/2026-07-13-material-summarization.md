# Per-Material Podcast Summarization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw material content fed into `DirectorAgent.createPodcastPlan`'s prompt with per-material, podcast-oriented summaries produced by a new `MaterialSummarizerAgent`.

**Architecture:** A new `MaterialSummarizerAgent` (extends `BaseAgent`) summarizes one `PodcastMaterial` at a time via a plain (non-tool-call) model completion, falling back to a truncated content slice on model failure. `DirectorAgent.createPodcastPlan` runs all materials through it concurrently with `Promise.all` before building its plan prompt, replacing the current `title: content` join with `title: summary`.

**Tech Stack:** TypeScript, vitest, LangChain (via existing `BaseAgent.callModel`), no new dependencies.

## Global Constraints

- No persistence/caching of summaries — regenerate fresh on every `createPodcastPlan` call (per spec's Non-goals section).
- No changes to `SpeakerAgent.getRelevantMaterials` or the RAG material-selection path — out of scope.
- No new constructor parameters on `DirectorAgent`'s existing call site in `ScriptService` — `MaterialSummarizerAgent` is instantiated internally by `DirectorAgent`.
- Summary length: aim for 2-3 short paragraphs, budget 300 tokens.

---

### Task 1: `MaterialSummarizerAgent`

**Files:**
- Create: `src/agents/MaterialSummarizerAgent.ts`
- Create: `src/agents/MaterialSummarizerAgent.test.ts`
- Modify: `src/agents/index.ts`

**Interfaces:**
- Produces: `class MaterialSummarizerAgent extends BaseAgent` with
  `async summarize(material: PodcastMaterial, context: { title: string; description: string }): Promise<string>`
- Consumes: `BaseAgent.callModel(messages: LlmMessage[], maxTokens?: number): Promise<string>` (existing, `src/agents/BaseAgent.ts:164`), `PodcastMaterial` (existing, `src/types/index.ts:94`), `logger` from `src/utils/logger`.

- [ ] **Step 1: Write the failing tests**

Create `src/agents/MaterialSummarizerAgent.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { MaterialSummarizerAgent } from "./MaterialSummarizerAgent";
import { PodcastMaterial, SourceType } from "../types";

function makeMaterial(overrides: Partial<PodcastMaterial> = {}): PodcastMaterial {
  return {
    id: "m1",
    title: "The Article",
    content: "A".repeat(1000),
    source: "https://example.com/article",
    sourceType: SourceType.Web,
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  };
}

describe("MaterialSummarizerAgent.summarize", () => {
  it("returns the model's summary on success", async () => {
    const agent = new MaterialSummarizerAgent();
    vi.spyOn(agent as any, "callModel").mockResolvedValue(
      "Key fact one. Key fact two. A good angle to debate."
    );

    const result = await agent.summarize(makeMaterial(), {
      title: "Test Podcast",
      description: "A test episode",
    });

    expect(result).toBe(
      "Key fact one. Key fact two. A good angle to debate."
    );
  });

  it("falls back to truncated raw content when the model call fails", async () => {
    const agent = new MaterialSummarizerAgent();
    vi.spyOn(agent as any, "callModel").mockRejectedValue(
      new Error("model unavailable")
    );

    const material = makeMaterial({ content: "B".repeat(1000) });
    const result = await agent.summarize(material, {
      title: "Test Podcast",
      description: "A test episode",
    });

    expect(result).toBe("B".repeat(500));
    expect(result.length).toBe(500);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/agents/MaterialSummarizerAgent.test.ts`
Expected: FAIL — `Cannot find module './MaterialSummarizerAgent'`

- [ ] **Step 3: Write the implementation**

Create `src/agents/MaterialSummarizerAgent.ts`:

```ts
import { LlmMessage, PodcastMaterial } from "../types";
import { BaseAgent } from "./BaseAgent";
import { logger } from "../utils/logger";

const SUMMARY_MAX_TOKENS = 300;
const FALLBACK_CONTENT_LENGTH = 500;

export class MaterialSummarizerAgent extends BaseAgent {
  async summarize(
    material: PodcastMaterial,
    context: { title: string; description: string }
  ): Promise<string> {
    const messages: LlmMessage[] = [
      {
        role: "user" as const,
        content: `You're prepping source material for a podcast titled "${context.title}": ${context.description}.

Summarize the following article with an eye toward what's useful in a spoken conversation — key facts, hooks, interesting angles, things worth debating. 2-3 short paragraphs max.

Title: ${material.title}

${material.content}`,
      },
    ];

    try {
      return await this.callModel(messages, SUMMARY_MAX_TOKENS);
    } catch (error) {
      logger.warn(
        `Failed to summarize material "${material.title}"; falling back to truncated raw content:`,
        error
      );
      return material.content.substring(0, FALLBACK_CONTENT_LENGTH);
    }
  }
}
```

Modify `src/agents/index.ts` to add the export:

```ts
export { BaseAgent } from './BaseAgent';
export { DirectorAgent } from './DirectorAgent';
export { MaterialSummarizerAgent } from './MaterialSummarizerAgent';
export { SpeakerAgent } from './SpeakerAgent';
export { SpeakerAgentToolName } from './speaker-tools';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/agents/MaterialSummarizerAgent.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/agents/MaterialSummarizerAgent.ts src/agents/MaterialSummarizerAgent.test.ts src/agents/index.ts
git commit -m "feat: add MaterialSummarizerAgent for podcast-oriented material summaries"
```

---

### Task 2: Wire summarization into `DirectorAgent.createPodcastPlan`

**Files:**
- Modify: `src/agents/DirectorAgent.ts:1-38` (imports, constructor, `createPodcastPlan`)
- Modify: `src/agents/DirectorAgent.test.ts`

**Interfaces:**
- Consumes: `MaterialSummarizerAgent.summarize(material, context): Promise<string>` (from Task 1).
- Produces: `DirectorAgent.createPodcastPlan()` now builds its `materialText` from summaries instead of raw `content`. No signature changes — `createPodcastPlan(): Promise<string>` unchanged.

- [ ] **Step 1: Write the failing test**

Open `src/agents/DirectorAgent.test.ts` and locate the existing `describe("DirectorAgent.createPodcastPlan", ...)` block (currently the only test mocks `callModelForToolInput` with an empty-materials script, so it already passes trivially with either raw or summarized text — add a new test that actually exercises materials).

Add this import at the top of the file:

```ts
import { MaterialSummarizerAgent } from "./MaterialSummarizerAgent";
import { PodcastMaterial, SourceType } from "../types";
```

Add this helper near `makeScript`:

```ts
function makeMaterial(overrides: Partial<PodcastMaterial> = {}): PodcastMaterial {
  return {
    id: "m1",
    title: "Some Article",
    content: "Full raw article content that should not appear verbatim.",
    source: "https://example.com",
    sourceType: SourceType.Web,
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  };
}
```

Add this test inside the `describe("DirectorAgent.createPodcastPlan", ...)` block:

```ts
  it("builds the plan prompt from summarized materials, not raw content", async () => {
    const material = makeMaterial();
    const script = makeScript({ materials: [material] });
    const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });

    vi.spyOn(
      MaterialSummarizerAgent.prototype,
      "summarize"
    ).mockResolvedValue("A concise podcast-ready summary of the article.");

    const callModelForToolInputSpy = vi
      .spyOn(agent as any, "callModelForToolInput")
      .mockResolvedValue({
        narrative: "Open with intros, then dig in.",
        points: ["Point A"],
      });

    await agent.createPodcastPlan();

    const promptContent = callModelForToolInputSpy.mock.calls[0][0][0].content;
    expect(promptContent).toContain("A concise podcast-ready summary of the article.");
    expect(promptContent).not.toContain(material.content);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agents/DirectorAgent.test.ts`
Expected: FAIL — `promptContent` still contains `material.content` (current code joins raw content), or a `toContain` assertion failure since the summary text is never produced by unmodified `DirectorAgent`.

- [ ] **Step 3: Implement the change in `DirectorAgent`**

In `src/agents/DirectorAgent.ts`, update the import block at the top:

```ts
import { DiscussionPoint, IDirectorAgent, PodcastScript, Speaker } from '../types';
import { BaseAgent } from './BaseAgent';
import { MaterialSummarizerAgent } from './MaterialSummarizerAgent';
import { logger } from '../utils/logger';
import {
  CreatePodcastPlanInput,
  SelectNextSpeakerInput,
  toCreatePodcastPlanTool,
  toSelectNextSpeakerTool,
} from './director-tools';
```

Add a private field and instantiate it in the constructor:

```ts
export class DirectorAgent extends BaseAgent implements IDirectorAgent {
  private script: PodcastScript;
  private podcastPlan: string = '';
  private maxTurns: number;
  private maxDuration: number;
  private turnsUsed = 0;
  private hasForcedTimeWarning = false;
  private points: DiscussionPoint[] = [];
  private materialSummarizer = new MaterialSummarizerAgent();

  constructor(
    script: PodcastScript,
    budget: { maxTurns: number; maxDuration: number }
  ) {
    super();
    this.script = script;
    this.maxTurns = budget.maxTurns;
    this.maxDuration = budget.maxDuration;
  }
```

Replace the `materialText` line inside `createPodcastPlan`:

```ts
      const materialText = this.script.materials
        .map(material => `${material.title}: ${material.content}`)
        .join('\n\n');
```

with:

```ts
      const summaries = await Promise.all(
        this.script.materials.map((material) =>
          this.materialSummarizer.summarize(material, {
            title: this.script.title,
            description: this.script.description,
          })
        )
      );
      const materialText = this.script.materials
        .map((material, index) => `${material.title}: ${summaries[index]}`)
        .join('\n\n');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/agents/DirectorAgent.test.ts`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 5: Run the full test suite and type-check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS. (Note: `src/providers/audio-timeline.test.ts` has one pre-existing, unrelated failure — "clamps the interjection offset to zero when the previous clip's speech is shorter than the overlap" — confirm no *new* failures beyond that one.)

- [ ] **Step 6: Commit**

```bash
git add src/agents/DirectorAgent.ts src/agents/DirectorAgent.test.ts
git commit -m "feat: DirectorAgent summarizes materials before building the plan prompt"
```

---

## Post-plan verification

After both tasks are committed, sanity-check the wiring end-to-end conceptually (no live API call required unless you want one): confirm `ScriptService.generateScriptContent` (`src/services/ScriptService.ts:187-193`) still constructs `DirectorAgent` with just `(script, budget)` — unchanged — since `MaterialSummarizerAgent` is created internally and requires no new call-site parameters.
