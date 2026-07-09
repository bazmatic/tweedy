# AI Provider Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the LLM layer provider-agnostic by routing all Anthropic calls through LangChain's `BaseChatModel` interface (via `ChatAnthropic`) instead of the raw `@anthropic-ai/sdk` client, mirroring the existing `IVocalProvider`/`VocalProviderFactory` pattern used for voice/TTS.

**Architecture:** A new `AiModelFactory` (in `src/providers/`) returns cached `BaseChatModel` instances keyed by provider + maxTokens. `BaseAgent`'s three Claude-specific methods (`callClaude`, `callClaudeWithTools`, `callClaudeForToolInput`) are renamed to `callModel`/`callModelWithTools`/`callModelForToolInput` and reimplemented against the factory. Tool schema definitions in `director-tools.ts`/`speaker-tools.ts` drop their `@anthropic-ai/sdk` type import in favor of a new `LlmTool` type. `DirectorAgent`/`SpeakerAgent` only need their call-site names updated.

**Tech Stack:** TypeScript, LangChain (`@langchain/core`, `@langchain/anthropic`), pnpm.

## Global Constraints

- No new automated test suite is being added — the codebase has no existing tests for the agent layer (only `audio-timeline.test.ts`, unrelated), and the design spec's Testing section explicitly calls for manual verification instead. Every task below verifies via `pnpm exec tsc --noEmit` (type-check) rather than a test run; the final task adds a manual smoke-test.
- `LlmTool.input_schema` (not a generic `schema` field) — this is Anthropic's native tool shape, which `ChatAnthropic.bindTools()` detects and passes through unchanged (verified against `@langchain/anthropic@0.2.15` source, `formatStructuredToolToAnthropic`/`isAnthropicTool`). This keeps the runtime request payload byte-identical to today.
- `AiModelFactory.getModel(provider, maxTokens)` takes `maxTokens` as a required second argument and caches by `` `${provider}:${maxTokens}` `` — `@langchain/anthropic@0.2.15` reads `max_tokens` only from the model instance's construction-time config, not from per-call invoke options, so varying `max_tokens` per call site (200/300/800/80 in the current code) requires distinct cached instances.
- Spec reference: `docs/superpowers/specs/2026-07-10-ai-provider-abstraction-design.md`.

---

### Task 1: Dependencies, shared types, and config

**Files:**
- Modify: `package.json`
- Modify: `src/types/index.ts`
- Modify: `src/utils/config.ts`

**Interfaces:**
- Produces: `AiProviderName` enum (`{ Anthropic = "anthropic" }`), `LlmMessage` interface (`{ role: "user" | "assistant" | "system"; content: string }`), `LlmTool` interface (`{ name: string; description: string; input_schema: { type: "object"; properties: Record<string, unknown>; required: string[] } }`), `AppConfig.defaultAiProvider: AiProviderName`. All later tasks import these from `../types`.

- [ ] **Step 1: Install LangChain Anthropic dependencies**

Run:
```bash
pnpm add @langchain/anthropic@^0.2.15 @langchain/core@^0.2.36
```
Expected: `package.json` gains `"@langchain/anthropic"` and `"@langchain/core"` entries under `dependencies`; `pnpm-lock.yaml` updates; command exits 0.

- [ ] **Step 2: Add `AiProviderName`, `LlmMessage`, `LlmTool` types**

In `src/types/index.ts`, add the `AiProviderName` enum immediately after the existing `VocalProviderName` enum (currently lines 17-22):

```ts
export enum VocalProviderName {
  ElevenLabs = "elevenlabs",
  OpenAI = "openai",
  Hume = "hume",
  Cartesia = "cartesia",
}

export enum AiProviderName {
  Anthropic = "anthropic",
}
```

Then, in the "Provider Interfaces" section (currently around line 238-248, right before `export interface IVocalProvider`), add:

```ts
// Provider Interfaces
export interface LlmMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LlmTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface IVocalProvider {
```
(i.e. insert the two new interfaces directly above the existing `IVocalProvider` interface, keeping the `// Provider Interfaces` comment as the section header for all three.)

Finally, add `defaultAiProvider` to the `AppConfig` interface (currently lines 100-108):

```ts
export interface AppConfig {
  dataDir: string;
  audioDir: string;
  scriptsDir: string;
  embeddingsDir: string;
  defaultVoiceProvider: VocalProviderName;
  defaultAiProvider: AiProviderName;
  defaultChunkSize: number;
  defaultChunkOverlap: number;
}
```

- [ ] **Step 3: Wire `defaultAiProvider` into config loading**

In `src/utils/config.ts`, update the import and `loadConfig()` function:

```ts
import { config } from "dotenv";
import { AiProviderName, AppConfig, VocalProviderName } from "../types";

// Load environment variables
config();

export function loadConfig(): AppConfig {
  return {
    dataDir: process.env.DATA_DIR || "./data",
    audioDir: process.env.AUDIO_DIR || "./audio",
    scriptsDir: process.env.SCRIPTS_DIR || "./scripts",
    embeddingsDir: process.env.EMBEDDINGS_DIR || "./embeddings",
    defaultVoiceProvider:
      (process.env.DEFAULT_VOICE_PROVIDER as VocalProviderName) ||
      VocalProviderName.ElevenLabs,
    defaultAiProvider:
      (process.env.DEFAULT_AI_PROVIDER as AiProviderName) ||
      AiProviderName.Anthropic,
    defaultChunkSize: parseInt(process.env.DEFAULT_CHUNK_SIZE || "1000"),
    defaultChunkOverlap: parseInt(process.env.DEFAULT_CHUNK_OVERLAP || "200"),
  };
}

export function validateConfig(config: AppConfig): {
  valid: boolean;
  missingVars: string[];
} {
  const requiredEnvVars = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"];

  const missingVars = requiredEnvVars.filter(
    (varName) => !process.env[varName]
  );

  return {
    valid: missingVars.length === 0,
    missingVars,
  };
}

export const appConfig = loadConfig();
```

- [ ] **Step 4: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors introduced by this task (pre-existing errors, if any, are unrelated — this task only adds types/config, nothing yet consumes `LlmMessage`/`LlmTool`/`AiProviderName`).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/types/index.ts src/utils/config.ts
git commit -m "feat: add AiProviderName/LlmMessage/LlmTool types and DEFAULT_AI_PROVIDER config"
```

---

### Task 2: `AiModelFactory`

**Files:**
- Create: `src/providers/AiModelFactory.ts`
- Modify: `src/providers/index.ts`

**Interfaces:**
- Consumes: `AiProviderName` from `../types` (Task 1).
- Produces: `AiModelFactory.getModel(provider: AiProviderName, maxTokens: number): BaseChatModel` — Task 3 (`BaseAgent`) calls this on every `callModel*` invocation.

- [ ] **Step 1: Create `AiModelFactory.ts`**

```ts
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatAnthropic } from "@langchain/anthropic";
import { AiProviderName } from "../types";

export class AiModelFactory {
  private static models: Map<string, BaseChatModel> = new Map();

  static getModel(provider: AiProviderName, maxTokens: number): BaseChatModel {
    const key = `${provider}:${maxTokens}`;

    if (!this.models.has(key)) {
      switch (provider) {
        case AiProviderName.Anthropic: {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (!apiKey) {
            throw new Error(
              "ANTHROPIC_API_KEY environment variable is required"
            );
          }
          this.models.set(
            key,
            new ChatAnthropic({
              apiKey,
              model: "claude-sonnet-4-5",
              maxTokens,
            })
          );
          break;
        }
        default:
          throw new Error(`Unknown AI provider: ${provider}`);
      }
    }

    return this.models.get(key)!;
  }
}
```

- [ ] **Step 2: Export it from `src/providers/index.ts`**

```ts
export { BaseVocalProvider } from './BaseVocalProvider';
export { ElevenLabsProvider } from './ElevenLabsProvider';
export { OpenAIProvider } from './OpenAIProvider';
export { HumeProvider } from './HumeProvider';
export { CartesiaProvider } from './CartesiaProvider';
export { VocalProviderFactory } from './VocalProviderFactory';
export { AudioProcessor } from './AudioProcessor';
export { AiModelFactory } from './AiModelFactory';
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. `AiModelFactory` is not yet consumed anywhere, so this only validates the new file compiles against the installed `@langchain/anthropic`/`@langchain/core` types.

- [ ] **Step 4: Commit**

```bash
git add src/providers/AiModelFactory.ts src/providers/index.ts
git commit -m "feat: add AiModelFactory for provider-agnostic chat model selection"
```

---

### Task 3: `BaseAgent` refactor

**Files:**
- Modify: `src/agents/BaseAgent.ts`

**Interfaces:**
- Consumes: `AiModelFactory.getModel(provider, maxTokens)` (Task 2), `AiProviderName`/`LlmMessage`/`LlmTool` (Task 1), `appConfig` from `../utils/config`.
- Produces: `BaseAgent.callModel(messages: LlmMessage[], maxTokens?: number): Promise<string>`, `BaseAgent.callModelWithTools(messages: LlmMessage[], tools: LlmTool[], maxTokens?: number): Promise<{ toolName: string; message: string; style: string }>`, `BaseAgent.callModelForToolInput<T>(messages: LlmMessage[], tools: LlmTool[], maxTokens?: number): Promise<T>` — consumed by `DirectorAgent`/`SpeakerAgent` in Tasks 6-7.

- [ ] **Step 1: Rewrite `BaseAgent.ts`**

```ts
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { AiModelFactory } from "../providers/AiModelFactory";
import { appConfig } from "../utils/config";
import { LlmMessage, LlmTool } from "../types";
import { logger } from "../utils/logger";

function toBaseMessages(messages: LlmMessage[]): BaseMessage[] {
  return messages.map((message) => {
    switch (message.role) {
      case "assistant":
        return new AIMessage(message.content);
      case "system":
        return new SystemMessage(message.content);
      default:
        return new HumanMessage(message.content);
    }
  });
}

export abstract class BaseAgent {
  protected async callModel(
    messages: LlmMessage[],
    maxTokens: number = 200
  ): Promise<string> {
    try {
      const model = AiModelFactory.getModel(
        appConfig.defaultAiProvider,
        maxTokens
      );
      const response = await model.invoke(toBaseMessages(messages));

      return typeof response.content === "string" ? response.content : "";
    } catch (error) {
      logger.error("AI model call failed:", error);
      throw error;
    }
  }

  protected async callModelWithTools(
    messages: LlmMessage[],
    tools: LlmTool[],
    maxTokens: number = 200
  ): Promise<{ toolName: string; message: string; style: string }> {
    try {
      const model = AiModelFactory.getModel(
        appConfig.defaultAiProvider,
        maxTokens
      );
      const response = (await model
        .bindTools!(tools, { tool_choice: "any" })
        .invoke(toBaseMessages(messages))) as AIMessage;

      const toolCall = response.tool_calls?.[0];
      if (!toolCall) {
        throw new Error("AI model response did not include a tool call");
      }

      const input = toolCall.args as { message: string; style: string };

      return {
        toolName: toolCall.name,
        message: input.message,
        style: input.style,
      };
    } catch (error) {
      logger.error("AI model tool-use call failed:", error);
      throw error;
    }
  }

  protected async callModelForToolInput<T>(
    messages: LlmMessage[],
    tools: LlmTool[],
    maxTokens: number = 200
  ): Promise<T> {
    try {
      const model = AiModelFactory.getModel(
        appConfig.defaultAiProvider,
        maxTokens
      );
      const response = (await model
        .bindTools!(tools, { tool_choice: "any" })
        .invoke(toBaseMessages(messages))) as AIMessage;

      const toolCall = response.tool_calls?.[0];
      if (!toolCall) {
        throw new Error("AI model response did not include a tool call");
      }

      return toolCall.args as T;
    } catch (error) {
      logger.error("AI model tool-use call failed:", error);
      throw error;
    }
  }

  protected logAgentAction(action: string, details?: any): void {
    logger.debug(`Agent action: ${action}`, details);
  }
}
```

Note: `BaseAgent` no longer has a constructor — `DirectorAgent`/`SpeakerAgent` already call `super()` with no arguments, which continues to work against an implicit default constructor.

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: errors will appear in `DirectorAgent.ts` and `SpeakerAgent.ts` (calling now-removed `callClaude`/`callClaudeWithTools`/`callClaudeForToolInput`, and `SpeakerAgent.ts` still importing `Anthropic.MessageParam[]`) and in `director-tools.ts`/`speaker-tools.ts` (still returning the old `Tool` type). This is expected — those are fixed in Tasks 4-7. Confirm the errors are confined to those four files.

- [ ] **Step 3: Commit**

```bash
git add src/agents/BaseAgent.ts
git commit -m "refactor: reimplement BaseAgent's Claude calls against AiModelFactory"
```

---

### Task 4: `director-tools.ts`

**Files:**
- Modify: `src/agents/director-tools.ts`

**Interfaces:**
- Consumes: `LlmTool` from `../types` (Task 1).
- Produces: `toSelectNextSpeakerTool(speakers: Speaker[]): LlmTool` (same name, new return type) — consumed by `DirectorAgent.ts` (Task 6).

- [ ] **Step 1: Replace the Anthropic `Tool` type with `LlmTool`**

```ts
import { LlmTool, Speaker } from "../types";

export const SELECT_NEXT_SPEAKER_TOOL_NAME = "select_next_speaker";

export interface SelectNextSpeakerInput {
  speakerId: string;
  direction: string;
}

export function toSelectNextSpeakerTool(speakers: Speaker[]): LlmTool {
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

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: `director-tools.ts` no longer errors. Remaining errors (if any) are confined to `DirectorAgent.ts`, `SpeakerAgent.ts`, `speaker-tools.ts` (fixed in the next tasks).

- [ ] **Step 3: Commit**

```bash
git add src/agents/director-tools.ts
git commit -m "refactor: define director tool schema as provider-agnostic LlmTool"
```

---

### Task 5: `speaker-tools.ts`

**Files:**
- Modify: `src/agents/speaker-tools.ts`

**Interfaces:**
- Consumes: `LlmTool` from `../types` (Task 1).
- Produces: `toLlmTools(only?: SpeakerAgentToolName[]): LlmTool[]` (renamed from `toAnthropicTools`) — consumed by `SpeakerAgent.ts` (Task 7).

- [ ] **Step 1: Replace the Anthropic `Tool` import and rename `toAnthropicTools`**

```ts
import { LlmTool } from "../types";

export enum SpeakerAgentToolName {
  SPEAK = "speak",
  INTERJECT = "interject",
  ONE_LINER = "one_liner",
  FILLER_COMMENT = "filler_comment",
  QUOTE = "quote",
  SHORT_QUESTION = "short_question",
  NEARLY_OUT_OF_TIME = "nearly_out_of_time",
}

export interface SpeakerToolDefinition {
  name: SpeakerAgentToolName;
  toolDescription: string;
  styleDescription: string;
}

export const SPEAKER_TOOL_DEFINITIONS: SpeakerToolDefinition[] = [
  {
    name: SpeakerAgentToolName.SPEAK,
    toolDescription:
      "Deliver a concise, natural-sounding response in the podcast. Keep your response very brief (1-2 sentences max) to maintain conversational flow. The message should be natural spoken language, while stage directions in instructions guide delivery. Use pauses and ums, like, ah, ..., etc.",
    styleDescription:
      "How to deliver the speech. Include timing, tone, and emphasis. Example: 'Pause slightly before speaking, use a thoughtful tone, emphasize \"perspective\"'",
  },
  {
    name: SpeakerAgentToolName.INTERJECT,
    toolDescription:
      "Make a brief, emotional reaction sound or very short response (maximum 1-10 words) to show engagement. Use for natural conversational responses like surprise, agreement, or interest. Keep it spontaneous and authentic.",
    styleDescription:
      "How to deliver the interjection. Include emotional context and delivery style. Example: 'Genuine surprise, slightly higher pitch, quick delivery'",
  },
  {
    name: SpeakerAgentToolName.ONE_LINER,
    toolDescription:
      "Deliver a witty, insightful, or thought-provoking single sentence that adds value to the conversation. Use for clever observations, gentle challenges, or memorable statements. Keep it concise and impactful.",
    styleDescription:
      "How to deliver the one-liner. Include timing, tone, and emphasis. Example: 'Pause slightly before speaking, use a thoughtful tone, emphasize \"perspective\"'",
  },
  {
    name: SpeakerAgentToolName.FILLER_COMMENT,
    toolDescription:
      "Use a very brief acknowledgment phrase of 1-3 words to show active listening and maintain conversation flow. Keep these responses minimal and natural, using common conversational fillers. Example: 'I see', 'Right', 'Got it', 'Makes sense', 'Interesting', etc.",
    styleDescription:
      "How to deliver the filler comment. Include timing, tone, and emphasis. Example: 'Pause slightly before speaking, use a thoughtful tone, emphasize \"perspective\"'",
  },
  {
    name: SpeakerAgentToolName.QUOTE,
    toolDescription:
      "Quote a small section of the material. Use for when you want to reference a specific section of the material. Example: 'It says here in the material we were given: \"...\"'. The quote should be no more than 20 words.",
    styleDescription:
      "How to deliver the quote. Include timing, tone, and emphasis. Example: 'Pause slightly before speaking, use a thoughtful tone, emphasize \"perspective\"'",
  },
  {
    name: SpeakerAgentToolName.SHORT_QUESTION,
    toolDescription:
      "Ask a focused, relevant question that advances the discussion. Keep questions concise and open-ended to encourage elaboration. Use for genuine curiosity or clarification. Use ums, like, etc.",
    styleDescription:
      "How to deliver the short question. Include timing, tone, and emphasis. Example: 'Pause slightly before speaking, use a thoughtful tone, emphasize \"perspective\"'",
  },
  {
    name: SpeakerAgentToolName.NEARLY_OUT_OF_TIME,
    toolDescription:
      "When the podcast is nearly over, let your co-hosts know that you're running out of time.",
    styleDescription:
      "How to deliver the nearly-out-of-time message. Include timing, tone, and emphasis. Example: 'Pause slightly before speaking, use a thoughtful tone, emphasize \"perspective\"'",
  },
];

export const SHORT_REACTION_TOOLS: SpeakerAgentToolName[] = [
  SpeakerAgentToolName.INTERJECT,
  SpeakerAgentToolName.FILLER_COMMENT,
  SpeakerAgentToolName.SHORT_QUESTION,
  SpeakerAgentToolName.ONE_LINER,
];

export function toLlmTools(only?: SpeakerAgentToolName[]): LlmTool[] {
  const definitions = only
    ? SPEAKER_TOOL_DEFINITIONS.filter((definition) =>
        only.includes(definition.name)
      )
    : SPEAKER_TOOL_DEFINITIONS;

  return definitions.map((definition) => ({
    name: definition.name,
    description: definition.toolDescription,
    input_schema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The spoken text to deliver.",
        },
        style: {
          type: "string",
          description: definition.styleDescription,
        },
      },
      required: ["message", "style"],
    },
  }));
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: `speaker-tools.ts` no longer errors. Remaining errors are confined to `DirectorAgent.ts`/`SpeakerAgent.ts` (fixed next).

- [ ] **Step 3: Commit**

```bash
git add src/agents/speaker-tools.ts
git commit -m "refactor: define speaker tool schemas as provider-agnostic LlmTool, rename toAnthropicTools to toLlmTools"
```

---

### Task 6: `DirectorAgent.ts` call sites

**Files:**
- Modify: `src/agents/DirectorAgent.ts`

**Interfaces:**
- Consumes: `BaseAgent.callModel`/`callModelForToolInput` (Task 3), `toSelectNextSpeakerTool` returning `LlmTool` (Task 4).

- [ ] **Step 1: Update the two call sites**

In `src/agents/DirectorAgent.ts`, change line 59 from:
```ts
      this.podcastPlan = await this.callClaude(messages, 800);
```
to:
```ts
      this.podcastPlan = await this.callModel(messages, 800);
```

And change lines 109-114 from:
```ts
      const tools = [toSelectNextSpeakerTool(script.speakers)];
      const { speakerId, direction } =
        await this.callClaudeForToolInput<SelectNextSpeakerInput>(
          messages,
          tools,
          300
        );
```
to:
```ts
      const tools = [toSelectNextSpeakerTool(script.speakers)];
      const { speakerId, direction } =
        await this.callModelForToolInput<SelectNextSpeakerInput>(
          messages,
          tools,
          300
        );
```

No other changes to this file — `toSelectNextSpeakerTool` already returns the new `LlmTool` type from Task 4, and `messages` (built as `{ role: 'user' as const, content: string }[]`) already structurally matches `LlmMessage[]`.

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: `DirectorAgent.ts` no longer errors. Remaining errors (if any) are confined to `SpeakerAgent.ts` (fixed next).

- [ ] **Step 3: Commit**

```bash
git add src/agents/DirectorAgent.ts
git commit -m "refactor: update DirectorAgent to call renamed BaseAgent methods"
```

---

### Task 7: `SpeakerAgent.ts` call sites

**Files:**
- Modify: `src/agents/SpeakerAgent.ts`

**Interfaces:**
- Consumes: `BaseAgent.callModelWithTools` (Task 3), `toLlmTools` returning `LlmTool[]` (Task 5), `LlmMessage` (Task 1).

- [ ] **Step 1: Drop the Anthropic import, use `LlmMessage`, rename `toAnthropicTools`/`callClaudeWithTools`**

Change the imports (lines 1-9) from:
```ts
import Anthropic from "@anthropic-ai/sdk";
import { ISpeakerAgent, PodcastScript, Speech, Speaker } from "../types";
import { BaseAgent } from "./BaseAgent";
import { logger } from "../utils/logger";
import {
  SHORT_REACTION_TOOLS,
  SpeakerAgentToolName,
  toAnthropicTools,
} from "./speaker-tools";
```
to:
```ts
import {
  ISpeakerAgent,
  LlmMessage,
  PodcastScript,
  Speech,
  Speaker,
} from "../types";
import { BaseAgent } from "./BaseAgent";
import { logger } from "../utils/logger";
import {
  SHORT_REACTION_TOOLS,
  SpeakerAgentToolName,
  toLlmTools,
} from "./speaker-tools";
```

In `interject()`, change lines 74-91 from:
```ts
      const messages: Anthropic.MessageParam[] = [
        {
          role: "user" as const,
          content: `You are ${this.speaker.name}, a podcast speaker with the following characteristics:
- Personality: ${this.speaker.personality}
- Voice Style: ${this.speaker.voiceStyle}

${lastSpeech.speaker.name} just said: "${lastSpeech.message}"

Give a brief, natural reaction to cut in with — a quick interjection or filler comment. If ${lastSpeech.speaker.name}'s line trails off or stops mid-sentence (e.g. ends with "..." or an unfinished thought), you can jump in and complete their sentence for them instead of just reacting. Do not summarize or explain, just react in the moment.`,
        },
      ];

      const result = await this.callClaudeWithTools(
        messages,
        toAnthropicTools(SHORT_REACTION_TOOLS.slice(0, 2)),
        80
      );
```
to:
```ts
      const messages: LlmMessage[] = [
        {
          role: "user" as const,
          content: `You are ${this.speaker.name}, a podcast speaker with the following characteristics:
- Personality: ${this.speaker.personality}
- Voice Style: ${this.speaker.voiceStyle}

${lastSpeech.speaker.name} just said: "${lastSpeech.message}"

Give a brief, natural reaction to cut in with — a quick interjection or filler comment. If ${lastSpeech.speaker.name}'s line trails off or stops mid-sentence (e.g. ends with "..." or an unfinished thought), you can jump in and complete their sentence for them instead of just reacting. Do not summarize or explain, just react in the moment.`,
        },
      ];

      const result = await this.callModelWithTools(
        messages,
        toLlmTools(SHORT_REACTION_TOOLS.slice(0, 2)),
        80
      );
```

In `generateSpeech()`, change lines 116-150 from:
```ts
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user" as const,
        content: `You are ${
          this.speaker.name
        }, a podcast speaker with the following characteristics:
- Personality: ${this.speaker.personality}
- Voice Style: ${this.speaker.voiceStyle}
- Expert Level: ${this.speaker.isExpert ? "Expert" : "General audience"}

Podcast Context:
- Title: ${script.title}
- Description: ${script.description}

Conversation History (speaker: message [tool used]):
${conversationHistory}

Relevant Materials:
${relevantMaterials}

Director's guidance: ${direction}

Respond naturally as ${
          this.speaker.name
        }. Choose the response style tool that best fits this moment in the conversation, and provide both the spoken message and a delivery style for it.${this.getBrevityNudge(
          script
        )} Be authentic to your personality and expertise level. Make the speech sound like real, unscripted talk, not a written passage: sprinkle in filler words (um, uh, er, like, you know), false starts and self-corrections ("it was — actually, no, it was..."), and the occasional stammer. Use ellipsis ("...") often to show trailing off, hesitation, or a pause before continuing a thought. Sometimes stop mid-sentence as if you've lost the word or the thread entirely — trail off with "..." and don't finish the thought; your co-host may jump in and finish it for you. Do not include stage directions, emotes, sound effects or physical actions in the message itself — those belong in the style argument.`,
      },
    ];

    const result = await this.callClaudeWithTools(
      messages,
      toAnthropicTools(),
      300
    );
```
to:
```ts
    const messages: LlmMessage[] = [
      {
        role: "user" as const,
        content: `You are ${
          this.speaker.name
        }, a podcast speaker with the following characteristics:
- Personality: ${this.speaker.personality}
- Voice Style: ${this.speaker.voiceStyle}
- Expert Level: ${this.speaker.isExpert ? "Expert" : "General audience"}

Podcast Context:
- Title: ${script.title}
- Description: ${script.description}

Conversation History (speaker: message [tool used]):
${conversationHistory}

Relevant Materials:
${relevantMaterials}

Director's guidance: ${direction}

Respond naturally as ${
          this.speaker.name
        }. Choose the response style tool that best fits this moment in the conversation, and provide both the spoken message and a delivery style for it.${this.getBrevityNudge(
          script
        )} Be authentic to your personality and expertise level. Make the speech sound like real, unscripted talk, not a written passage: sprinkle in filler words (um, uh, er, like, you know), false starts and self-corrections ("it was — actually, no, it was..."), and the occasional stammer. Use ellipsis ("...") often to show trailing off, hesitation, or a pause before continuing a thought. Sometimes stop mid-sentence as if you've lost the word or the thread entirely — trail off with "..." and don't finish the thought; your co-host may jump in and finish it for you. Do not include stage directions, emotes, sound effects or physical actions in the message itself — those belong in the style argument.`,
      },
    ];

    const result = await this.callModelWithTools(
      messages,
      toLlmTools(),
      300
    );
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors anywhere in the project.

- [ ] **Step 3: Commit**

```bash
git add src/agents/SpeakerAgent.ts
git commit -m "refactor: update SpeakerAgent to use LlmMessage/toLlmTools/callModelWithTools"
```

---

### Task 8: Build and manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `pnpm run build`
Expected: `tsc` compiles cleanly, `dist/` is produced, exit code 0.

- [ ] **Step 2: Confirm no remaining `@anthropic-ai/sdk` imports outside the SDK's own dependency chain**

Run: `grep -rn "@anthropic-ai/sdk" src`
Expected: no output (all direct imports were removed in Tasks 3-5,7; `@anthropic-ai/sdk` remains in `package.json` only as a transitive dependency of `@langchain/anthropic` — no action needed there).

- [ ] **Step 3: Manual end-to-end smoke test**

With `ANTHROPIC_API_KEY` set in the environment, run the CLI's podcast generation flow end-to-end (use whatever project script/skill normally exercises `ScriptService.generateScript` — e.g. `pnpm run dev` and drive the generate-script command, or the project's `/run` skill). Confirm:
- The director produces a podcast plan (no thrown errors from `callModel`).
- The director selects a next speaker with a valid `speakerId`/`direction` (no "AI model response did not include a tool call" errors from `callModelForToolInput`).
- A speaker generates a speech via a tool call (no errors from `callModelWithTools`), and an interjection can be generated.

If any step throws, capture the error and check: (a) `ANTHROPIC_API_KEY` is set, (b) the tool payload logged by the Anthropic API error (if any) matches the expected `input_schema` shape.

- [ ] **Step 4: Commit (if smoke test required no code changes, this step is a no-op — skip it)**

If the smoke test surfaced a bug requiring a fix, fix it, re-run Steps 1-3, then:
```bash
git add -A
git commit -m "fix: <describe smoke-test fix>"
```
