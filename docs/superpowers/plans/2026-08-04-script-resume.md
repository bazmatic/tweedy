# Resume a Prematurely-Ended Script — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `tweedy script resume <id>` continue a Mastra-engine script that
was silently force-closed early (due to sustained AI-provider failure)
instead of reaching its real target length.

**Architecture:** Mark closing-sequence speeches with which stage produced
them; save the `Script` record incrementally (not just once at the end) so a
prematurely-ended script is still visible/targetable; detect resumability via
the existing `productionOutcome.completionReason` field; strip the
fabricated closing turns and re-invoke the same Mastra workflow machinery
with the existing plan/speeches preserved and a reduced turn/duration budget.

**Tech Stack:** TypeScript, Vitest, Mastra workflows (`@mastra/core`),
Commander.js CLI.

## Global Constraints

- Phase 1 only: Mastra engine only. `legacy`-engine scripts get an explicit
  "not supported" error from `script resume`. (Design spec, "Out of scope".)
- Only `productionOutcome?.completionReason === "turn_selection_failed"`
  scripts are eligible for resume — no other completion reason is treated as
  resumable. (Design spec, "Detecting a resumable script".)
- No new runtime dependencies.

---

### Task 1: Persist which closing-sequence stage produced a turn

**Files:**
- Modify: `src/types/index.ts` (`Speech` interface at line 120, `SpeechRecord`
  interface at line 627)
- Modify: `src/services/MastraScriptWorkflowRunner.ts` (`forceClosingTurn`
  dependency at line 326, `persistCandidate` dependency at line 475)
- Test: `src/services/MastraScriptWorkflowRunner.test.ts`

**Interfaces:**
- Produces: `Speech.closingStage?: "reflection" | "co_host_response" |
  "sign_off"` and the same field on `SpeechRecord`. Later tasks (5) read this
  field to identify which trailing speeches to strip on resume.

Only the final `sign_off` turn is identifiable today via
`tool === SpeakerAgentToolName.CLOSING_STATEMENT`; the `reflection` and
`co_host_response` turns that precede it are indistinguishable from ordinary
turns once persisted. `ClosingSequencePolicy.getStage(script, cursor)`
(`src/agents/ClosingSequencePolicy.ts`) already computes exactly this value
when `forceClosingTurn` builds the turn — it's just never recorded.

- [ ] **Step 1: Add the field to the domain and persisted types**

In `src/types/index.ts`, add to `Speech` (after `stopReason?: StopReason;` at
line 129):

```ts
  closingStage?: "reflection" | "co_host_response" | "sign_off";
```

Add the identical line to `SpeechRecord` (after `stopReason?: StopReason;` at
line 638).

- [ ] **Step 2: Write a failing test that resume-relevant metadata survives a forced close**

In `src/services/MastraScriptWorkflowRunner.test.ts`, extend the existing
`"runs the typed workflow and returns the normal PodcastScript domain"` test
setup: after the existing `const result = await runner.run({...})` call and
its current assertions, add:

```ts
    const closingSpeeches = result.speeches.filter((speech) =>
      Boolean(speech.closingStage)
    );
    expect(closingSpeeches.map((speech) => speech.closingStage)).toEqual([
      "reflection",
      "co_host_response",
      "sign_off",
    ]);
```

(This test's `directorComplete` mock resolves `false` and `directorChoose`
always requests `isFinalTurn: true`, so the runner is already exercising the
closing sequence for its 5-speech result — the existing test just never
asserted on stage tagging.)

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/services/MastraScriptWorkflowRunner.test.ts -t "runs the typed workflow"`
Expected: FAIL — `closingSpeeches` is empty because `closingStage` is never set.

- [ ] **Step 4: Capture and persist the closing stage**

In `src/services/MastraScriptWorkflowRunner.ts`, the `forceClosingTurn`
dependency (line 326) currently discards the `ClosingStage` it computes
implicitly inside `closing.nextTurn`. Compute it explicitly and stash it
alongside the existing `selectedTurns` map. Add a new map near the other
per-turn maps (`selectedTurns`, `generatedSpeeches`, `verifiedDiscourseClaims`
around line 185-188):

```ts
    const closingStages = new Map<string, ClosingStage>();
```

Add the import at the top of the file (alongside the existing
`import { ClosingSequencePolicy } from "../agents/ClosingSequencePolicy";`
at line 12):

```ts
import { ClosingSequencePolicy, ClosingStage } from "../agents/ClosingSequencePolicy";
```

In `forceClosingTurn` (line 326-347), record the stage right after computing
`choice`:

```ts
      forceClosingTurn: async (state, reason) => {
        if (state.phase === "discussion") {
          director.markRemainingPointsOmitted(reason.replace(/ /g, "_"));
        }
        const choice = closing.nextTurn(script, state.closingCursor);
        if (!choice) {
          throw new Error("Closing sequence has no remaining turn");
        }
        const selection = rememberSelection(
          state,
          {
            ...choice,
            timeStatus: choice.timeStatus,
            openingTurn: null,
          },
          {
            isClosingTurn: true,
            isFinalClosingTurn: choice.isFinalTurn,
            isFinalTurn: choice.isFinalTurn,
          }
        );
        closingStages.set(
          keyFor(selection),
          closing.getStage(script, state.closingCursor)
        );
        return selection;
      },
```

In `persistCandidate` (line 475), read the stored stage into the persisted
record. Change the first parameter from `_state` to `state` (it's now used)
and add `closingStage` to the `record` object (line 485-496):

```ts
      persistCandidate: async (state, selection, _candidate, idempotencyKey) => {
        const speech = generatedSpeeches.get(keyFor(selection));
        if (!speech) {
          throw new Error(`Missing reviewed turn ${keyFor(selection)}`);
        }
        const targetDiscourseClaimIds =
          speech.turnBrief?.targetDiscourseClaimIds ?? [];
        const verifiedClaimIds =
          verifiedDiscourseClaims.get(keyFor(selection)) ?? [];
        verifiedDiscourseClaims.set(keyFor(selection), verifiedClaimIds);
        const record = {
          speakerId: speech.speaker.id,
          message: speech.message,
          instructions: speech.instructions,
          voiceId: speech.voice.id,
          voiceStyle: speech.voiceStyle,
          timestamp: speech.timestamp,
          tool: speech.tool,
          stopReason: speech.stopReason,
          turnBrief: speech.turnBrief,
          review: speech.review,
          closingStage: closingStages.get(keyFor(selection)),
        };
```

Also set `speech.closingStage` so the in-memory domain object (not just the
persisted record) carries it, right after `speech.id = persisted.id;` (line
501):

```ts
        speech.id = persisted.id;
        speech.closingStage = closingStages.get(keyFor(selection));
```

(`state` is now referenced nowhere new in this function body — leave the
parameter renamed to `state` regardless, since a linted `noUnusedParams`
would otherwise flag the still-unused rename back to `_state`; if the repo's
lint config does flag unused named params, rename back to `_state` and read
`closingStages` directly instead, which doesn't need `state` at all. Verify
by running the type check in Step 6.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/services/MastraScriptWorkflowRunner.test.ts -t "runs the typed workflow"`
Expected: PASS

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/services/MastraScriptWorkflowRunner.ts src/services/MastraScriptWorkflowRunner.test.ts
git commit -m "feat: persist which closing-sequence stage produced each turn"
```

---

### Task 2: Persist the original generation limits on the script record

**Files:**
- Modify: `src/types/index.ts` (`ScriptRecord` interface at line 590,
  `PodcastScript` interface at line 464)
- Modify: `src/services/ScriptService.ts` (`saveScript` at line 874,
  `loadScriptFromRecord` at line 799)
- Test: `src/services/ScriptService.test.ts` (extend existing coverage of
  script save/load round-tripping if present; otherwise add a focused test —
  check the file first for the closest existing "generates and reloads a
  script" test to extend rather than duplicate its fixture setup)

**Interfaces:**
- Produces: `PodcastScript.maxDuration?: number`,
  `PodcastScript.maxTurns?: number` (seconds / count), and the identical
  fields on `ScriptRecord`. Task 6 reads these as the default resume target
  when `--max-duration`/`--max-turns` aren't passed to `script resume`.

- [ ] **Step 1: Add the fields to both types**

In `src/types/index.ts`, add to `PodcastScript` (after `productionOutcome?:
ProductionOutcome;` at line 484):

```ts
  maxDuration?: number;
  maxTurns?: number;
```

Add the identical two lines to `ScriptRecord` (after `productionOutcome?:
ProductionOutcome;` at line 606).

- [ ] **Step 2: Write a failing test**

Add to `src/services/ScriptService.test.ts` (find the existing test that
calls `scriptService.generateScript(...)` with real or faked params and then
reloads via `scriptService.getScript(...)` — extend it, or if none exists in
that exact shape, add a new `it` block modeled on the closest existing
generate-then-reload test in that file):

```ts
  it("persists the original maxDuration/maxTurns on the saved record", async () => {
    // ...use the same generateScript(params) setup as the neighboring test...
    const script = await scriptService.generateScript(params, { engine: "mastra" });
    expect(script.maxDuration).toBe(params.maxDuration);
    expect(script.maxTurns).toBe(params.maxTurns);

    const reloaded = await scriptService.getScript(script.id);
    expect(reloaded.maxDuration).toBe(params.maxDuration);
    expect(reloaded.maxTurns).toBe(params.maxTurns);
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/services/ScriptService.test.ts -t "persists the original maxDuration"`
Expected: FAIL — `script.maxDuration` is `undefined`.

- [ ] **Step 4: Set the fields when building and saving the script**

In `src/services/ScriptService.ts`, `generateScript` (line 107), add the two
fields to the initial `script` object construction (line 122-136, alongside
the other params-derived fields):

```ts
      const script: PodcastScript = {
        id: "",
        title: params.title,
        description: params.description,
        guidance: params.guidance,
        speakers,
        speeches: [],
        materials,
        discussionPoints: [],
        knowledgeLedger: this.knowledgeLedgerPolicy.createLedger(),
        audienceProfile: params.audienceProfile ?? AudienceProfile.General,
        terminologyLedger: this.terminologyLedgerPolicy.createLedger(),
        maxDuration: params.maxDuration,
        maxTurns: params.maxTurns,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
```

In `saveScript` (line 874-895), add both fields to the `record` object
(alongside `productionOutcome: script.productionOutcome,` at line 893):

```ts
      productionOutcome: script.productionOutcome,
      maxDuration: script.maxDuration,
      maxTurns: script.maxTurns,
      conversationRun: script.conversationRun,
```

In `loadScriptFromRecord` (line 799-872), add both fields to the returned
object (alongside `productionOutcome: record.productionOutcome,` at line
867):

```ts
      productionOutcome: record.productionOutcome,
      maxDuration: record.maxDuration,
      maxTurns: record.maxTurns,
      conversationRun: record.conversationRun,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/services/ScriptService.test.ts -t "persists the original maxDuration"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/services/ScriptService.ts src/services/ScriptService.test.ts
git commit -m "feat: persist original maxDuration/maxTurns on the script record"
```

---

### Task 3: Save the script record incrementally, not only at the end

**Files:**
- Modify: `src/services/ScriptService.ts` (`generateScript` at line 107,
  `persistSpeech` at line 773, `saveScript` at line 874)
- Modify: `src/services/MastraScriptWorkflowRunner.ts` (constructor at line
  148, `acceptCandidate` dependency at line 555)
- Test: `src/services/ScriptService.test.ts`,
  `src/services/MastraScriptWorkflowRunner.test.ts`

**Interfaces:**
- Consumes: `ScriptRepository.create(record)` (returns `ScriptRecord` with a
  populated `id`) and `ScriptRepository.update(id, partial)` (both already
  exist, `src/repositories/ScriptRepository.ts:15,36`).
- Produces: after this task, `scriptRepository.getById(id)` returns a
  non-null record with a growing `speechIds` array *during* generation, not
  only after it completes. Task 6 relies on this — a script that stopped mid-
  run (crash or otherwise) is still visible via `script show <id>`.

Today `saveScript` (`src/services/ScriptService.ts:874`) always calls
`scriptRepository.create`, and `generateScript` only calls it once, after
`engine.generate` resolves. Split `saveScript` into an initial create and a
later update, and call the create half before generation starts.

- [ ] **Step 1: Write a failing test for incremental persistence**

Add to `src/services/MastraScriptWorkflowRunner.test.ts`, a new test in the
`describe("MastraScriptWorkflowRunner")` block, reusing the existing test's
speaker/script/mock setup pattern (copy the fixture construction from the
`"runs the typed workflow..."` test, since `MastraScriptWorkflowRunner` takes
its `ScriptRepository` collaborator as a new constructor argument added in
Step 2 below):

```ts
  it("updates the script repository's speechIds after each accepted turn, not only at the end", async () => {
    // ...same directory/speaker/script/mock setup as the existing "runs the
    // typed workflow" test...
    const scriptUpdateCalls: string[][] = [];
    const scriptRepository = {
      update: vi.fn(async (_id: string, changes: { speechIds?: string[] }) => {
        if (changes.speechIds) scriptUpdateCalls.push([...changes.speechIds]);
        return null;
      }),
    };
    const runner = new MastraScriptWorkflowRunner(
      { createOrReturn } as any,
      { addMaterials: vi.fn() } as any,
      knowledgeLedgerPolicy as any,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        storagePath: path.join(directory, "workflow.db"),
        tracePath: path.join(directory, "traces.jsonl"),
      },
      undefined,
      { evaluate: vi.fn().mockResolvedValue({ accepted: true }) } as any,
      {
        audit: vi.fn().mockResolvedValue([]),
        rewrite: vi.fn(),
        attachObservability: vi.fn(),
      } as any,
      scriptRepository as any
    );

    await runner.run({
      script: { ...script, id: "script-under-test" },
      params: {
        title: script.title,
        description: "",
        speakers: [speaker],
        materials: [],
        maxTurns: 1,
        maxDuration: 60,
        allocation: SpeakerAllocation.Sequential,
      },
      workflowRunId: "run-incremental",
    });

    expect(scriptUpdateCalls.length).toBeGreaterThan(0);
    // Each call's speechIds grows — the update after the last accepted turn
    // reflects all 5 accepted speeches from the existing fixture's flow.
    expect(scriptUpdateCalls.at(-1)?.length).toBe(5);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/services/MastraScriptWorkflowRunner.test.ts -t "updates the script repository's speechIds"`
Expected: FAIL — `MastraScriptWorkflowRunner` constructor doesn't accept a
13th argument yet, or `scriptUpdateCalls` stays empty.

- [ ] **Step 3: Add the optional repository dependency and call it from acceptCandidate**

In `src/services/MastraScriptWorkflowRunner.ts`, add an import:

```ts
import { ScriptRepository, SpeechRepository } from "../repositories";
```

(replacing the existing `import { SpeechRepository } from "../repositories";`
at line 25).

Add a 12th constructor parameter, after `episodeAuditAgent` (line 166),
optional so every existing call site (including the test file's positional
constructions) keeps working unchanged:

```ts
    private readonly episodeAuditAgent = new EpisodeAuditAgent(),
    private readonly scriptRepository?: ScriptRepository
  ) {}
```

In `acceptCandidate` (line 555-575), after `script.speeches.push(speech);`
(line 567), add:

```ts
          script.speeches.push(speech);
          await this.scriptRepository?.update(script.id, {
            speechIds: script.speeches.map((accepted) => accepted.id),
          });
```

- [ ] **Step 4: Wire the dependency in ScriptService and split saveScript**

In `src/services/ScriptService.ts`, constructor (line 89-103), pass
`this.scriptRepository` as the new final argument:

```ts
        new MastraConversationWorkflowEngine(
          new MastraScriptWorkflowRunner(
            this.speechRepository,
            this.ragService,
            this.knowledgeLedgerPolicy,
            this.terminologyLedgerPolicy,
            this.speechRepetitionPolicy,
            this.episodeRecapPolicy,
            this.roleProfileResolver,
            undefined,
            undefined,
            this.claimEditorialGate,
            this.episodeAuditAgent,
            this.scriptRepository
          )
        ),
```

Split `saveScript` (line 874-901) into the create half (`saveNewScript`) and
an update half (`updateScript`):

```ts
  private buildScriptRecord(script: PodcastScript) {
    return {
      title: script.title,
      description: script.description,
      guidance: script.guidance,
      speakerIds: script.speakers.map((s) => s.id),
      speechIds: script.speeches.map((s) => s.id),
      materialIds: script.materials.map((m) => m.id),
      discussionPoints: script.discussionPoints ?? [],
      orientation: script.orientation,
      editorialCards: script.editorialCards ?? [],
      conversationBeats: script.conversationBeats ?? [],
      knowledgeLedger:
        script.knowledgeLedger ?? this.knowledgeLedgerPolicy.createLedger(),
      audienceProfile: script.audienceProfile ?? AudienceProfile.General,
      terminologyLedger:
        script.terminologyLedger ?? this.terminologyLedgerPolicy.createLedger(),
      speakerRoleAssignments: script.speakerRoleAssignments,
      centralAnalogy: script.centralAnalogy,
      productionOutcome: script.productionOutcome,
      maxDuration: script.maxDuration,
      maxTurns: script.maxTurns,
      conversationRun: script.conversationRun,
    };
  }

  private async saveNewScript(script: PodcastScript): Promise<void> {
    const created = await this.scriptRepository.create(
      this.buildScriptRecord(script)
    );
    script.id = created.id;
    script.createdAt = created.createdAt;
    script.updatedAt = created.updatedAt;
  }

  private async saveScript(script: PodcastScript): Promise<void> {
    const updated = await this.scriptRepository.update(
      script.id,
      this.buildScriptRecord(script)
    );
    if (!updated) {
      throw new Error(`Script with id ${script.id} not found while saving.`);
    }
    script.updatedAt = updated.updatedAt;
  }
```

(This replaces the single old `saveScript` method — `buildScriptRecord`
factors out the shared field-mapping so both the create and update paths use
identical logic and stay in sync automatically.)

In `generateScript` (line 107-160), call `saveNewScript` before invoking the
engine, and `saveScript` (the update variant) after, instead of the current
single post-generation `saveScript` call at line 152:

```ts
      const workflowRunId = script.createdAt.toISOString();
      await this.saveNewScript(script);
      logger.info(
        `Conversation workflow starting: engine=${engine.name}, ` +
          `flowVersion=${engine.flowVersion}, runId=${workflowRunId}`
      );
      const generated = await engine.generate({
        script,
        params,
        workflowRunId,
      });
      Object.assign(script, generated.script);
      script.conversationRun = generated.metadata;

      // Final save — captures anything not already synced by incremental
      // per-turn updates (productionOutcome, conversationRun, discussion
      // point coverage, etc.)
      await this.saveScript(script);
```

- [ ] **Step 5: Update persistSpeech (legacy engine path) to match**

`persistSpeech` (line 773-798) is used by the `legacy` engine's turn loop.
For symmetry (so `script show <id>` reflects live progress regardless of
engine), add the same incremental update after the speech is pushed. Find
the line pushing to `script.speeches` inside `persistSpeech` (around line
798-800, `if (!script.speeches.some(...)) { script.speeches.push(speech); }`)
and add immediately after it:

```ts
      script.speeches.push(speech);
      await this.scriptRepository.update(script.id, {
        speechIds: script.speeches.map((accepted) => accepted.id),
      });
```

(No optional-chaining needed here — `persistSpeech` is a `ScriptService`
method, so `this.scriptRepository` is always the real, required constructor
dependency, not the newly-optional one on `MastraScriptWorkflowRunner`.)

- [ ] **Step 6: Run both tests to verify they pass**

Run: `npx vitest run src/services/MastraScriptWorkflowRunner.test.ts src/services/ScriptService.test.ts`
Expected: PASS (all tests, including the pre-existing ones — `saveNewScript`/
`saveScript`'s split must not change behavior for the non-incremental
callers already covered by existing tests)

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add src/services/ScriptService.ts src/services/MastraScriptWorkflowRunner.ts src/services/ScriptService.test.ts src/services/MastraScriptWorkflowRunner.test.ts
git commit -m "feat: save the script record incrementally during generation"
```

---

### Task 4: Detect resumability

**Files:**
- Modify: `src/services/ScriptService.ts` (`assertCanResume` at line 162)
- Test: `src/services/ScriptService.test.ts`

**Interfaces:**
- Consumes: `ScriptRecord.conversationRun` (`{ engine, flowVersion,
  workflowRunId }`, existing), `ScriptRecord.productionOutcome?.completionReason`
  (existing field, newly meaningful here).
- Produces: `ScriptService.assertCanResume(scriptId: string): Promise<void>`
  (signature unchanged from today — the `requestedEngine` parameter is
  dropped since phase 1 only ever resumes with the Mastra engine; throws a
  distinct `Error` for each ineligible case, resolves for eligible scripts).

- [ ] **Step 1: Write failing tests for each eligibility branch**

Add to `src/services/ScriptService.test.ts`:

```ts
describe("assertCanResume", () => {
  it("throws when the script has no conversation workflow metadata", async () => {
    // ...construct scriptService with a scriptRepository whose getById
    // resolves a record with conversationRun: undefined...
    await expect(scriptService.assertCanResume("script-1")).rejects.toThrow(
      "Script has no resumable conversation workflow metadata"
    );
  });

  it("throws for a legacy-engine script", async () => {
    // ...record with conversationRun: { engine: "legacy", flowVersion: "legacy-script-service-v1", workflowRunId: "run-1" }, productionOutcome: { completionReason: "turn_selection_failed", status: "complete_with_omissions", omittedPointIds: [] }...
    await expect(scriptService.assertCanResume("script-1")).rejects.toThrow(
      "Resume is not supported for the legacy engine"
    );
  });

  it("throws when the script completed normally", async () => {
    // ...record with conversationRun: { engine: "mastra", ... }, productionOutcome: { completionReason: "duration limit", status: "complete", omittedPointIds: [] }...
    await expect(scriptService.assertCanResume("script-1")).rejects.toThrow(
      "Script completed normally — nothing to resume"
    );
  });

  it("resolves for a script force-closed by repeated turn-selection failure", async () => {
    // ...record with conversationRun: { engine: "mastra", ... }, productionOutcome: { completionReason: "turn_selection_failed", status: "complete_with_omissions", omittedPointIds: [] }...
    await expect(scriptService.assertCanResume("script-1")).resolves.toBeUndefined();
  });
});
```

(Use whatever pattern the rest of `ScriptService.test.ts` already uses to
fake `scriptRepository` — a `{ getById: vi.fn().mockResolvedValue(record) }`
stub passed into the same `ScriptService` constructor call the neighboring
tests use.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/ScriptService.test.ts -t "assertCanResume"`
Expected: FAIL — current `assertCanResume` takes a required second
`requestedEngine` argument and never checks `productionOutcome`, so the
"completed normally" and "resolves" cases don't match current behavior.

- [ ] **Step 3: Rewrite assertCanResume**

Replace the current implementation (`src/services/ScriptService.ts:162-187`):

```ts
  async assertCanResume(scriptId: string): Promise<void> {
    const record = await this.scriptRepository.getById(scriptId);
    if (!record) {
      throw new Error(`Script with id ${scriptId} not found`);
    }
    if (!record.conversationRun) {
      throw new Error(
        `Script ${scriptId} has no resumable conversation workflow metadata`
      );
    }
    if (record.conversationRun.engine !== "mastra") {
      throw new Error(
        `Resume is not supported for the legacy engine (script ${scriptId})`
      );
    }
    if (record.productionOutcome?.completionReason !== "turn_selection_failed") {
      throw new Error(
        `Script completed normally — nothing to resume (script ${scriptId})`
      );
    }
  }
```

This drops the `requestedEngine` parameter and the
`assertConversationRunCompatible` call entirely — phase 1 only ever resumes
with the engine the script already used (`mastra`), so there is no
"requested a different engine" case to validate against. Remove the now-
unused `assertConversationRunCompatible` import from
`src/services/ScriptService.ts`'s import block (line 53) — check with `grep
-n assertConversationRunCompatible src/services/*.ts` first in case
`conversation-engine.test.ts` still exercises the standalone function
directly (it does, and that test is unaffected by this change — only the
unused *import* in `ScriptService.ts` should be removed, not the exported
function itself in `conversation-engine.ts`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/ScriptService.test.ts -t "assertCanResume"`
Expected: PASS

- [ ] **Step 5: Run the full test suite to check for callers of the old signature**

Run: `npx vitest run`
Expected: PASS. If any test calls `assertCanResume(id, "mastra")` with two
arguments, update the call site to drop the second argument (TypeScript's
extra-argument checking will also catch this at the type-check step).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/services/ScriptService.ts src/services/ScriptService.test.ts
git commit -m "feat: detect scripts eligible for resume"
```

---

### Task 5: Add resume() to the conversation engine interfaces

**Files:**
- Modify: `src/services/conversation-engine.ts`
- Test: `src/services/conversation-engine.test.ts`

**Interfaces:**
- Produces: `ConversationWorkflowEngine.resume(request:
  ConversationGenerationRequest): Promise<ConversationGenerationResult>`
  (new method on the existing interface), `MastraEpisodeRunner.resume(request:
  ConversationGenerationRequest): Promise<PodcastScript>` (new method on the
  existing interface). `LegacyConversationWorkflowEngine.resume` throws.
  `MastraConversationWorkflowEngine.resume` delegates to
  `this.runner.resume(request)`, mirroring how `generate` delegates to
  `this.runner.run(request)`.
- Consumes: nothing new — same `ConversationGenerationRequest` shape
  `generate` already takes.

- [ ] **Step 1: Write a failing test**

Add to `src/services/conversation-engine.test.ts`:

```ts
describe("resume", () => {
  it("LegacyConversationWorkflowEngine.resume throws", async () => {
    const engine = new LegacyConversationWorkflowEngine(vi.fn());
    await expect(
      engine.resume({
        script: {} as any,
        params: {} as any,
        workflowRunId: "run-1",
      })
    ).rejects.toThrow("Resume is not supported for the legacy engine");
  });

  it("MastraConversationWorkflowEngine.resume delegates to the runner's resume method", async () => {
    const resumedScript = { id: "script-1" } as any;
    const runner = { run: vi.fn(), resume: vi.fn().mockResolvedValue(resumedScript) };
    const engine = new MastraConversationWorkflowEngine(runner);
    const request = { script: {} as any, params: {} as any, workflowRunId: "run-1" };

    const result = await engine.resume(request);

    expect(runner.resume).toHaveBeenCalledWith(request);
    expect(result.script).toBe(resumedScript);
    expect(result.metadata.engine).toBe(ConversationWorkflowEngineName.Mastra);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/services/conversation-engine.test.ts -t "resume"`
Expected: FAIL — `resume` doesn't exist on either class yet (TypeScript
compile error surfaces as a test failure/run failure).

- [ ] **Step 3: Add resume() to both interfaces and both implementations**

In `src/services/conversation-engine.ts`, add to the `ConversationWorkflowEngine`
interface (line 25-31):

```ts
export interface ConversationWorkflowEngine {
  readonly name: ConversationWorkflowEngineName;
  readonly flowVersion: string;
  generate(
    request: ConversationGenerationRequest
  ): Promise<ConversationGenerationResult>;
  resume(
    request: ConversationGenerationRequest
  ): Promise<ConversationGenerationResult>;
}
```

Add to `LegacyConversationWorkflowEngine` (after the existing `generate`
method, line 45-57):

```ts
  async resume(
    _request: ConversationGenerationRequest
  ): Promise<ConversationGenerationResult> {
    throw new Error("Resume is not supported for the legacy engine");
  }
```

Add to `MastraEpisodeRunner` interface (line 60-62):

```ts
export interface MastraEpisodeRunner {
  run(request: ConversationGenerationRequest): Promise<PodcastScript>;
  resume(request: ConversationGenerationRequest): Promise<PodcastScript>;
}
```

Add to `MastraConversationWorkflowEngine` (after the existing `generate`
method, line 74-86):

```ts
  async resume(
    request: ConversationGenerationRequest
  ): Promise<ConversationGenerationResult> {
    const script = await this.runner.resume(request);
    return {
      script,
      metadata: {
        engine: this.name,
        flowVersion: this.flowVersion,
        workflowRunId: request.workflowRunId,
      },
    };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/services/conversation-engine.test.ts -t "resume"`
Expected: PASS

Note: this task makes `MastraScriptWorkflowRunner` (which implements
`MastraEpisodeRunner`) fail to type-check until Task 6 adds its `resume`
method — that's expected and resolved by the next task, not a regression to
fix here.

- [ ] **Step 5: Commit**

```bash
git add src/services/conversation-engine.ts src/services/conversation-engine.test.ts
git commit -m "feat: add resume() to the conversation engine interfaces"
```

---

### Task 6: Implement MastraScriptWorkflowRunner.resume()

**Files:**
- Modify: `src/services/MastraScriptWorkflowRunner.ts`
- Test: `src/services/MastraScriptWorkflowRunner.test.ts`

**Interfaces:**
- Consumes: `SpeechRepository.delete(id): Promise<boolean>` (existing,
  `src/repositories/SpeechRepository.ts:84`), `Speech.closingStage` (Task 1),
  `PodcastScript.maxDuration`/`maxTurns` (Task 2), `this.run(request)`
  (existing method on the same class — `resume` reuses it directly).
- Produces: `MastraScriptWorkflowRunner.resume(request:
  ConversationGenerationRequest): Promise<PodcastScript>`.

**Design note carried over from the spec:** rather than re-running only the
turn-loop portion of the workflow, `resume()` prepares the script (strips the
fabricated closing, clears stale outcome/omission state) and then calls this
class's own `run()` with a *fresh* `workflowRunId` and a *reduced* budget —
it does not reuse the original `workflowRunId`. Two things make this safe:

1. `run()`'s `ensurePlan()` closure (line ~198-203) only calls
   `director.createPodcastPlan()` when `!planReady` — `planReady` is a local
   variable that starts `false` on every call to `run()`, including this
   reused call. Since a *fresh* script always starts with
   `discussionPoints: []` while a *resumed* script already has them
   populated from its first run, gate the plan-creation call on that
   existing state instead of only on `planReady`, so a resumed script's
   already-established plan (discussion points, conversation beats, speaker
   role assignments, editorial cards) isn't regenerated and duplicated.
2. Reusing `run()`'s exact turn-loop/closing-sequence/persistence machinery
   means Task 1's `closingStage` tagging and Task 3's incremental
   `scriptRepository` updates apply automatically to resumed turns with no
   separate code path to keep in sync.

Already-generated speeches keep their original idempotency keys (scoped to
the *original* `workflowRunId`, untouched by this resume) — only newly
generated turns get keys scoped to the fresh `workflowRunId`, so there's no
possibility of an idempotency-key collision between the two runs.

- [ ] **Step 1: Write a failing integration test**

Add to `src/services/MastraScriptWorkflowRunner.test.ts`, a new test in the
`describe("MastraScriptWorkflowRunner")` block. This models a script that
already has a plan and one accepted speech from a "previous run", then
resumes it, asserting: (a) no plan-recreation call, (b) the prior speech is
untouched, (c) new turns get appended.

```ts
  it("resume() continues an already-planned script without regenerating its plan or duplicating prior speeches", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "tweedy-mastra-resume-")
    );
    tempDirectories.push(directory);
    const speaker = {
      id: "speaker-1",
      slug: "host",
      name: "Host",
      personality: "curious host",
      voice: {
        id: "voice-1",
        name: "Voice",
        description: "",
        provider: VocalProviderName.ElevenLabs,
        providerId: "provider-1",
        settings: {},
      },
      voiceStyle: "natural",
    };
    const priorSpeech = {
      id: "prior-speech-1",
      speaker,
      message: "An earlier accepted turn from the original run.",
      instructions: "natural",
      voice: speaker.voice,
      voiceStyle: speaker.voiceStyle,
      timestamp: new Date("2026-08-04T00:00:00.000Z"),
      stopReason: "stop" as const,
      tool: SpeakerAgentToolName.SPEAK,
    };
    const fakeClosingSpeech = {
      id: "fake-closing-1",
      speaker,
      message: "A fabricated sign-off from the failed original run.",
      instructions: "natural",
      voice: speaker.voice,
      voiceStyle: speaker.voiceStyle,
      timestamp: new Date("2026-08-04T00:00:01.000Z"),
      stopReason: "stop" as const,
      tool: SpeakerAgentToolName.CLOSING_STATEMENT,
      closingStage: "sign_off" as const,
    };
    const script = {
      id: "script-under-test",
      title: "Resumed episode",
      description: "",
      speakers: [speaker],
      speeches: [priorSpeech, fakeClosingSpeech],
      materials: [],
      discussionPoints: [
        { id: "point-1", text: "Already-planned point", covered: true },
      ],
      conversationBeats: [
        { id: "beat-1", purpose: "welcome", goal: "welcome", covered: true },
      ],
      speakerRoleAssignments: {
        "speaker-1": {
          epistemicRole: EpistemicRole.InformedHost,
          sourceAccess: SourceAccess.PreparedCards,
          uncertaintyStyle: UncertaintyStyle.Exploratory,
        },
      },
      productionOutcome: {
        status: "complete_with_omissions" as const,
        completionReason: "turn_selection_failed",
        omittedPointIds: ["point-2"],
      },
      audienceProfile: AudienceProfile.General,
      maxDuration: 600,
      maxTurns: 10,
      createdAt: new Date("2026-08-04T00:00:00.000Z"),
      updatedAt: new Date("2026-08-04T00:00:01.000Z"),
    };
    const speech = {
      message: "A distinct new closing thought.",
      instructions: "natural",
      voice: speaker.voice,
      voiceStyle: speaker.voiceStyle,
      timestamp: new Date("2026-08-04T00:01:00.000Z"),
      stopReason: "stop" as const,
    };
    speakerSpeak.mockImplementation(async (...args) => ({
      ...speech,
      speaker,
      tool:
        args[2]?.isFinalTurn === true
          ? SpeakerAgentToolName.CLOSING_STATEMENT
          : SpeakerAgentToolName.SPEAK,
    }));
    directorReview.mockImplementation(async (candidate) => ({
      ...candidate,
      message:
        candidate.tool === SpeakerAgentToolName.CLOSING_STATEMENT
          ? `${candidate.message} Thanks for listening, and until next time.`
          : `Reviewer improved: ${candidate.message}`,
    }));
    directorComplete.mockResolvedValue(false);
    directorChoose.mockResolvedValue({
      speaker,
      direction: "sign off",
      timeStatus: "",
      forceNearlyOutOfTime: false,
      requestSummary: true,
      isFinalTurn: true,
      turnBrief: undefined,
    });
    const deletedSpeechIds: string[] = [];
    const speechRepository = {
      createOrReturn: vi.fn(async (record, idempotencyKey) => ({
        ...record,
        id: `speech-${idempotencyKey}`,
        idempotencyKey,
      })),
      delete: vi.fn(async (id: string) => {
        deletedSpeechIds.push(id);
        return true;
      }),
    };
    const runner = new MastraScriptWorkflowRunner(
      speechRepository as any,
      { addMaterials: vi.fn() } as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        storagePath: path.join(directory, "workflow.db"),
        tracePath: path.join(directory, "traces.jsonl"),
      },
      undefined,
      { evaluate: vi.fn().mockResolvedValue({ accepted: true }) } as any,
      {
        audit: vi.fn().mockResolvedValue([]),
        rewrite: vi.fn(),
        attachObservability: vi.fn(),
      } as any
    );

    const result = await runner.resume({
      script: script as any,
      params: {
        title: script.title,
        description: "",
        speakers: [speaker],
        materials: [],
        maxTurns: script.maxTurns,
        maxDuration: script.maxDuration,
        allocation: SpeakerAllocation.Sequential,
      },
      workflowRunId: "run-original",
    });

    // The fabricated closing turn is gone, replaced by real continuation.
    expect(result.speeches.find((s) => s.id === "fake-closing-1")).toBeUndefined();
    expect(deletedSpeechIds).toContain("fake-closing-1");
    // The real prior turn survives untouched.
    expect(result.speeches[0].id).toBe("prior-speech-1");
    // New turns were appended.
    expect(result.speeches.length).toBeGreaterThan(1);
    // Plan was not regenerated — createPodcastPlan was never called because
    // the script already had discussion points.
    expect(directorCreatePlan).not.toHaveBeenCalled();
    // Stale outcome/omission state was cleared before continuing.
    expect(result.productionOutcome?.completionReason).not.toBe(
      "turn_selection_failed"
    );
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/services/MastraScriptWorkflowRunner.test.ts -t "resume() continues"`
Expected: FAIL — `runner.resume` doesn't exist yet.

- [ ] **Step 3: Guard plan creation on already-existing plan state**

In `run()`'s `ensurePlan` closure (line 198-203):

```ts
    const ensurePlan = async () => {
      if (!planReady) {
        if (!script.discussionPoints || script.discussionPoints.length === 0) {
          await director.createPodcastPlan();
        }
        planReady = true;
      }
    };
```

- [ ] **Step 4: Implement resume()**

Add a new public method after `run()` (after line 662, before the closing
brace of the class):

```ts
  async resume(request: ConversationGenerationRequest): Promise<PodcastScript> {
    const { script, params, workflowRunId: originalWorkflowRunId } = request;

    // Strip the fabricated closing sequence: walk back from the end while
    // each speech carries a closingStage, deleting those persisted records.
    while (
      script.speeches.length > 0 &&
      script.speeches[script.speeches.length - 1].closingStage
    ) {
      const removed = script.speeches.pop()!;
      if (removed.id) {
        await this.speechRepository.delete(removed.id);
      }
    }

    // Clear the stale forced-close outcome and any discussion points it
    // marked omitted, so the director treats them as still open.
    script.productionOutcome = undefined;
    for (const point of script.discussionPoints ?? []) {
      if (point.omissionReason === "turn_selection_failed") {
        point.omitted = false;
        point.omissionReason = undefined;
      }
    }

    // Approximate the remaining budget: the original/overridden target minus
    // what the surviving (non-closing) speeches already used. Turn/duration
    // limits are a safety ceiling, not the primary completion signal (that's
    // director.isConversationComplete + discussion-point coverage, both of
    // which read the real script state directly) — so this only needs to be
    // approximately right, not exact.
    const wordsPerMinute = 150;
    const usedDurationSeconds = script.speeches.reduce(
      (total, speech) =>
        total +
        (speech.message.trim().split(/\s+/).filter(Boolean).length /
          wordsPerMinute) *
          60,
      0
    );
    const remainingMaxTurns = Math.max(
      1,
      params.maxTurns - script.speeches.length
    );
    const remainingMaxDuration = Math.max(
      60,
      Math.round(params.maxDuration - usedDurationSeconds)
    );

    const freshWorkflowRunId = `${originalWorkflowRunId}-resume-${Date.now()}`;

    return this.run({
      script,
      params: {
        ...params,
        maxTurns: remainingMaxTurns,
        maxDuration: remainingMaxDuration,
      },
      workflowRunId: freshWorkflowRunId,
    });
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/services/MastraScriptWorkflowRunner.test.ts -t "resume() continues"`
Expected: PASS

- [ ] **Step 6: Run the full test file to check for regressions**

Run: `npx vitest run src/services/MastraScriptWorkflowRunner.test.ts`
Expected: PASS (the Task 1 and Task 3 tests, and the original "runs the
typed workflow" test, must all still pass — Step 3's `ensurePlan` change
must not affect a fresh script, which always starts with
`discussionPoints: []`)

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add src/services/MastraScriptWorkflowRunner.ts src/services/MastraScriptWorkflowRunner.test.ts
git commit -m "feat: implement MastraScriptWorkflowRunner.resume()"
```

---

### Task 7: ScriptService.resumeScript()

**Files:**
- Modify: `src/services/ScriptService.ts`
- Test: `src/services/ScriptService.test.ts`

**Interfaces:**
- Consumes: `assertCanResume` (Task 4), `loadScriptFromRecord` (existing,
  line 799), `this.conversationEngineSelector.resolve(...)` (existing),
  `engine.resume(request)` (Task 5), `saveScript` (Task 3's update variant).
- Produces: `ScriptService.resumeScript(scriptId: string, overrides?: {
  provider?: AiProviderName; maxDuration?: number; maxTurns?: number }):
  Promise<PodcastScript>`. Task 8's CLI command calls this directly.

- [ ] **Step 1: Write a failing test**

Add to `src/services/ScriptService.test.ts`:

```ts
describe("resumeScript", () => {
  it("resumes an eligible script through the mastra engine with overrides applied", async () => {
    // ...reuse the module's existing fake-repository/fake-engine-selector
    // construction pattern...
    const resumedScript = { id: "script-1", speeches: [] } as any;
    const mastraEngine = {
      name: "mastra",
      flowVersion: "mastra-episode-v1",
      generate: vi.fn(),
      resume: vi.fn().mockResolvedValue({
        script: resumedScript,
        metadata: { engine: "mastra", flowVersion: "mastra-episode-v1", workflowRunId: "run-1-resume-123" },
      }),
    };
    const conversationEngineSelector = { resolve: vi.fn().mockReturnValue(mastraEngine) };
    // ...construct scriptService with this conversationEngineSelector and a
    // scriptRepository.getById stub resolving an eligible record (engine:
    // "mastra", productionOutcome.completionReason: "turn_selection_failed",
    // maxDuration: 600, maxTurns: 10)...

    const result = await scriptService.resumeScript("script-1", {
      provider: AiProviderName.OpenAI,
      maxDuration: 900,
    });

    expect(mastraEngine.resume).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          provider: AiProviderName.OpenAI,
          maxDuration: 900,
          maxTurns: 10, // unmodified override falls back to the persisted value
        }),
      })
    );
    expect(result).toBe(resumedScript);
  });

  it("rejects an ineligible script before calling the engine", async () => {
    // ...scriptRepository.getById resolves a record with no conversationRun...
    await expect(scriptService.resumeScript("script-1", {})).rejects.toThrow(
      "has no resumable conversation workflow metadata"
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/ScriptService.test.ts -t "resumeScript"`
Expected: FAIL — `resumeScript` doesn't exist yet.

- [ ] **Step 3: Implement resumeScript**

Add to `src/services/ScriptService.ts`, after `assertCanResume` (after line
187):

```ts
  async resumeScript(
    scriptId: string,
    overrides: {
      provider?: AiProviderName;
      maxDuration?: number;
      maxTurns?: number;
    }
  ): Promise<PodcastScript> {
    await this.assertCanResume(scriptId);
    const script = await this.getScript(scriptId);
    const engine = this.conversationEngineSelector.resolve(
      ConversationWorkflowEngineName.Mastra
    );
    const params: GenerateScriptParams = {
      title: script.title,
      description: script.description,
      guidance: script.guidance,
      speakers: script.speakers,
      materials: script.materials,
      maxTurns: overrides.maxTurns ?? script.maxTurns ?? 60,
      maxDuration: overrides.maxDuration ?? script.maxDuration ?? 600,
      allocation: SpeakerAllocation.Sequential,
      audienceProfile: script.audienceProfile,
      provider: overrides.provider,
    };
    const workflowRunId =
      script.conversationRun?.workflowRunId ?? script.createdAt.toISOString();
    const resumed = await engine.resume({ script, params, workflowRunId });
    Object.assign(script, resumed.script);
    script.conversationRun = resumed.metadata;
    await this.saveScript(script);
    return script;
  }
```

Add `AiProviderName` and `SpeakerAllocation` to the existing `import { ... }
from "../types";` block at the top of the file if not already present (check
line 1-16 — `AudienceProfile` is already imported from the same block, add
the two missing names alongside it).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/ScriptService.test.ts -t "resumeScript"`
Expected: PASS

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/services/ScriptService.ts src/services/ScriptService.test.ts
git commit -m "feat: add ScriptService.resumeScript"
```

---

### Task 8: CLI command `tweedy script resume <id>`

**Files:**
- Modify: `src/cli/commands/ScriptCommands.ts`

**Interfaces:**
- Consumes: `scriptService.resumeScript(id, overrides)` (Task 7).

No automated test for this task — `ScriptCommands.ts` has no existing CLI-
level test suite to extend (its sibling commands like `delete <id>` are
untested at that layer too); verify manually per Step 2.

- [ ] **Step 1: Add the command**

In `src/cli/commands/ScriptCommands.ts`, add after the `delete <id>` command
(after line 297, before `return scriptCommand;` at line 299):

```ts
  scriptCommand
    .command("resume <id>")
    .description(
      "Resume a script that was force-closed early due to repeated AI-provider failures"
    )
    .option(
      "--provider <name>",
      `AI provider override for the continuation (${Object.values(AiProviderName).join(", ")})`
    )
    .option("--max-duration <duration>", "Override the target duration in seconds")
    .option("--max-turns <turns>", "Override the target turn count")
    .action(async (id, options) => {
      try {
        logger.progress("Resuming script...");
        const script = await scriptService.resumeScript(id, {
          provider: options.provider as AiProviderName | undefined,
          maxDuration: options.maxDuration
            ? parseInt(options.maxDuration)
            : undefined,
          maxTurns: options.maxTurns ? parseInt(options.maxTurns) : undefined,
        });
        logger.success(`Script resumed: ${script.title}`);
        console.log(`\nScript Details:`);
        console.log(`  ID: ${script.id}`);
        console.log(`  Speeches: ${script.speeches.length}`);
      } catch (error) {
        logger.error("Failed to resume script:", error);
      }
    });
```

Add `AiProviderName` to the existing `import { ... } from "../../types";`
block at the top of the file (line 13-17, alongside `AudienceProfile`).

- [ ] **Step 2: Manually verify against a real force-closed script**

Run: `npx tsc --noEmit` (confirm the CLI file itself compiles)

If a script with `productionOutcome.completionReason === "turn_selection_failed"`
exists in this environment's `data/scripts/`, run:

```bash
npx tsx src/index.ts script resume <that-script-id> --provider openai
```

Expected: logs "Resuming script...", then "Script resumed: <title>" with a
speech count higher than before. If no such script exists locally, instead
verify the eligibility guard fires correctly on any existing normally-
completed script id:

```bash
npx tsx src/index.ts script resume <any-completed-script-id>
```

Expected: `Failed to resume script: Error: Script completed normally — nothing to resume (script <id>)`

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/ScriptCommands.ts
git commit -m "feat: add tweedy script resume CLI command"
```

---

## Self-Review Notes

- **Spec coverage:** every section of `docs/superpowers/specs/2026-08-04-script-resume-design.md`
  maps to a task — detection (Task 4), incremental persistence (Task 3),
  original-limits persistence (Task 2), closing-stage marking (Task 1), CLI
  surface (Task 8), resume execution flow (Tasks 5-7), edge cases (Task 4's
  branch tests cover "no metadata"/"legacy"/"completed normally"; the
  "resume fails again" edge case needs no special code, per the spec, so no
  task exists for it — confirmed intentional, not a gap).
- **Refinement over the spec, not a contradiction:** the spec's Section 4
  described reusing the *same* `workflowRunId` for resumed turns. Tracing
  `episode-workflow.ts`'s `initialise-episode` step during planning revealed
  that `state.turnsUsed`/`elapsedDurationEstimateSeconds` always reset to 0
  on a fresh `run.start()` regardless of `workflowRunId` reuse, and that
  reusing an already-`"success"`-completed `workflowRunId` with Mastra's
  `run.start()` (not `run.resume()`) is unverified/risky. Task 6 instead
  uses a fresh derived `workflowRunId` and compensates with a reduced
  turn/duration budget — same outcome (no duplicated persisted speeches, an
  appropriately-bounded continuation), safer mechanism. This is called out
  explicitly in Task 6's design note rather than silently diverging from the
  approved spec.
- **Placeholder scan:** no TBD/TODO; every step has literal code, not a
  description of code.
- **Type consistency:** `closingStage` is spelled identically across Task 1
  (`Speech`/`SpeechRecord`), Task 6 (read in `resume()`'s strip loop). `
  resumeScript`'s overrides object shape (`provider`/`maxDuration`/`maxTurns`)
  matches Task 8's CLI option parsing exactly.
