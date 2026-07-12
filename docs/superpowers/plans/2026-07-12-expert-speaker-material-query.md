# Expert Speaker Semantic Material Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give expert speakers material relevant to the current turn's `direction` via `RAGService` semantic search, instead of the first 3 materials on the script truncated at 200 chars.

**Architecture:** `RAGService` is injected into `ScriptService` (constructor DI), which populates the vector store with a script's materials once per generation run and passes the same `RAGService` into each `SpeakerAgent` it creates. `SpeakerAgent.getRelevantMaterials` becomes async, tries a semantic search keyed on `direction` first, and falls back to today's naive `script.materials.slice(0, 3)` behavior if no `RAGService` was supplied, the search throws, or it returns nothing.

**Tech Stack:** TypeScript, vitest, existing `RAGService`/`LangChainVectorStore` (src/rag), LangChain tool-calling via `BaseAgent`.

## Global Constraints

- No new agent tool — this stays a prompt-injection mechanism (per design spec, `docs/superpowers/specs/2026-07-12-expert-speaker-material-query-design.md`).
- `interject()` is not touched — interjections stay reactive, no material access.
- Must never throw out of `generateSpeech`/`speak` because RAG is unavailable — always fall back to the naive material selection.
- Match existing test mocking conventions in this codebase: plain object literals cast with `as any` / `as unknown as X` for fakes, `vi.spyOn(agent as any, "callModelWithTools")` for agent-level tests, `vi.mock("../agents", ...)` module mocking for service-level tests that would otherwise need a live `DirectorAgent`.

---

## File Structure

- **Modify** `src/agents/SpeakerAgent.ts` — accept optional `RAGService` in constructor, make `getRelevantMaterials` async and RAG-backed with fallback.
- **Modify** `src/agents/SpeakerAgent.test.ts` — new test cases for the RAG-backed lookup and its fallback paths.
- **Modify** `src/services/ScriptService.ts` — accept `RAGService` in constructor, call `addMaterials` once per `generateScriptContent` run, pass `RAGService` into both `SpeakerAgent` instantiations.
- **Modify** `src/services/ScriptService.test.ts` — update `makeService` helper for the new constructor param, add a test asserting the RAG wiring.
- **Modify** `src/cli/commands/ScriptCommands.ts` — construct a `RAGService` and pass it into `new ScriptService(...)`.
- **Modify** `src/cli/commands/AudioCommands.ts` — same constructor wiring (it also constructs `ScriptService`, even though it doesn't call `generateScript`).

No new files. No changes to `src/rag/*` — this only adds new callers of the existing public `RAGService` API.

---

### Task 1: `SpeakerAgent` accepts a `RAGService` and does semantic material lookup

**Files:**
- Modify: `src/agents/SpeakerAgent.ts`
- Test: `src/agents/SpeakerAgent.test.ts`

**Interfaces:**
- Consumes: `RAGService.searchRelevantContent(query: string, limit?: number): Promise<Document[]>` where `Document = { id: string; content: string; metadata: Record<string, any> }` (`src/rag/RAGService.ts:33`, `src/types/index.ts:395`).
- Produces: `SpeakerAgent` constructor signature becomes `constructor(speaker: Speaker, ragService?: RAGService)`. This is what Task 2 relies on when it does `new SpeakerAgent(speaker, this.ragService)`.

- [ ] **Step 1: Write the failing tests**

Append to `src/agents/SpeakerAgent.test.ts` (after the existing `describe("SpeakerAgent expertise nudge", ...)` block):

```ts
describe("SpeakerAgent expert material lookup via RAGService", () => {
  it("uses RAGService.searchRelevantContent keyed on direction when ragService is provided", async () => {
    const searchRelevantContent = vi.fn().mockResolvedValue([
      {
        id: "d1",
        content: "Deep sea creatures glow.",
        metadata: { title: "Bioluminescence" },
      },
    ]);
    const ragService = { searchRelevantContent } as unknown as import("../rag").RAGService;
    const agent = new SpeakerAgent(makeSpeaker("s1", true), ragService);
    const spy = vi
      .spyOn(agent as any, "callModelWithTools")
      .mockResolvedValue({
        toolName: SpeakerAgentToolName.SPEAK,
        message: "hello there",
        style: "calm",
        stopReason: "stop",
      });

    await agent.speak(makeScript(), "talk about bioluminescence");

    expect(searchRelevantContent).toHaveBeenCalledWith(
      "talk about bioluminescence",
      3
    );
    const prompt = (spy.mock.calls[0] as any)[0][0].content as string;
    expect(prompt).toContain("Bioluminescence: Deep sea creatures glow.");
  });

  it("falls back to script.materials when ragService is not provided", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1", true));
    const spy = vi
      .spyOn(agent as any, "callModelWithTools")
      .mockResolvedValue({
        toolName: SpeakerAgentToolName.SPEAK,
        message: "hello there",
        style: "calm",
        stopReason: "stop",
      });

    const script = makeScript();
    script.materials = [
      {
        id: "m1",
        title: "Fallback Material",
        content: "Naive content.",
        source: "test",
        sourceType: SourceType.Manual,
        metadata: {},
        createdAt: new Date(),
      },
    ];

    await agent.speak(script, "talk about x");

    const prompt = (spy.mock.calls[0] as any)[0][0].content as string;
    expect(prompt).toContain("Fallback Material: Naive content.");
  });

  it("falls back to script.materials when RAGService search throws", async () => {
    const searchRelevantContent = vi
      .fn()
      .mockRejectedValue(new Error("vector store unavailable"));
    const ragService = { searchRelevantContent } as unknown as import("../rag").RAGService;
    const agent = new SpeakerAgent(makeSpeaker("s1", true), ragService);
    const spy = vi
      .spyOn(agent as any, "callModelWithTools")
      .mockResolvedValue({
        toolName: SpeakerAgentToolName.SPEAK,
        message: "hello there",
        style: "calm",
        stopReason: "stop",
      });

    const script = makeScript();
    script.materials = [
      {
        id: "m1",
        title: "Fallback Material",
        content: "Naive content.",
        source: "test",
        sourceType: SourceType.Manual,
        metadata: {},
        createdAt: new Date(),
      },
    ];

    await agent.speak(script, "talk about x");

    const prompt = (spy.mock.calls[0] as any)[0][0].content as string;
    expect(prompt).toContain("Fallback Material: Naive content.");
  });
});
```

Add `SourceType` to the existing type import at the top of the file:

```ts
import {
  PodcastScript,
  Speaker,
  SourceType,
  VocalProviderName,
} from "../types";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/agents/SpeakerAgent.test.ts`
Expected: FAIL — `new SpeakerAgent(makeSpeaker("s1", true), ragService)` errors or the assertions on `searchRelevantContent` fail, since `SpeakerAgent` doesn't accept a second constructor argument yet and `getRelevantMaterials` doesn't call it.

- [ ] **Step 3: Implement the RAGService-backed lookup with fallback**

In `src/agents/SpeakerAgent.ts`, add the import:

```ts
import { RAGService } from "../rag";
```

Change the constructor and field declarations:

```ts
  private speaker: Speaker;
  private ragService?: RAGService;
  private maxAttempts = 3;

  constructor(speaker: Speaker, ragService?: RAGService) {
    super();
    this.speaker = speaker;
    this.ragService = ragService;
  }
```

Change the `materialsSection` line inside `generateSpeech` from:

```ts
    const materialsSection = this.speaker.isExpert
      ? `\n\nRelevant Materials:\n${this.getRelevantMaterials(script)}`
      : "";
```

to:

```ts
    const materialsSection = this.speaker.isExpert
      ? `\n\nRelevant Materials:\n${await this.getRelevantMaterials(
          script,
          direction
        )}`
      : "";
```

Replace `getRelevantMaterials` with:

```ts
  private async getRelevantMaterials(
    script: PodcastScript,
    direction: string
  ): Promise<string> {
    if (this.ragService) {
      try {
        const docs = await this.ragService.searchRelevantContent(
          direction,
          3
        );
        if (docs.length > 0) {
          return docs
            .map(
              (doc) =>
                `${doc.metadata.title}: ${doc.content.substring(0, 200)}...`
            )
            .join("\n\n");
        }
      } catch (error) {
        logger.warn(
          "RAG material search failed, falling back to naive material selection:",
          error
        );
      }
    }

    return script.materials
      .slice(0, 3) // First 3 materials
      .map(
        (material) =>
          `${material.title}: ${material.content.substring(0, 200)}...`
      )
      .join("\n\n");
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/agents/SpeakerAgent.test.ts`
Expected: PASS — all tests in the file, including the 3 new ones and the pre-existing ones (which construct `SpeakerAgent` with a single argument, still valid since `ragService` is optional).

- [ ] **Step 5: Commit**

```bash
git add src/agents/SpeakerAgent.ts src/agents/SpeakerAgent.test.ts
git commit -m "feat: expert speakers pull materials via RAGService semantic search"
```

---

### Task 2: `ScriptService` injects `RAGService` into script generation

**Files:**
- Modify: `src/services/ScriptService.ts`
- Test: `src/services/ScriptService.test.ts`

**Interfaces:**
- Consumes: `SpeakerAgent` constructor `(speaker: Speaker, ragService?: RAGService)` from Task 1. `RAGService.addMaterials(materials: PodcastMaterial[]): Promise<void>` (`src/rag/RAGService.ts:12`).
- Produces: `ScriptService` constructor signature becomes `(scriptRepository, speakerRepository, materialRepository, voiceRepository, speechRepository, ragService: RAGService)`. Task 3 relies on this exact parameter order (ragService last) to update the two CLI command call sites.

- [ ] **Step 1: Write the failing test**

In `src/services/ScriptService.test.ts`, add `RAGService` type import and update `makeService` to take a `ragService` override, then add a new test. Replace the top of the file through the `makeService` function with:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ScriptService } from "./ScriptService";
import { SpeakerAgentToolName } from "../agents/speaker-tools";
import { VocalProviderName, PodcastScript, SourceType } from "../types";
import type { RAGService } from "../rag";

const chooseNextSpeakerMock = vi.fn();
const createPodcastPlanMock = vi.fn().mockResolvedValue(undefined);
const speakMock = vi.fn();
const speakerAgentConstructorMock = vi.fn();

vi.mock("../agents", () => ({
  DirectorAgent: vi.fn().mockImplementation(() => ({
    createPodcastPlan: createPodcastPlanMock,
    chooseNextSpeaker: chooseNextSpeakerMock,
  })),
  SpeakerAgent: vi.fn().mockImplementation((speaker, ragService) => {
    speakerAgentConstructorMock(speaker, ragService);
    return { speak: speakMock, interject: vi.fn() };
  }),
}));

function makeScript(): PodcastScript {
  return {
    id: "script-1",
    title: "Test Script",
    description: "A test script",
    speakers: [],
    speeches: [],
    materials: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeService(overrides: {
  speechRepository?: any;
  speakerRepository?: any;
  materialRepository?: any;
  voiceRepository?: any;
  ragService?: any;
}) {
  return new ScriptService(
    {} as any,
    overrides.speakerRepository ?? ({} as any),
    overrides.materialRepository ?? ({} as any),
    overrides.voiceRepository ?? ({} as any),
    overrides.speechRepository ?? ({} as any),
    overrides.ragService ?? ({ addMaterials: vi.fn() } as any)
  );
}
```

(The rest of the existing `describe("ScriptService stopReason persistence", ...)` block stays unchanged below this.)

Add a new `describe` block at the end of the file:

```ts
describe("ScriptService RAG wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds script materials to RAG once and injects ragService into each SpeakerAgent", async () => {
    const addMaterials = vi.fn().mockResolvedValue(undefined);
    const ragService = { addMaterials } as unknown as RAGService;

    const speaker = {
      id: "s1",
      slug: "s1",
      name: "S1",
      personality: "",
      voice: {
        id: "voice-1",
        name: "Voice",
        description: "",
        provider: VocalProviderName.ElevenLabs,
        providerId: "p",
        settings: {},
      },
      voiceStyle: "neutral",
      isExpert: true,
    };
    chooseNextSpeakerMock.mockResolvedValue({
      speaker,
      direction: "talk about x",
      timeStatus: "",
      forceNearlyOutOfTime: false,
    });
    speakMock.mockResolvedValue({
      id: "",
      speaker,
      message: "hi",
      instructions: "calm",
      voice: speaker.voice,
      voiceStyle: "neutral",
      timestamp: new Date(),
      tool: SpeakerAgentToolName.SPEAK,
      stopReason: "stop",
    });

    const speechRepository = {
      create: vi.fn().mockResolvedValue({ id: "record-1" }),
    };
    const service = makeService({ speechRepository, ragService });

    const script = makeScript();
    script.materials = [
      {
        id: "m1",
        title: "T",
        content: "C",
        source: "s",
        sourceType: SourceType.Manual,
        metadata: {},
        createdAt: new Date(),
      },
    ];

    await (service as any).generateScriptContent(script, {
      maxTurns: 1,
      maxDuration: 60,
    });

    expect(addMaterials).toHaveBeenCalledWith(script.materials);
    expect(speakerAgentConstructorMock).toHaveBeenCalledWith(
      speaker,
      ragService
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/ScriptService.test.ts`
Expected: FAIL — `ScriptService`'s constructor doesn't yet accept a 6th `ragService` argument (or the call inside `generateScriptContent` never calls `addMaterials`/passes `ragService` to `SpeakerAgent`).

- [ ] **Step 3: Implement the wiring**

In `src/services/ScriptService.ts`, add the import:

```ts
import { RAGService } from "../rag";
```

Change the constructor:

```ts
  constructor(
    private readonly scriptRepository: ScriptRepository,
    private readonly speakerRepository: SpeakerRepository,
    private readonly materialRepository: MaterialRepository,
    private readonly voiceRepository: VoiceRepository,
    private readonly speechRepository: SpeechRepository,
    private readonly ragService: RAGService
  ) {}
```

In `generateScriptContent`, add the `addMaterials` call right after `await directorAgent.createPodcastPlan();`:

```ts
    const directorAgent = new DirectorAgent(script, {
      maxTurns: params.maxTurns,
      maxDuration: params.maxDuration,
    });
    await directorAgent.createPodcastPlan();
    await this.ragService.addMaterials(script.materials);
```

Change both `SpeakerAgent` instantiations to pass `this.ragService`:

```ts
      const speakerAgent = new SpeakerAgent(speaker, this.ragService);
```

```ts
        const interjectionAgent = new SpeakerAgent(
          interjector,
          this.ragService
        );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/ScriptService.test.ts`
Expected: PASS — all tests in the file, including the pre-existing `stopReason persistence` tests (unaffected, since they call `persistSpeech`/`loadScriptFromRecord` directly, not `generateScriptContent`) and the new RAG wiring test.

- [ ] **Step 5: Commit**

```bash
git add src/services/ScriptService.ts src/services/ScriptService.test.ts
git commit -m "feat: ScriptService populates RAG store and injects it into SpeakerAgent"
```

---

### Task 3: Wire `RAGService` construction into the CLI commands

**Files:**
- Modify: `src/cli/commands/ScriptCommands.ts`
- Modify: `src/cli/commands/AudioCommands.ts`

**Interfaces:**
- Consumes: `ScriptService` constructor `(scriptRepository, speakerRepository, materialRepository, voiceRepository, speechRepository, ragService: RAGService)` from Task 2. `RAGService` constructor takes no arguments (`src/rag/RAGService.ts:8`), imported from `../../rag` (matches `MaterialCommands.ts:5`'s import style: `import { RAGService } from "../../rag";`).
- Produces: nothing further downstream — this is the last task.

- [ ] **Step 1: Update `ScriptCommands.ts`**

Add the import:

```ts
import { RAGService } from "../../rag";
```

Change the service construction:

```ts
  const scriptRepository = new ScriptRepository();
  const speakerRepository = new SpeakerRepository();
  const materialRepository = new MaterialRepository();
  const voiceRepository = new VoiceRepository();
  const speechRepository = new SpeechRepository();
  const ragService = new RAGService();
  const scriptService = new ScriptService(
    scriptRepository,
    speakerRepository,
    materialRepository,
    voiceRepository,
    speechRepository,
    ragService
  );
```

- [ ] **Step 2: Update `AudioCommands.ts`**

Add the import:

```ts
import { RAGService } from "../../rag";
```

Change the service construction:

```ts
  const scriptRepository = new ScriptRepository();
  const speakerRepository = new SpeakerRepository();
  const materialRepository = new MaterialRepository();
  const voiceRepository = new VoiceRepository();
  const speechRepository = new SpeechRepository();
  const ragService = new RAGService();
  const scriptService = new ScriptService(
    scriptRepository,
    speakerRepository,
    materialRepository,
    voiceRepository,
    speechRepository,
    ragService
  );
```

- [ ] **Step 3: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors (this is the step that actually catches any remaining call site with the old 5-arg `ScriptService` constructor).

- [ ] **Step 4: Run the full test suite**

Run: `pnpm test`
Expected: PASS — all existing and new tests, confirming nothing else in the codebase constructed `ScriptService` or `SpeakerAgent` in a way this change broke.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/ScriptCommands.ts src/cli/commands/AudioCommands.ts
git commit -m "feat: wire RAGService into script and audio CLI commands"
```
