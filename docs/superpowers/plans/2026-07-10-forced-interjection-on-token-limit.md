# Forced Interjection on Token Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a speaker's turn is cut off by the model's token limit, force the next turn to always be a co-host interjection instead of leaving it to a length threshold + random roll.

**Architecture:** Normalize each AI provider's raw stop/finish reason into a shared `StopReason` value inside `BaseAgent.callModelWithTools`, thread it through `SpeakerAgent` onto the `Speech` object, extract the existing inline interjection decision in `ScriptService` into a small testable pure function that now also checks `stopReason`, and persist the field on `SpeechRecord`.

**Tech Stack:** TypeScript, LangChain (`@langchain/anthropic`, `@langchain/openai`), Vitest.

## Global Constraints

- `stopReason` is optional everywhere (`Speech`, `SpeechRecord`) — must stay backward-compatible with existing JSON records that lack it.
- No behavior change to the probabilistic (non-truncated) interjection path — `INTERJECTION_LENGTH_THRESHOLD = 80`, `INTERJECTION_CHANCE = 0.8` unchanged.
- No cascading forced interjections — an interjection's own turn hitting the token limit does not trigger another forced interjection.
- Not fixing the pre-existing gap where `speech.tool` is never persisted to/read from `SpeechRecord` — out of scope.

---

### Task 1: Normalize provider stop reason in `BaseAgent`

**Files:**
- Modify: `src/types/index.ts` (add `StopReason` type)
- Modify: `src/agents/BaseAgent.ts:97-184` (add `normalizeStopReason`, wire into `callModelWithTools`)
- Test: `src/agents/BaseAgent.test.ts` (new)

**Interfaces:**
- Produces: `export type StopReason = "max_tokens" | "stop" | "tool_use" | "unknown";` (in `src/types/index.ts`)
- Produces: `export function normalizeStopReason(metadata: Record<string, unknown> | undefined): StopReason` (exported from `src/agents/BaseAgent.ts`)
- Produces: `callModelWithTools` now resolves to `{ toolName: string; message: string; style: string; stopReason: StopReason }` (previously had no `stopReason` field)

- [ ] **Step 1: Write the failing test for `normalizeStopReason`**

Create `src/agents/BaseAgent.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeStopReason } from "./BaseAgent";

describe("normalizeStopReason", () => {
  it("maps Anthropic's max_tokens stop_reason to max_tokens", () => {
    expect(normalizeStopReason({ stop_reason: "max_tokens" })).toBe(
      "max_tokens"
    );
  });

  it("maps Anthropic's tool_use stop_reason to tool_use", () => {
    expect(normalizeStopReason({ stop_reason: "tool_use" })).toBe("tool_use");
  });

  it("maps Anthropic's end_turn and stop_sequence to stop", () => {
    expect(normalizeStopReason({ stop_reason: "end_turn" })).toBe("stop");
    expect(normalizeStopReason({ stop_reason: "stop_sequence" })).toBe(
      "stop"
    );
  });

  it("maps OpenAI-compatible length finish_reason to max_tokens", () => {
    expect(normalizeStopReason({ finish_reason: "length" })).toBe(
      "max_tokens"
    );
  });

  it("maps OpenAI-compatible tool_calls finish_reason to tool_use", () => {
    expect(normalizeStopReason({ finish_reason: "tool_calls" })).toBe(
      "tool_use"
    );
  });

  it("maps OpenAI-compatible stop finish_reason to stop", () => {
    expect(normalizeStopReason({ finish_reason: "stop" })).toBe("stop");
  });

  it("returns unknown for unrecognized or missing metadata", () => {
    expect(normalizeStopReason({ stop_reason: "content_filter" })).toBe(
      "unknown"
    );
    expect(normalizeStopReason(undefined)).toBe("unknown");
    expect(normalizeStopReason({})).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agents/BaseAgent.test.ts`
Expected: FAIL with "normalizeStopReason is not exported" or similar (function doesn't exist yet)

- [ ] **Step 3: Add `StopReason` type**

In `src/types/index.ts`, immediately above the `Speech` interface (around line 73), add:

```ts
export type StopReason = "max_tokens" | "stop" | "tool_use" | "unknown";
```

- [ ] **Step 4: Implement `normalizeStopReason` and wire it into `callModelWithTools`**

In `src/agents/BaseAgent.ts`, add the import and function, then update `callModelWithTools`:

```ts
import { LlmMessage, LlmTool, StopReason } from "../types";
```

Add this function right after `recoverTruncatedToolCall` (after line 113):

```ts
const MAX_TOKENS_REASONS = new Set(["max_tokens", "length"]);
const TOOL_USE_REASONS = new Set(["tool_use", "tool_calls"]);
const STOP_REASONS = new Set(["end_turn", "stop_sequence", "stop"]);

export function normalizeStopReason(
  metadata: Record<string, unknown> | undefined
): StopReason {
  const raw = (metadata?.stop_reason ?? metadata?.finish_reason) as
    | string
    | undefined;
  if (!raw) return "unknown";
  if (MAX_TOKENS_REASONS.has(raw)) return "max_tokens";
  if (TOOL_USE_REASONS.has(raw)) return "tool_use";
  if (STOP_REASONS.has(raw)) return "stop";
  return "unknown";
}
```

Update `callModelWithTools` (lines 147-184) to include `stopReason` in both the success path and the recovered-truncation path:

```ts
  protected async callModelWithTools(
    messages: LlmMessage[],
    tools: LlmTool[],
    maxTokens: number = 200
  ): Promise<{
    toolName: string;
    message: string;
    style: string;
    stopReason: StopReason;
  }> {
    try {
      const model = AiModelFactory.getModel(
        appConfig.defaultAiProvider,
        maxTokens
      );
      const response = (await model
        .bindTools!(toOpenAiTools(tools), { tool_choice: "any" })
        .invoke(toBaseMessages(messages))) as AIMessage;

      const toolCall = response.tool_calls?.[0];
      if (!toolCall) {
        const recovered = recoverTruncatedToolCall(response);
        if (recovered) {
          logger.warn(
            "Tool call truncated by the token limit; using the partial response instead of retrying"
          );
          return { ...recovered, stopReason: "max_tokens" };
        }
        throw new Error("AI model response did not include a tool call");
      }

      const input = toolCall.args as { message: string; style: string };

      return {
        toolName: toolCall.name,
        message: input.message,
        style: input.style,
        stopReason: normalizeStopReason(response.response_metadata),
      };
    } catch (error) {
      logger.error("AI model tool-use call failed:", error);
      throw error;
    }
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/agents/BaseAgent.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Run full test suite and type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All existing tests still pass; no type errors

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/agents/BaseAgent.ts src/agents/BaseAgent.test.ts
git commit -m "feat: normalize AI provider stop reason in BaseAgent"
```

---

### Task 2: Thread `stopReason` through `SpeakerAgent` onto `Speech`

**Files:**
- Modify: `src/types/index.ts` (add `stopReason` to `Speech`)
- Modify: `src/agents/SpeakerAgent.ts:28-167` (`speak`/`generateSpeech`/`interject`)
- Test: `src/agents/SpeakerAgent.test.ts` (new)

**Interfaces:**
- Consumes: `StopReason` (Task 1, `src/types/index.ts`); `callModelWithTools` now resolving with a `stopReason` field (Task 1, `src/agents/BaseAgent.ts`)
- Produces: `Speech.stopReason?: StopReason` — later tasks (3, 4) read this field

- [ ] **Step 1: Write the failing test**

Create `src/agents/SpeakerAgent.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { SpeakerAgent } from "./SpeakerAgent";
import { SpeakerAgentToolName } from "./speaker-tools";
import {
  PodcastScript,
  Speaker,
  VocalProviderName,
} from "../types";

function makeSpeaker(id: string): Speaker {
  return {
    id,
    slug: id,
    name: `Speaker ${id}`,
    personality: "curious",
    voice: {
      id: `voice-${id}`,
      name: "Voice",
      description: "",
      provider: VocalProviderName.ElevenLabs,
      providerId: "provider-id",
      settings: {},
    },
    voiceStyle: "neutral",
    isExpert: false,
  };
}

function makeScript(speeches: PodcastScript["speeches"] = []): PodcastScript {
  return {
    id: "script-1",
    title: "Test Script",
    description: "A test script",
    speakers: [makeSpeaker("s1"), makeSpeaker("s2")],
    speeches,
    materials: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("SpeakerAgent stopReason threading", () => {
  it("carries stopReason from callModelWithTools onto the Speech returned by speak()", async () => {
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.SPEAK,
      message: "hello there",
      style: "calm",
      stopReason: "max_tokens",
    });

    const speech = await agent.speak(makeScript(), "talk about x");

    expect(speech.stopReason).toBe("max_tokens");
  });

  it("carries stopReason onto the Speech returned by interject()", async () => {
    const lastSpeech = {
      id: "sp1",
      speaker: makeSpeaker("s2"),
      message: "and then...",
      instructions: "",
      voice: makeSpeaker("s2").voice,
      voiceStyle: "neutral",
      timestamp: new Date(),
      tool: SpeakerAgentToolName.SPEAK,
    };
    const agent = new SpeakerAgent(makeSpeaker("s1"));
    vi.spyOn(agent as any, "callModelWithTools").mockResolvedValue({
      toolName: SpeakerAgentToolName.INTERJECT,
      message: "wow",
      style: "surprised",
      stopReason: "stop",
    });

    const speech = await agent.interject(makeScript([lastSpeech]));

    expect(speech.stopReason).toBe("stop");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agents/SpeakerAgent.test.ts`
Expected: FAIL — `speech.stopReason` is `undefined`, not `"max_tokens"`/`"stop"`

- [ ] **Step 3: Add `stopReason` to `Speech`**

In `src/types/index.ts`, update the `Speech` interface (around line 73-82):

```ts
export interface Speech {
  id: string;
  speaker: Speaker;
  message: string;
  instructions: string;
  voice: Voice;
  voiceStyle: string;
  timestamp: Date;
  tool?: SpeakerAgentToolName;
  stopReason?: StopReason;
}
```

- [ ] **Step 4: Thread `stopReason` through `SpeakerAgent`**

In `src/agents/SpeakerAgent.ts`:

In `speak()` (lines 28-72), update the destructuring and `Speech` construction:

```ts
        const { toolName, message, style, stopReason } =
          await this.generateSpeech(script, direction);

        const speech: Speech = {
          id: this.generateId(),
          speaker: this.speaker,
          message,
          instructions: style,
          voice: this.speaker.voice,
          voiceStyle: this.speaker.voiceStyle,
          timestamp: new Date(),
          tool: toolName,
          stopReason,
        };
```

In `generateSpeech()` (lines 117-167), update the return type and the final `return`:

```ts
  private async generateSpeech(
    script: PodcastScript,
    direction: string
  ): Promise<{
    toolName: SpeakerAgentToolName;
    message: string;
    style: string;
    stopReason: StopReason;
  }> {
```

```ts
    const result = await this.callModelWithTools(
      messages,
      toLlmTools(),
      SpeakerAgent.SPEECH_MAX_TOKENS
    );

    return {
      toolName: result.toolName as SpeakerAgentToolName,
      message: result.message,
      style: result.style,
      stopReason: result.stopReason,
    };
```

In `interject()` (lines 78-115), update the `Speech` construction:

```ts
      const result = await this.callModelWithTools(
        messages,
        toLlmTools(SHORT_REACTION_TOOLS.slice(0, 2)),
        SpeakerAgent.INTERJECTION_MAX_TOKENS
      );

      return {
        id: this.generateId(),
        speaker: this.speaker,
        message: result.message,
        instructions: result.style,
        voice: this.speaker.voice,
        voiceStyle: this.speaker.voiceStyle,
        timestamp: new Date(),
        tool: result.toolName as SpeakerAgentToolName,
        stopReason: result.stopReason,
      };
```

Add `StopReason` to the type-only import at the top of the file:

```ts
import {
  ISpeakerAgent,
  LlmMessage,
  PodcastScript,
  Speech,
  Speaker,
  StopReason,
} from "../types";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/agents/SpeakerAgent.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Run full test suite and type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All tests pass; no type errors

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/agents/SpeakerAgent.ts src/agents/SpeakerAgent.test.ts
git commit -m "feat: thread stopReason from model calls onto Speech"
```

---

### Task 3: Extract interjection policy and force it on token limit

**Files:**
- Create: `src/services/interjection-policy.ts`
- Test: `src/services/interjection-policy.test.ts`
- Modify: `src/services/ScriptService.ts:162-209`

**Interfaces:**
- Consumes: `Speech.stopReason` (Task 2)
- Produces: `export const INTERJECTION_LENGTH_THRESHOLD = 80;`, `export const INTERJECTION_CHANCE = 0.8;`, `export function shouldInterject(speech: Pick<Speech, "tool" | "message" | "stopReason">, speakerCount: number, roll: number): boolean` — all exported from `src/services/interjection-policy.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/interjection-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  INTERJECTION_LENGTH_THRESHOLD,
  shouldInterject,
} from "./interjection-policy";
import { SpeakerAgentToolName } from "../agents/speaker-tools";

describe("shouldInterject", () => {
  it("always interjects when the speech hit the token limit, even if short and the roll is unfavorable", () => {
    const speech = {
      tool: SpeakerAgentToolName.SPEAK,
      message: "short",
      stopReason: "max_tokens" as const,
    };

    expect(shouldInterject(speech, 2, 0.999)).toBe(true);
  });

  it("never interjects on token limit if there is no other speaker to interject", () => {
    const speech = {
      tool: SpeakerAgentToolName.SPEAK,
      message: "short",
      stopReason: "max_tokens" as const,
    };

    expect(shouldInterject(speech, 1, 0)).toBe(false);
  });

  it("falls back to the length-and-chance roll when the speech did not hit the token limit", () => {
    const longMessage = "x".repeat(INTERJECTION_LENGTH_THRESHOLD + 1);
    const longSpeech = {
      tool: SpeakerAgentToolName.SPEAK,
      message: longMessage,
      stopReason: "stop" as const,
    };

    expect(shouldInterject(longSpeech, 2, 0.1)).toBe(true);
    expect(shouldInterject(longSpeech, 2, 0.9)).toBe(false);
  });

  it("does not interject on a short, non-truncated speech regardless of roll", () => {
    const shortSpeech = {
      tool: SpeakerAgentToolName.SPEAK,
      message: "short",
      stopReason: "stop" as const,
    };

    expect(shouldInterject(shortSpeech, 2, 0)).toBe(false);
  });

  it("does not interject on a long non-SPEAK turn regardless of roll", () => {
    const longMessage = "x".repeat(INTERJECTION_LENGTH_THRESHOLD + 1);
    const nonSpeakTurn = {
      tool: SpeakerAgentToolName.QUOTE,
      message: longMessage,
      stopReason: "stop" as const,
    };

    expect(shouldInterject(nonSpeakTurn, 2, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/interjection-policy.test.ts`
Expected: FAIL — `./interjection-policy` module does not exist

- [ ] **Step 3: Implement `interjection-policy.ts`**

Create `src/services/interjection-policy.ts`:

```ts
import { Speech } from "../types";
import { SpeakerAgentToolName } from "../agents/speaker-tools";

export const INTERJECTION_LENGTH_THRESHOLD = 80;
export const INTERJECTION_CHANCE = 0.8;

type InterjectionCandidate = Pick<Speech, "tool" | "message" | "stopReason">;

/**
 * A speech cut off by the token limit is exactly the moment a co-host
 * jumping in sounds most natural, so it always forces an interjection
 * rather than going through the length-and-chance roll.
 */
export function shouldInterject(
  speech: InterjectionCandidate,
  speakerCount: number,
  roll: number
): boolean {
  if (speakerCount <= 1) return false;

  if (speech.stopReason === "max_tokens") return true;

  const ranLong =
    speech.tool === SpeakerAgentToolName.SPEAK &&
    speech.message.length > INTERJECTION_LENGTH_THRESHOLD;

  return ranLong && roll < INTERJECTION_CHANCE;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/interjection-policy.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Wire `shouldInterject` into `ScriptService`**

In `src/services/ScriptService.ts`, add the import:

```ts
import { shouldInterject } from "./interjection-policy";
```

Replace lines 172-208 (`generateScriptContent`'s body from the `INTERJECTION_LENGTH_THRESHOLD` constants through the end of the `for` loop):

```ts
    for (let turn = 0; turn < params.maxTurns; turn++) {
      const { speaker, direction } = await directorAgent.chooseNextSpeaker(
        script
      );
      const speakerAgent = new SpeakerAgent(speaker);

      const speech = await speakerAgent.speak(script, direction);
      await this.persistSpeech(script, speech);

      // If that turn ran long — or was cut off by the token limit — let a
      // different speaker chime in with a quick reaction before the director
      // picks the next real turn — real overlap instead of relying on the
      // speaker to self-select a short tool.
      if (shouldInterject(speech, script.speakers.length, Math.random())) {
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

Note `SpeakerAgentToolName` may now be unused in `ScriptService.ts` if it isn't referenced elsewhere in the file — check with a search before removing its import.

- [ ] **Step 6: Check for now-unused import and type check**

Run: `grep -n "SpeakerAgentToolName" src/services/ScriptService.ts`

If the only remaining reference is the `import` line itself, remove that import line. Then run:

Run: `npx tsc --noEmit`
Expected: No type errors, no unused-import errors

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/services/interjection-policy.ts src/services/interjection-policy.test.ts src/services/ScriptService.ts
git commit -m "feat: force interjection when a speech hits the token limit"
```

---

### Task 4: Persist `stopReason` on `SpeechRecord`

**Files:**
- Modify: `src/types/index.ts` (add `stopReason` to `SpeechRecord`)
- Modify: `src/services/ScriptService.ts` (`persistSpeech`, `loadScriptFromRecord`)
- Test: `src/services/ScriptService.test.ts` (new)

**Interfaces:**
- Consumes: `Speech.stopReason` (Task 2), `StopReason` (Task 1)
- Produces: `SpeechRecord.stopReason?: StopReason` — no later tasks depend on this; it's the final persistence step

- [ ] **Step 1: Write the failing test**

Create `src/services/ScriptService.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ScriptService } from "./ScriptService";
import { SpeakerAgentToolName } from "../agents/speaker-tools";
import { VocalProviderName, PodcastScript } from "../types";

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
}) {
  return new ScriptService(
    {} as any,
    overrides.speakerRepository ?? ({} as any),
    overrides.materialRepository ?? ({} as any),
    overrides.voiceRepository ?? ({} as any),
    overrides.speechRepository ?? ({} as any)
  );
}

describe("ScriptService stopReason persistence", () => {
  it("persistSpeech includes stopReason when creating the SpeechRecord", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "record-1",
      speakerId: "s1",
      message: "hi",
      instructions: "calm",
      voiceId: "voice-1",
      voiceStyle: "neutral",
      timestamp: new Date(),
      stopReason: "max_tokens",
    });
    const service = makeService({ speechRepository: { create } });
    const script = makeScript();
    const speech = {
      id: "",
      speaker: {
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
        isExpert: false,
      },
      message: "hi",
      instructions: "calm",
      voice: {
        id: "voice-1",
        name: "Voice",
        description: "",
        provider: VocalProviderName.ElevenLabs,
        providerId: "p",
        settings: {},
      },
      voiceStyle: "neutral",
      timestamp: new Date(),
      tool: SpeakerAgentToolName.SPEAK,
      stopReason: "max_tokens" as const,
    };

    await (service as any).persistSpeech(script, speech);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ stopReason: "max_tokens" })
    );
  });

  it("loadScriptFromRecord reads stopReason back from the SpeechRecord", async () => {
    const speakerRepository = {
      findBySlug: vi.fn().mockResolvedValue(null),
      getById: vi.fn().mockResolvedValue({
        id: "s1",
        slug: "s1",
        name: "S1",
        personality: "",
        voiceId: "voice-1",
        voiceStyle: "neutral",
        isExpert: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };
    const voiceRepository = {
      getById: vi.fn().mockResolvedValue({
        id: "voice-1",
        name: "Voice",
        description: "",
        provider: VocalProviderName.ElevenLabs,
        providerId: "p",
        settings: {},
      }),
    };
    const materialRepository = { getById: vi.fn() };
    const speechRepository = {
      getById: vi.fn().mockResolvedValue({
        id: "record-1",
        speakerId: "s1",
        message: "hi",
        instructions: "calm",
        voiceId: "voice-1",
        voiceStyle: "neutral",
        timestamp: new Date(),
        stopReason: "max_tokens",
      }),
    };
    const service = makeService({
      speakerRepository,
      voiceRepository,
      materialRepository,
      speechRepository,
    });

    const script = await (service as any).loadScriptFromRecord({
      id: "script-1",
      title: "Test",
      description: "Test",
      speakerIds: ["s1"],
      speechIds: ["record-1"],
      materialIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(script.speeches[0].stopReason).toBe("max_tokens");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/ScriptService.test.ts`
Expected: FAIL — `create` not called with `stopReason`, and/or `script.speeches[0].stopReason` is `undefined`

- [ ] **Step 3: Add `stopReason` to `SpeechRecord`**

In `src/types/index.ts`, update `SpeechRecord` (around line 172-180):

```ts
export interface SpeechRecord {
  id: string;
  speakerId: string;
  message: string;
  instructions: string;
  voiceId: string;
  voiceStyle: string;
  timestamp: Date;
  stopReason?: StopReason;
}
```

- [ ] **Step 4: Thread `stopReason` through `persistSpeech` and `loadScriptFromRecord`**

In `src/services/ScriptService.ts`, update `persistSpeech` (lines 211-228):

```ts
  private async persistSpeech(
    script: PodcastScript,
    speech: Speech
  ): Promise<void> {
    const speechRecord = await this.speechRepository.create({
      speakerId: speech.speaker.id,
      message: speech.message,
      instructions: speech.instructions,
      voiceId: speech.voice.id,
      voiceStyle: speech.voiceStyle,
      timestamp: speech.timestamp,
      stopReason: speech.stopReason,
    });

    speech.id = speechRecord.id;

    script.speeches.push(speech);
    script.updatedAt = new Date();
  }
```

Update the speech-loading block inside `loadScriptFromRecord` (lines 242-259):

```ts
        if (speaker) {
          speeches.push({
            id: speechRecord.id,
            speaker,
            message: speechRecord.message,
            instructions: speechRecord.instructions,
            voice: speaker.voice,
            voiceStyle: speechRecord.voiceStyle,
            timestamp: speechRecord.timestamp,
            stopReason: speechRecord.stopReason,
          });
        }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/services/ScriptService.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Run full test suite and type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All tests pass; no type errors

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/services/ScriptService.ts src/services/ScriptService.test.ts
git commit -m "feat: persist stopReason on SpeechRecord"
```
