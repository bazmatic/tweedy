# Speaker Prompt Structure & Retry-Feedback Segregation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `MastraScriptWorkflowRunner`'s retry path from duplicating rejection feedback into both `direction` and `turnBrief.goal`, and reorganize `SpeakerAgent`'s prompt so retry feedback, director guidance, turn brief, and the trailing rules block are clearly labeled and non-overlapping instead of one run-on paragraph.

**Architecture:** Add a `retryFeedback?: string` field to `SpeakerTurnOptions`, threaded from a new pure `buildRetryFeedback()` helper in `MastraScriptWorkflowRunner` (which quotes the previously rejected candidate's message) through to a new labeled section in `SpeakerAgent`'s prompt. Separately, extract the prompt's trailing instruction paragraph into a `buildRulesSection()` method that groups the same rules under four headers (Audience & Accessibility, Length & Delivery, Conversational Style, Formatting) with no wording changes.

**Tech Stack:** TypeScript, Vitest.

## Global Constraints

- No change to `DirectorAgent`/`TurnReviewerAgent` prompts.
- No collapsing of `direction`/`turnBrief.goal` when they happen to already match outside the repair path — `toTurnBrief`'s `goal: input.goal ?? direction` default (`DirectorAgent.ts:1807`) is untouched.
- No literal JSON blob format — sections stay labeled prose.
- No change to `ScriptService` (the legacy, non-Mastra engine) — it has no repair/retry loop.
- Every existing rule sentence in the trailing instructions block must survive verbatim, just regrouped under headers.

---

### Task 1: Add `retryFeedback` to `SpeakerTurnOptions`

**Files:**
- Modify: `src/types/index.ts` (the `SpeakerTurnOptions` interface, currently ~line 792-801)

**Interfaces:**
- Produces: `SpeakerTurnOptions.retryFeedback?: string` — consumed by Task 2 (set it) and Task 3 (render it).

- [ ] **Step 1: Add the field**

In `src/types/index.ts`, find:

```ts
export interface SpeakerTurnOptions {
  timeStatus?: string;
  forceNearlyOutOfTime?: boolean;
  forceColdOpen?: boolean;
  requestSummary?: boolean;
  isFinalTurn?: boolean;
  turnBrief?: TurnBrief;
  editorialCards?: EditorialCard[];
  centralAnalogy?: string;
  episodeRecap?: string;
}
```

Replace with:

```ts
export interface SpeakerTurnOptions {
  timeStatus?: string;
  forceNearlyOutOfTime?: boolean;
  forceColdOpen?: boolean;
  requestSummary?: boolean;
  isFinalTurn?: boolean;
  turnBrief?: TurnBrief;
  editorialCards?: EditorialCard[];
  centralAnalogy?: string;
  episodeRecap?: string;
  /** Feedback on the speaker's own previously rejected attempt at this exact
   * turn, quoting what it said. Distinct from `direction`/`turnBrief.goal`,
   * which stay as the director originally set them. */
  retryFeedback?: string;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no errors — this is an additive optional field).

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "Add retryFeedback field to SpeakerTurnOptions"
```

---

### Task 2: Stop duplicating rejection feedback in `MastraScriptWorkflowRunner`

**Files:**
- Modify: `src/services/MastraScriptWorkflowRunner.ts` (`RecurringRejection` interface ~line 112, `SelectedTurn` interface ~line 46, `repairTurn` ~line 286-319, `generateCandidate` ~line 342-384)
- Test: `src/services/MastraScriptWorkflowRunner.test.ts`

**Interfaces:**
- Consumes: `SpeakerTurnOptions.retryFeedback` (Task 1).
- Produces: exported `buildRetryFeedback(rejectionReason: string, rejectedMessage: string | undefined, recurring: RecurringRejection | undefined): string` — a pure function, unit-testable in isolation. `SelectedTurn.retryFeedback?: string` — read by `generateCandidate`, written by `repairTurn`.

- [ ] **Step 1: Export `RecurringRejection` and write the failing unit tests for `buildRetryFeedback`**

In `src/services/MastraScriptWorkflowRunner.ts`, change:

```ts
interface RecurringRejection {
```

to:

```ts
export interface RecurringRejection {
```

In `src/services/MastraScriptWorkflowRunner.test.ts`, add to the existing import from `"./MastraScriptWorkflowRunner"` (currently `findRecurringRejection, MastraScriptWorkflowRunner`):

```ts
import {
  buildRetryFeedback,
  findRecurringRejection,
  MastraScriptWorkflowRunner,
} from "./MastraScriptWorkflowRunner";
```

Add a new describe block (after the existing `describe("findRecurringRejection", ...)` block, before `describe("MastraScriptWorkflowRunner", ...)`):

```ts
describe("buildRetryFeedback", () => {
  it("frames the rejection as feedback on the speaker's own previous attempt and quotes it", () => {
    const feedback = buildRetryFeedback(
      "108 suitors appear without being introduced to the listener",
      "There were 108 suitors waiting for her.",
      undefined
    );

    expect(feedback).toContain("Your previous attempt at this turn was rejected");
    expect(feedback).toContain(
      "108 suitors appear without being introduced to the listener"
    );
    expect(feedback).toContain('"There were 108 suitors waiting for her."');
    expect(feedback).not.toContain("Director");
  });

  it("omits the quote when no previous message is available", () => {
    const feedback = buildRetryFeedback("Some rejection reason", undefined, undefined);

    expect(feedback).toContain("Some rejection reason");
    expect(feedback).not.toContain("What you said");
  });

  it("demands a substantively different fix when the same problem is recurring", () => {
    const feedback = buildRetryFeedback(
      "108 suitors appear without being introduced to the listener",
      "There were 108 suitors waiting for her.",
      {
        reason: "108 suitors appear without being introduced to the listener",
        occurrences: 3,
      }
    );

    expect(feedback).toContain("failed 3 attempts in a row");
    expect(feedback).toContain("change what information you lead with");
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/services/MastraScriptWorkflowRunner.test.ts -t "buildRetryFeedback"`
Expected: FAIL — `buildRetryFeedback` is not exported / not defined.

- [ ] **Step 3: Implement `buildRetryFeedback`**

In `src/services/MastraScriptWorkflowRunner.ts`, add the function directly after `findRecurringRejection` (after its closing `}` at line 129):

```ts
export function buildRetryFeedback(
  rejectionReason: string,
  rejectedMessage: string | undefined,
  recurring: RecurringRejection | undefined
): string {
  const quoted = rejectedMessage ? ` What you said: "${rejectedMessage}".` : "";
  return recurring
    ? `Your previous attempt at this turn was rejected: ${rejectionReason}.${quoted} This same problem has now failed ${recurring.occurrences} attempts in a row, each time in different wording — rephrasing alone has not worked. Make a substantively different fix: change what information you lead with or how you frame it, not just the phrasing.`
    : `Your previous attempt at this turn was rejected: ${rejectionReason}.${quoted} Revise to fix that specific problem while keeping the same goal — don't just reword it.`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/MastraScriptWorkflowRunner.test.ts -t "buildRetryFeedback"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/MastraScriptWorkflowRunner.ts src/services/MastraScriptWorkflowRunner.test.ts
git commit -m "Add buildRetryFeedback helper for speaker retry feedback"
```

- [ ] **Step 6: Write the failing integration test for the repair-path wiring**

Add this test inside the existing `describe("MastraScriptWorkflowRunner", ...)` block in `src/services/MastraScriptWorkflowRunner.test.ts`, after the existing `it("runs the typed workflow and returns the normal PodcastScript domain", ...)` test.

First, extend the top-of-file import from `"../types"` to include the enums needed for a `TurnBrief`:

```ts
import {
  AudienceProfile,
  AudienceValue,
  EditorialMove,
  EnergyLevel,
  EpistemicRole,
  SourceAccess,
  SpeakerAllocation,
  UncertaintyStyle,
  VocalProviderName,
} from "../types";
```

Then add the test:

```ts
  it("gives a repaired turn its own retry-feedback field instead of duplicating rejection text into direction/turnBrief.goal", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "tweedy-mastra-runner-retry-")
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
    const script = {
      id: "",
      title: "Mastra episode",
      description: "",
      speakers: [speaker],
      speeches: [],
      materials: [],
      discussionPoints: [],
      audienceProfile: AudienceProfile.General,
      createdAt: new Date("2026-07-30T00:00:00.000Z"),
      updatedAt: new Date("2026-07-30T00:00:00.000Z"),
    };
    const speech = {
      id: "",
      speaker,
      instructions: "natural",
      voice: speaker.voice,
      voiceStyle: speaker.voiceStyle,
      timestamp: new Date("2026-07-30T00:00:01.000Z"),
      stopReason: "stop" as const,
      tool: SpeakerAgentToolName.CLOSING_STATEMENT,
    };
    // Must satisfy the real EpisodeConclusionPolicy.hasFinalSignOff check
    // (unmocked in this test) on every attempt, so the only rejection in
    // play is the one this test controls via claimEditorialGate below —
    // otherwise a real "no sign-off detected" rejection could interleave
    // unpredictably with the controlled one.
    let generatedSpeechNumber = 0;
    speakerSpeak.mockImplementation(async () => {
      generatedSpeechNumber += 1;
      return {
        ...speech,
        message: `Attempt ${generatedSpeechNumber}: thanks for listening, and until next time.`,
      };
    });
    directorReview.mockImplementation(async (candidate) => candidate);
    directorComplete.mockResolvedValue(false);
    const turnBrief = {
      speakerId: speaker.id,
      goal: "Land the reflective close.",
      move: EditorialMove.Reframe,
      cardIds: [],
      audienceValue: AudienceValue.Connection,
      desiredEnergy: EnergyLevel.Reflective,
    };
    directorChoose.mockResolvedValue({
      speaker,
      direction: "sign off",
      timeStatus: "",
      forceNearlyOutOfTime: false,
      requestSummary: false,
      isFinalTurn: true,
      turnBrief,
    });
    let evaluateCallCount = 0;
    const claimEditorialGate = {
      evaluate: vi.fn().mockImplementation(async () => {
        evaluateCallCount += 1;
        return evaluateCallCount === 1
          ? { accepted: false, reason: "Too abrupt for a closing statement." }
          : { accepted: true };
      }),
    };
    const knowledgeLedgerPolicy = {
      createLedger: () => ({ introducedCards: [] }),
      getAccessibleCards: () => [],
      recordAcceptedTurn: () => {},
    };
    const runner = new MastraScriptWorkflowRunner(
      { createOrReturn: vi.fn(async (record, idempotencyKey) => ({
          ...record,
          id: `speech-${idempotencyKey}`,
          idempotencyKey,
        })) } as any,
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
      claimEditorialGate as any,
      {
        audit: vi.fn().mockResolvedValue([]),
        rewrite: vi.fn(),
        attachObservability: vi.fn(),
      } as any
    );

    await runner.run({
      script,
      params: {
        title: script.title,
        description: "",
        speakers: [speaker],
        materials: [],
        maxTurns: 1,
        maxDuration: 60,
        allocation: SpeakerAllocation.Sequential,
      },
      workflowRunId: "run-retry",
    });

    const firstCallOptions = speakerSpeak.mock.calls[0][2];
    const secondCallOptions = speakerSpeak.mock.calls[1][2];

    expect(speakerSpeak.mock.calls[0][1]).toBe("sign off");
    expect(speakerSpeak.mock.calls[1][1]).toBe("sign off");
    expect(firstCallOptions.turnBrief.goal).toBe("Land the reflective close.");
    expect(secondCallOptions.turnBrief.goal).toBe("Land the reflective close.");
    expect(firstCallOptions.retryFeedback).toBeUndefined();
    expect(secondCallOptions.retryFeedback).toContain(
      "Your previous attempt at this turn was rejected"
    );
    expect(secondCallOptions.retryFeedback).toContain(
      "Too abrupt for a closing statement."
    );
    expect(secondCallOptions.retryFeedback).toContain(
      '"Attempt 1: thanks for listening, and until next time."'
    );
  });
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run src/services/MastraScriptWorkflowRunner.test.ts -t "gives a repaired turn"`
Expected: FAIL — `secondCallOptions.retryFeedback` is `undefined` (repair path doesn't set it yet), and/or `turnBrief.goal` differs between calls (today's code appends `retryGuidance` onto it).

- [ ] **Step 8: Implement the repair-path change**

In `src/services/MastraScriptWorkflowRunner.ts`:

Add `retryFeedback?: string;` to the `SelectedTurn` interface (~line 46-55):

```ts
interface SelectedTurn {
  speaker: Speaker;
  direction: string;
  timeStatus: string;
  forceNearlyOutOfTime: boolean;
  requestSummary: boolean;
  isFinalTurn: boolean;
  turnBrief?: TurnBrief;
  openingTurn: OpeningTurn | null;
  retryFeedback?: string;
}
```

Replace the `repairTurn` implementation (currently `MastraScriptWorkflowRunner.ts:286-319`):

```ts
      repairTurn: async (state, proposal) => {
        if (advancedAfterRepeatedRejection.delete(keyFor(proposal))) {
          return { ...proposal, wasRepaired: true };
        }
        if (state.consecutiveRejectedTurns === 0) return proposal;
        const selected = selectedTurns.get(keyFor(proposal));
        const rejectionReason = state.warnings.at(-1);
        if (!selected || !rejectionReason) return proposal;
        const rejectedMessage = generatedSpeeches.get(keyFor(proposal))?.message;
        const recurring = findRecurringRejection(state.warnings);
        const retryFeedback = buildRetryFeedback(
          rejectionReason,
          rejectedMessage,
          recurring && recurring.reason === rejectionReason ? recurring : undefined
        );
        selectedTurns.set(keyFor(proposal), {
          ...selected,
          retryFeedback,
        });
        return {
          ...proposal,
          wasRepaired: true,
        };
      },
```

(Note: `direction` and `turnBrief.goal` are no longer touched — `selected` keeps its original values, only `retryFeedback` is added.)

In `generateCandidate` (`MastraScriptWorkflowRunner.ts:367-383`), add `retryFeedback` to the options object passed to `speak`:

```ts
          speech = await speakerAgent.speak(script, selected.direction, {
            timeStatus: selected.timeStatus,
            forceNearlyOutOfTime: selected.forceNearlyOutOfTime,
            forceColdOpen: selected.openingTurn?.forceColdOpen ?? false,
            requestSummary: selected.requestSummary,
            isFinalTurn: selection.isFinalTurn,
            turnBrief: selected.turnBrief,
            editorialCards: this.knowledgeLedgerPolicy.getAccessibleCards(
              selected.speaker,
              script.editorialCards ?? [],
              script.knowledgeLedger ??
                this.knowledgeLedgerPolicy.createLedger(),
              selected.turnBrief?.cardIds ?? []
            ),
            centralAnalogy: script.centralAnalogy,
            episodeRecap: this.recapPolicy.buildRecap(script),
            retryFeedback: selected.retryFeedback,
          });
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/services/MastraScriptWorkflowRunner.test.ts`
Expected: PASS (all tests in the file, including the pre-existing "runs the typed workflow..." test — it doesn't touch retry, so it should be unaffected).

- [ ] **Step 10: Commit**

```bash
git add src/services/MastraScriptWorkflowRunner.ts src/services/MastraScriptWorkflowRunner.test.ts
git commit -m "Stop duplicating rejection feedback into direction/turnBrief.goal"
```

---

### Task 3: Restructure `SpeakerAgent`'s prompt

**Files:**
- Modify: `src/agents/SpeakerAgent.ts` (`speak()` ~line 121-157, `generateSpeech()` ~line 274-436)
- Test: `src/agents/SpeakerAgent.test.ts`

**Interfaces:**
- Consumes: `SpeakerTurnOptions.retryFeedback` (Task 1), populated by `MastraScriptWorkflowRunner` (Task 2).
- Produces: no new public interface — this task only changes prompt text and adds two private methods (`buildRetryFeedbackSection`, `buildRulesSection`) used internally by `generateSpeech`.

- [ ] **Step 1: Write the failing tests**

Add to `src/agents/SpeakerAgent.test.ts`, inside a new `describe` block placed after the existing `describe("SpeakerAgent central analogy", ...)` block:

```ts
describe("SpeakerAgent retry feedback", () => {
  it("renders retry feedback in its own labeled section without duplicating it elsewhere", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "A calmer version of the same point.",
      style: "calm",
      stopReason: "stop",
    });
    const script = makeScript();

    await agent.speak(script, "Tell the story.", {
      retryFeedback:
        'Your previous attempt at this turn was rejected: Too abrupt. What you said: "That\'s it, we\'re done." Revise to fix that specific problem while keeping the same goal — don\'t just reword it.',
    });

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    const occurrences = prompt.split("Your previous attempt at this turn was rejected").length - 1;
    expect(occurrences).toBe(1);
    expect(prompt).toContain("Revision note:");
    expect(prompt).toContain('That\'s it, we\'re done.');
  });

  it("omits the retry feedback section entirely when absent", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "hello there",
      style: "calm",
      stopReason: "stop",
    });
    const script = makeScript();

    await agent.speak(script, "talk about x");

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(prompt).not.toContain("Revision note:");
  });
});

describe("SpeakerAgent rules section grouping", () => {
  it("groups accessibility, length, style, and formatting rules under distinct headers", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    const call = vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "hello there",
      style: "calm",
      stopReason: "stop",
    });
    const script = makeScript();

    await agent.speak(script, "talk about x");

    const prompt = (call.mock.calls[0][1] as any)[0].content as string;
    const accessibilityIndex = prompt.indexOf("## Audience & Accessibility");
    const lengthIndex = prompt.indexOf("## Length & Delivery");
    const styleIndex = prompt.indexOf("## Conversational Style");
    const formattingIndex = prompt.indexOf("## Formatting");

    expect(accessibilityIndex).toBeGreaterThan(-1);
    expect(lengthIndex).toBeGreaterThan(accessibilityIndex);
    expect(styleIndex).toBeGreaterThan(lengthIndex);
    expect(formattingIndex).toBeGreaterThan(styleIndex);
    expect(prompt.slice(formattingIndex)).toContain(
      "never use markdown emphasis"
    );
    expect(prompt.slice(styleIndex, formattingIndex)).toContain(
      "Use Australian/British spelling"
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/agents/SpeakerAgent.test.ts -t "retry feedback"`
Run: `npx vitest run src/agents/SpeakerAgent.test.ts -t "rules section grouping"`
Expected: FAIL — `retryFeedback` isn't read from options yet, and there are no `##`-style headers in the prompt yet.

- [ ] **Step 3: Add `retryFeedback` plumbing and the two new section builders**

In `src/agents/SpeakerAgent.ts`, add `SpeakerRoleProfile` to the import from `"../types"` (currently starting at line 1):

```ts
import {
  AudienceProfile,
  ConversationalDevice,
  ISpeakerAgent,
  EditorialCard,
  EpistemicRole,
  LlmMessage,
  PodcastScript,
  Speech,
  Speaker,
  SourceAccess,
  SpeakerRoleProfile,
  SpeakerTurnOptions,
  StopReason,
  TerminologyLedger,
  TurnBrief,
} from "../types";
```

In `speak()` (`SpeakerAgent.ts:121-157`), add `retryFeedback` to both destructurings:

```ts
  async speak(
    script: PodcastScript,
    direction: string,
    options: SpeakerTurnOptions = {}
  ): Promise<Speech> {
    const {
      timeStatus = "",
      forceNearlyOutOfTime = false,
      forceColdOpen = false,
      requestSummary = false,
      isFinalTurn = false,
      turnBrief,
      editorialCards = [],
      centralAnalogy,
      episodeRecap,
      retryFeedback,
    } = options;
    let attempts = 0;

    while (attempts < this.maxAttempts) {
      try {
        this.logAgentAction("Generating speech", {
          speaker: this.speaker.name,
          attempt: attempts + 1,
        });

        const { toolName, message, style, stopReason } =
          await this.generateSpeech(script, direction, {
            timeStatus,
            forceNearlyOutOfTime,
            forceColdOpen,
            requestSummary,
            isFinalTurn,
            turnBrief,
            editorialCards,
            centralAnalogy,
            episodeRecap,
            retryFeedback,
          });
```

(The rest of `speak()` is unchanged.)

In `generateSpeech()` (`SpeakerAgent.ts:274-302`), add `retryFeedback` to the options destructuring:

```ts
    const {
      timeStatus = "",
      forceNearlyOutOfTime = false,
      forceColdOpen = false,
      requestSummary = false,
      isFinalTurn = false,
      turnBrief,
      editorialCards = [],
      centralAnalogy,
      episodeRecap,
      retryFeedback,
    } = options;
```

Replace the main template literal's assembly (`SpeakerAgent.ts:400-436`) — the `messages` array — with:

```ts
    const messages: LlmMessage[] = [
      {
        role: "user" as const,
        content: `You are ${
          this.speaker.name
        }, a podcast speaker with the following characteristics:
- Personality: ${this.speaker.personality}
- Voice Style: ${this.speaker.voiceStyle}
- Epistemic Role: ${roleProfile.epistemicRole}
- Source Access: ${roleProfile.sourceAccess}
- Uncertainty Style: ${roleProfile.uncertaintyStyle}
- Audience Profile: ${audienceProfile}${this.mannerismsLine()}
- You are speaking as ${this.speaker.name} ONLY — never refer to yourself in the second person or address yourself by your own name.${
          coHostNames
            ? ` Your co-host${coHosts.length > 1 ? "s are" : " is"} ${coHostNames}.`
            : ""
        }

Podcast Context:
- Title: ${title}${recapSection}

Conversation History (speaker: message [tool used]):
${conversationHistory}${materialsSection}

${direction ? `Here is some guidance from the Director. Only you can hear him. Listen to what he says and incorporate it naturally into the conversation if you can. DIRECTOR GUIDANCE: ${direction}` : "No specific director's guidance for this turn — continue the conversation naturally in character."}${this.getHandoffGuidance(speeches.at(-1))}${this.getBridgingGuidance(speeches.at(-1), isFinalTurn)}${this.buildRetryFeedbackSection(retryFeedback)}${editorialSection}${analogySection}${
          timeStatus && !isFinalTurn
            ? forceNearlyOutOfTime
              ? `\n\nTime status: ${timeStatus} You must use the nearly_out_of_time tool this turn to tell your co-hosts you're running low on time.`
              : `\n\nTime status: ${timeStatus} If it fits naturally, you can use the nearly_out_of_time tool to flag the time to your co-hosts.`
            : ""
        }${closingPromptAddendum}

Respond naturally as ${
          this.speaker.name
        }. Choose the response style tool that best fits this moment in the conversation, and provide both the spoken message and a delivery style for it.${this.buildRulesSection(
          isSolo,
          roleProfile,
          turnBrief,
          audienceProfile,
          terminologyLedger,
          lengthGuidanceWithProviderCap
        )}`,
      },
    ];
```

Add the two new private methods directly after `getBridgingGuidance` (after its closing `}` at `SpeakerAgent.ts:113`):

```ts
  private buildRetryFeedbackSection(retryFeedback?: string): string {
    return retryFeedback ? `\n\nRevision note: ${retryFeedback}` : "";
  }

  /**
   * The trailing instructions are a checklist of independent rules, not
   * prose — grouping them under headers costs nothing narratively (there was
   * no scene here to lose) and makes each rule's category legible to both
   * the model and future maintainers. Wording is unchanged from before this
   * grouping; only the layout changed.
   */
  private buildRulesSection(
    isSolo: boolean,
    roleProfile: SpeakerRoleProfile,
    turnBrief: TurnBrief | undefined,
    audienceProfile: AudienceProfile,
    terminologyLedger: TerminologyLedger,
    lengthGuidanceWithProviderCap: string
  ): string {
    return `

## Audience & Accessibility
${this.audienceAccessibilityPolicy.buildSpeakerGuidance(audienceProfile, terminologyLedger)}

## Length & Delivery
${lengthGuidanceWithProviderCap}

## Conversational Style
${this.getExpertiseNudge(isSolo, roleProfile.epistemicRole, turnBrief)} Serve the assigned audience value without forcing analysis, jokes or profundity where they do not belong. When the material offers an everyday comparison (a pet, a common habit, something the audience has personally experienced), take that as an opening for a quip, a personal anecdote or a bit of humour — don't just restate its analytical point again in your own words. Trust your co-host to ask a follow-up; don't pre-empt their next question. Don't reuse a striking phrase, metaphor or turn of phrase a co-host already said in the conversation history above — say the same idea in your own words instead of echoing theirs. Before speaking, scan the full conversation history above for any fact, comparison, analogy or illustrative example (e.g. "we still can't decode a cat's meow", "entropy is flat across species but complexity varies") that has already been raised, even if it was phrased differently — if you find one, don't re-explain or re-derive it from scratch; either build on it explicitly, reference it briefly as something already established ("like we said about the cat's meow..."), or drop it and bring a genuinely new point instead. Use Australian/British spelling. Be authentic to your personality and epistemic role. ${this.naturalSpeechStylePolicy.buildGuidance(roleProfile)}

## Formatting
Don't include stage directions, emotes, or sound effects — those belong in the style argument only. For a spoken pause or interruption, use an em dash (—), never a bare hyphen (-) — reserve the hyphen strictly for compound words. Write the message as plain spoken text only — never use markdown emphasis (*word*) or HTML tags (<em>word</em>) to mark emphasis; convey emphasis through word choice and the style argument instead, since a TTS engine reads literal markup characters aloud.`;
  }
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npx vitest run src/agents/SpeakerAgent.test.ts`
Expected: PASS — all tests in the file, including the new ones and the pre-existing ones (rule wording is preserved, so existing `.toContain(...)` assertions keep matching).

- [ ] **Step 5: Commit**

```bash
git add src/agents/SpeakerAgent.ts src/agents/SpeakerAgent.test.ts
git commit -m "Restructure SpeakerAgent prompt with labeled retry feedback and rules sections"
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 2: Run the full test suite**

Run: `pnpm test`
Expected: PASS, all test files green (573+ tests from before this change, plus the new ones added in Tasks 2 and 3).

- [ ] **Step 3: Manual prompt inspection**

Using the same kind of transcript dump that originally surfaced this problem (a `messages` array logged or printed from a real or test run that exercises a rejection/retry), confirm:
- The retry feedback appears exactly once, under "Revision note:", quoting the rejected line.
- "Director's guidance:" no longer contains any rejection text.
- The trailing rules read as four headed sections in order: Audience & Accessibility, Length & Delivery, Conversational Style, Formatting.

- [ ] **Step 4: Commit (if step 3 required any fixes)**

Only if manual inspection in Step 3 surfaced an issue requiring a code change:

```bash
git add -A
git commit -m "Fix issue found during manual prompt inspection"
```
