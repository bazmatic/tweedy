# Director-Chosen Speaker Order Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `ScriptService`'s hardcoded round-robin speaker rotation with a director decision, made every turn, that picks both who speaks next and what direction to give them.

**Architecture:** `DirectorAgent` gains `chooseNextSpeaker(script)`, which uses a forced tool-call (same pattern as `SpeakerAgent`'s tool-use calls) to have Claude pick a `speakerId` from the current speaker list and produce `direction` text in one round trip. `ScriptService.generateScriptContent` drops `currentSpeakerIndex` and calls `chooseNextSpeaker` each turn instead.

**Tech Stack:** TypeScript, `@anthropic-ai/sdk` (existing `tool_choice: { type: "any" }` forced tool-call pattern already used in `BaseAgent.callClaudeWithTools` / `SpeakerAgent`).

**No test framework exists in this repo** (no jest/vitest, no `test` script, zero `*.test.ts` files anywhere). Adding one is out of scope for this change — introducing test infra is a separate decision for the user to make deliberately, not a side effect of this feature. Verification in this plan instead relies on `npm run build` (strict `tsc` compilation) plus a manual dry-run script that stubs the Anthropic client, matching the verification rigor already implicit in the existing codebase.

---

## Chunk 1: Generic tool-input calling + director tool schema

### Task 1: Add a generic tool-input method to `BaseAgent`

**Files:**
- Modify: `src/agents/BaseAgent.ts`

`BaseAgent.callClaudeWithTools` (lines 35-68) is hardcoded to parse `{ message, style }` out of the tool-use response, which is specific to `SpeakerAgent`'s tools. The director needs a different shape (`{ speakerId, direction }`), so we need a generic version underneath both.

- [ ] **Step 1: Add `callClaudeForToolInput<T>` below the existing `callClaudeWithTools` method**

```ts
  protected async callClaudeForToolInput<T>(
    messages: Anthropic.MessageParam[],
    tools: Anthropic.Tool[],
    maxTokens: number = 200
  ): Promise<T> {
    try {
      const response = await this.client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: maxTokens,
        messages,
        tools,
        tool_choice: { type: "any" },
      });

      const toolUseBlock = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      if (!toolUseBlock) {
        throw new Error("Claude response did not include a tool_use block");
      }

      return toolUseBlock.input as T;
    } catch (error) {
      logger.error("Claude tool-use API call failed:", error);
      throw error;
    }
  }
```

- [ ] **Step 2: Refactor `callClaudeWithTools` to reuse it, removing the duplicated request/parse logic**

Replace the body of `callClaudeWithTools` with a call into the new generic method, keeping its own error handling:

```ts
  protected async callClaudeWithTools(
    messages: Anthropic.MessageParam[],
    tools: Anthropic.Tool[],
    maxTokens: number = 200
  ): Promise<{ toolName: string; message: string; style: string }> {
    try {
      const response = await this.client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: maxTokens,
        messages,
        tools,
        tool_choice: { type: "any" },
      });

      const toolUseBlock = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      if (!toolUseBlock) {
        throw new Error("Claude response did not include a tool_use block");
      }

      const input = toolUseBlock.input as { message: string; style: string };

      return {
        toolName: toolUseBlock.name,
        message: input.message,
        style: input.style,
      };
    } catch (error) {
      logger.error("Claude tool-use API call failed:", error);
      throw error;
    }
  }
```

Note: this keeps `callClaudeWithTools`'s request/parse logic exactly as it was — it is **not** rewritten to call `callClaudeForToolInput` internally, because `callClaudeWithTools` needs both `toolUseBlock.name` and `toolUseBlock.input`, while `callClaudeForToolInput` only returns `.input`. Leave both methods standing side by side with their own duplicated request logic; unifying them isn't worth the added indirection for one extra field. `callClaudeForToolInput` is purely additive.

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/agents/BaseAgent.ts
git commit -m "refactor: extract generic tool-input calling method on BaseAgent"
```

---

### Task 2: Define the director's tool schema

**Files:**
- Create: `src/agents/director-tools.ts`

This mirrors `src/agents/speaker-tools.ts`'s shape but for the director's "pick next speaker" decision.

- [ ] **Step 1: Write the file**

```ts
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { Speaker } from "../types";

export const SELECT_NEXT_SPEAKER_TOOL_NAME = "select_next_speaker";

export interface SelectNextSpeakerInput {
  speakerId: string;
  direction: string;
}

export function toSelectNextSpeakerTool(speakers: Speaker[]): Tool {
  return {
    name: SELECT_NEXT_SPEAKER_TOOL_NAME,
    description:
      "Choose which speaker should talk next and give them direction for their turn.",
    input_schema: {
      type: "object",
      properties: {
        speakerId: {
          type: "string",
          enum: speakers.map((speaker) => speaker.id),
          description: "The id of the speaker who should talk next.",
        },
        direction: {
          type: "string",
          description:
            "Clear, specific, conversational direction for what this speaker should say next.",
        },
      },
      required: ["speakerId", "direction"],
    },
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/agents/director-tools.ts
git commit -m "feat: add select-next-speaker tool schema for DirectorAgent"
```

---

## Chunk 2: DirectorAgent and interface changes

### Task 3: Update `IDirectorAgent` interface

**Files:**
- Modify: `src/types/index.ts:265-268`

- [ ] **Step 1: Replace the `giveDirection` method signature**

Change:

```ts
export interface IDirectorAgent {
  createPodcastPlan(script: PodcastScript): Promise<string>;
  giveDirection(speakerAgent: ISpeakerAgent): Promise<string>;
}
```

to:

```ts
export interface IDirectorAgent {
  createPodcastPlan(script: PodcastScript): Promise<string>;
  chooseNextSpeaker(
    script: PodcastScript
  ): Promise<{ speaker: Speaker; direction: string }>;
}
```

Note `ISpeakerAgent` is no longer referenced by `IDirectorAgent`, but it doesn't need to be removed from anywhere — it's defined in this same file (around line 261) as its own interface, not imported, and stays there unchanged for `SpeakerAgent` to implement.

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: TypeScript errors in `src/agents/DirectorAgent.ts` (it still implements the old signature) and `src/services/ScriptService.ts` (still calls `giveDirection`). This is expected — both are fixed in the next tasks.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "refactor: change IDirectorAgent to choose the next speaker, not just direction"
```

---

### Task 4: Rewrite `DirectorAgent.giveDirection` as `chooseNextSpeaker`

**Files:**
- Modify: `src/agents/DirectorAgent.ts`

- [ ] **Step 1: Update imports at the top of the file**

Replace:

```ts
import { IDirectorAgent, PodcastScript, ISpeakerAgent } from '../types';
import { BaseAgent } from './BaseAgent';
import { logger } from '../utils/logger';
```

with:

```ts
import { IDirectorAgent, PodcastScript, Speaker } from '../types';
import { BaseAgent } from './BaseAgent';
import { logger } from '../utils/logger';
import {
  SelectNextSpeakerInput,
  toSelectNextSpeakerTool,
} from './director-tools';
```

- [ ] **Step 2: Replace the `giveDirection` method (lines 55-87) with `chooseNextSpeaker`**

```ts
  async chooseNextSpeaker(
    script: PodcastScript
  ): Promise<{ speaker: Speaker; direction: string }> {
    try {
      this.logAgentAction('Choosing next speaker');

      const progress = this.calculateProgress(script);
      const history = this.getConversationHistory(script);
      const speakerDescriptions = script.speakers
        .map(
          (speaker) =>
            `- ${speaker.name} (id: ${speaker.id}, ${
              speaker.isExpert ? 'expert' : 'interviewer'
            }): ${speaker.personality}`
        )
        .join('\n');

      const messages = [
        {
          role: 'user' as const,
          content: `You are directing a podcast. Here's the current situation:

Podcast Plan: ${this.podcastPlan}

Progress: ${progress}% complete

Speakers:
${speakerDescriptions}

Conversation so far:
${history || '(nothing said yet — this is the opening of the episode)'}

Decide which speaker should talk next and give them clear, specific, conversational direction about what they should say. On the opening of the episode, this should usually be the interviewer.${this.getPacingNote(
            script
          )}`
        }
      ];

      const tools = [toSelectNextSpeakerTool(script.speakers)];
      const { speakerId, direction } =
        await this.callClaudeForToolInput<SelectNextSpeakerInput>(
          messages,
          tools,
          300
        );

      const speaker = script.speakers.find((s) => s.id === speakerId);
      if (!speaker) {
        logger.warn(
          `Director chose unknown speakerId "${speakerId}"; falling back to alternating speaker`
        );
        return {
          speaker: this.fallbackSpeaker(script),
          direction,
        };
      }

      logger.debug(`Director chose ${speaker.name}: ${direction}`);
      return { speaker, direction };
    } catch (error) {
      logger.error('Failed to choose next speaker:', error);
      throw error;
    }
  }

  private fallbackSpeaker(script: PodcastScript): Speaker {
    const lastSpeaker = script.speeches[script.speeches.length - 1]?.speaker;
    const eligible = script.speakers.filter((s) => s.id !== lastSpeaker?.id);
    if (eligible.length === 0) {
      return script.speakers[0];
    }
    return eligible[Math.floor(Math.random() * eligible.length)];
  }
```

- [ ] **Step 3: Update `calculateProgress`, `getPacingNote`, and `getConversationHistory` to take `script` as a parameter**

These currently read `this.script`, which we're keeping (it's still set in the constructor and used by `createPodcastPlan`), but `chooseNextSpeaker` above calls them as `this.calculateProgress(script)` / `this.getPacingNote(script)` / `this.getConversationHistory(script)` for clarity that they operate on the script passed in per-call rather than only the constructor-time one (in practice it's the same object mutated in place by `ScriptService`, but making the dependency explicit avoids confusion). Update all three signatures:

```ts
  private calculateProgress(script: PodcastScript): number {
    const totalExpectedTurns = script.speeches.length;
    const currentTurns = script.speeches.length;
    return Math.min(100, Math.round((currentTurns / totalExpectedTurns) * 100));
  }

  private getPacingNote(script: PodcastScript): string {
    const recentSpeeches = script.speeches.slice(-3);
    if (recentSpeeches.length === 0) {
      return '';
    }

    const averageLength =
      recentSpeeches.reduce((sum, speech) => sum + speech.message.length, 0) /
      recentSpeeches.length;

    if (averageLength > 150) {
      return ' The last few turns have been long explanations — direct this speaker to give a short, punchy reaction or a quick pointed question instead of another lengthy point.';
    }

    return '';
  }

  private getConversationHistory(script: PodcastScript): string {
    return script.speeches
      .slice(-5) // Last 5 speeches
      .map(speech => `${speech.speaker.name}: ${speech.message}`)
      .join('\n');
  }
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run build`
Expected: no errors in `DirectorAgent.ts`. `ScriptService.ts` will still fail (fixed next task).

- [ ] **Step 5: Commit**

```bash
git add src/agents/DirectorAgent.ts
git commit -m "feat: DirectorAgent chooses next speaker via forced tool call"
```

---

## Chunk 3: ScriptService loop + manual verification

### Task 5: Update `ScriptService.generateScriptContent`

**Files:**
- Modify: `src/services/ScriptService.ts:157-196`

- [ ] **Step 1: Replace the round-robin loop**

Change:

```ts
    const directorAgent = new DirectorAgent(script);
    await directorAgent.createPodcastPlan();

    let currentSpeakerIndex = 0;
    const INTERJECTION_LENGTH_THRESHOLD = 150;
    const INTERJECTION_CHANCE = 0.5;

    for (let turn = 0; turn < params.maxTurns; turn++) {
      const speaker = script.speakers[currentSpeakerIndex];
      const speakerAgent = new SpeakerAgent(speaker);

      const direction = await directorAgent.giveDirection(speakerAgent);
      const speech = await speakerAgent.speak(script, direction);
      await this.persistSpeech(script, speech);

      currentSpeakerIndex = (currentSpeakerIndex + 1) % script.speakers.length;

      // If that turn ran long, let the next speaker chime in with a quick
      // reaction before their real, director-guided turn — real overlap
      // instead of relying on the speaker to self-select a short tool.
      const ranLong =
        speech.tool === SpeakerAgentToolName.SPEAK &&
        speech.message.length > INTERJECTION_LENGTH_THRESHOLD;

      if (
        ranLong &&
        script.speakers.length > 1 &&
        Math.random() < INTERJECTION_CHANCE
      ) {
        const interjector = script.speakers[currentSpeakerIndex];
        const interjectionAgent = new SpeakerAgent(interjector);
        const interjection = await interjectionAgent.interject(script);
        await this.persistSpeech(script, interjection);
      }
    }
```

to:

```ts
    const directorAgent = new DirectorAgent(script);
    await directorAgent.createPodcastPlan();

    const INTERJECTION_LENGTH_THRESHOLD = 150;
    const INTERJECTION_CHANCE = 0.5;

    for (let turn = 0; turn < params.maxTurns; turn++) {
      const { speaker, direction } = await directorAgent.chooseNextSpeaker(
        script
      );
      const speakerAgent = new SpeakerAgent(speaker);

      const speech = await speakerAgent.speak(script, direction);
      await this.persistSpeech(script, speech);

      // If that turn ran long, let a different speaker chime in with a quick
      // reaction before the director picks the next real turn — real overlap
      // instead of relying on the speaker to self-select a short tool.
      const ranLong =
        speech.tool === SpeakerAgentToolName.SPEAK &&
        speech.message.length > INTERJECTION_LENGTH_THRESHOLD;

      if (
        ranLong &&
        script.speakers.length > 1 &&
        Math.random() < INTERJECTION_CHANCE
      ) {
        const eligibleInterjectors = script.speakers.filter(
          (s) => s.id !== speaker.id
        );
        const interjector =
          eligibleInterjectors[
            Math.floor(Math.random() * eligibleInterjectors.length)
          ];
        const interjectionAgent = new SpeakerAgent(interjector);
        const interjection = await interjectionAgent.interject(script);
        await this.persistSpeech(script, interjection);
      }
    }
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: no TypeScript errors anywhere in the project.

- [ ] **Step 3: Commit**

```bash
git add src/services/ScriptService.ts
git commit -m "feat: use director's speaker choice instead of round-robin rotation"
```

---

### Task 6: Manual dry-run verification

There's no test framework in this repo, so verification here is a manual, deterministic dry run using a stubbed Anthropic client — no real API key or network call needed, and no dependency on test infra decisions.

**Files:**
- Create (temporary, not committed): `/private/tmp/claude-501/-Users-barryearsman-projects-tweedy/20c7360b-7b9b-4794-a2ab-9b5f12a3b8c0/scratchpad/verify-director-choice.ts`

- [ ] **Step 1: Write the dry-run script**

```ts
import { DirectorAgent } from "../../src/agents/DirectorAgent"; // adjust relative path if run from scratchpad
```

Since this script needs to stub `BaseAgent.callClaudeForToolInput` (which hits the real Anthropic API), the simplest approach is to run it with `ts-node` from the project root and monkey-patch the prototype method before constructing the agent:

```ts
// verify-director-choice.ts — run with:
// ANTHROPIC_API_KEY=dummy npx ts-node docs-verify/verify-director-choice.ts
// (place this file temporarily anywhere under the project root so relative imports resolve)

import { DirectorAgent } from "./src/agents/DirectorAgent";
import { BaseAgent } from "./src/agents/BaseAgent";
import { PodcastScript, VocalProviderName } from "./src/types";

// Stub out the network call: always "pick" the interviewer with a canned direction.
(BaseAgent.prototype as any).callClaudeForToolInput = async () => ({
  speakerId: "interviewer-1",
  direction: "Open the episode by welcoming the guest.",
});
(BaseAgent.prototype as any).callClaude = async () => "A simple test plan.";

const script: PodcastScript = {
  id: "s1",
  title: "Test Episode",
  description: "A test",
  speakers: [
    {
      id: "interviewer-1",
      name: "Jordan",
      personality: "Curious host who asks probing questions",
      voice: {
        id: "v1",
        name: "Voice1",
        description: "",
        provider: VocalProviderName.OpenAI,
        providerId: "v1",
        settings: {},
      },
      voiceStyle: "neutral",
      isExpert: false,
    },
    {
      id: "expert-1",
      name: "Dr. Rivera",
      personality: "Domain expert who explains complex topics simply",
      voice: {
        id: "v2",
        name: "Voice2",
        description: "",
        provider: VocalProviderName.OpenAI,
        providerId: "v2",
        settings: {},
      },
      voiceStyle: "neutral",
      isExpert: true,
    },
  ],
  speeches: [],
  materials: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function main() {
  const director = new DirectorAgent(script);
  await director.createPodcastPlan();
  const { speaker, direction } = await director.chooseNextSpeaker(script);
  console.log("Chosen speaker:", speaker.name);
  console.log("Direction:", direction);

  if (speaker.id !== "interviewer-1") {
    throw new Error("Expected the stub to select the interviewer");
  }
  console.log("PASS: chooseNextSpeaker returned the stubbed selection.");
}

main();
```

- [ ] **Step 2: Run it**

Run: `ANTHROPIC_API_KEY=dummy npx ts-node verify-director-choice.ts` (from the project root, with the file placed there temporarily)
Expected output includes:
```
Chosen speaker: Jordan
Direction: Open the episode by welcoming the guest.
PASS: chooseNextSpeaker returned the stubbed selection.
```

- [ ] **Step 3: Also verify the fallback path**

Temporarily change the stub's `speakerId` to `"nonexistent-id"`, and remove the `if (speaker.id !== "interviewer-1") throw ...` check (the fallback is random between the two speakers here, since `script.speeches` is empty and both are eligible). Re-run and confirm:
- A warning is logged: `Director chose unknown speakerId "nonexistent-id"; falling back to alternating speaker`
- The script does not throw, and `speaker` is one of Jordan or Dr. Rivera (not undefined)

- [ ] **Step 4: Delete the temporary verification script**

```bash
rm verify-director-choice.ts
```

Do not commit it — it's a manual check, not part of the shipped codebase.

- [ ] **Step 5: Final full build check**

Run: `npm run build`
Expected: clean build, no errors.

---

## Done criteria

- `IDirectorAgent.giveDirection` is gone; `chooseNextSpeaker` is the only way `ScriptService` decides who talks and what they're told.
- `ScriptService.generateScriptContent` has no `currentSpeakerIndex` variable.
- `npm run build` passes with no TypeScript errors.
- Manual dry run (Task 6) confirms both the happy path and the unknown-speakerId fallback behave as designed.
