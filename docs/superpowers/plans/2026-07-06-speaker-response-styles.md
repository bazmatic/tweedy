# Speaker Response Styles Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `SpeakerAgent`'s single plain-text completion with Claude native tool-use across 7 response styles (speak, interject, one-liner, filler comment, quote, short question, nearly-out-of-time), so each turn the model picks one style and returns both the message and its own delivery direction.

**Architecture:** Tool definitions live as data in a new `src/agents/speaker-tools.ts` module (name/toolDescription/styleDescription per style + a pure mapper to Anthropic's tool schema). `BaseAgent` gets a new `callClaudeWithTools` method alongside the existing `callClaude` (unchanged, still used by `DirectorAgent`). `SpeakerAgent` calls the new method instead of building a plain prompt, and maps the returned `{toolName, message, style}` onto `Speech`.

**Tech Stack:** TypeScript, `@anthropic-ai/sdk` (already a dependency, tool-use API).

**Spec:** `docs/superpowers/specs/2026-07-06-speaker-response-styles-design.md`

**Note on testing:** This repo has no test framework installed (no jest/vitest, no `test` script, no existing `*.test.ts` files). Per the spec, adding one is out of scope for this change. Verification steps below use `npm run build` (tsc typechecking) and a manual smoke-test script instead of automated unit tests.

---

## Chunk 1: Tool definitions, BaseAgent method, types, SpeakerAgent integration

### Task 1: Create the speaker tool definitions module

**Files:**
- Create: `src/agents/speaker-tools.ts`

- [ ] **Step 1: Write the module**

```typescript
import Anthropic from "@anthropic-ai/sdk";

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

export function toAnthropicTools(): Anthropic.Tool[] {
  return SPEAKER_TOOL_DEFINITIONS.map((definition) => ({
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

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: compiles with no errors related to `speaker-tools.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/agents/speaker-tools.ts
git commit -m "feat: add speaker response-style tool definitions"
```

---

### Task 2: Add `callClaudeWithTools` to `BaseAgent`

**Files:**
- Modify: `src/agents/BaseAgent.ts`

- [ ] **Step 1: Add the method**

Add this method to the `BaseAgent` class, alongside the existing `callClaude` (leave `callClaude` untouched — `DirectorAgent` still uses it as-is):

```typescript
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

Note: `messages: any[]` on the existing `callClaude` stays as-is (out of scope for this change) — but the new method's `messages` parameter should be typed `Anthropic.MessageParam[]` since it's new code and `any` is forbidden for new code per project TypeScript conventions.

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: compiles with no errors. If `Anthropic.ToolUseBlock` or `Anthropic.Tool` aren't the exact exported type names in the installed SDK version, check `node_modules/@anthropic-ai/sdk/resources/messages.d.ts` (or wherever the installed version defines them) and adjust the type names used above accordingly — the runtime shape (a `content` block with `type: "tool_use"`, `name`, and `input`) is stable across recent SDK versions even if exported type names differ.

- [ ] **Step 3: Commit**

```bash
git add src/agents/BaseAgent.ts
git commit -m "feat: add callClaudeWithTools to BaseAgent for tool-use calls"
```

---

### Task 3: Add `tool` field to `Speech`

**Files:**
- Modify: `src/types/index.ts:61-69`

- [ ] **Step 1: Update the `Speech` interface**

```typescript
export interface Speech {
  id: string;
  speaker: Speaker;
  message: string;
  instructions: string;
  voice: Voice;
  voiceStyle: string;
  timestamp: Date;
  tool?: SpeakerAgentToolName;
}
```

Add the import at the top of the file:

```typescript
import { SpeakerAgentToolName } from "../agents/speaker-tools";
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add optional tool field to Speech"
```

---

### Task 4: Update `SpeakerAgent` to use tool-use and remove the old unused enum

**Files:**
- Modify: `src/agents/SpeakerAgent.ts`
- Modify: `src/agents/index.ts:1-4`

- [ ] **Step 1: Remove the old unused `SpeakerAgentTool` enum from `SpeakerAgent.ts`**

Delete lines 5-11 (the `export enum SpeakerAgentTool { ... }` block) from `src/agents/SpeakerAgent.ts` — it's superseded by `SpeakerAgentToolName` in `speaker-tools.ts`.

- [ ] **Step 2: Update imports**

At the top of `src/agents/SpeakerAgent.ts`, add:

```typescript
import { SpeakerAgentToolName, toAnthropicTools } from "./speaker-tools";
```

- [ ] **Step 3: Rewrite `generateSpeech` to return the tool result**

Replace the existing `generateSpeech` method (lines 64-100) with:

```typescript
  private async generateSpeech(
    script: PodcastScript,
    direction: string
  ): Promise<{ toolName: SpeakerAgentToolName; message: string; style: string }> {
    const conversationHistory = this.getConversationHistory(script);
    const relevantMaterials = this.getRelevantMaterials(script);

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

Conversation History:
${conversationHistory}

Relevant Materials:
${relevantMaterials}

Director's guidance: ${direction}

Respond naturally as ${
          this.speaker.name
        }. Choose the response style tool that best fits this moment in the conversation, and provide both the spoken message and a delivery style for it. Be authentic to your personality and expertise level. Do not include stage directions, emotes, sound effects or physical actions in the message itself — those belong in the style argument.`,
      },
    ];

    const result = await this.callClaudeWithTools(
      messages,
      toAnthropicTools(),
      100
    );

    return {
      toolName: result.toolName as SpeakerAgentToolName,
      message: result.message,
      style: result.style,
    };
  }
```

Add the `Anthropic` import needed for the `MessageParam[]` type:

```typescript
import Anthropic from "@anthropic-ai/sdk";
```

- [ ] **Step 4: Update `speak()` to consume the new return shape**

In the `speak()` method, replace:

```typescript
        const speechText = await this.generateSpeech(script, direction);

        const speech: Speech = {
          id: this.generateId(),
          speaker: this.speaker,
          message: speechText,
          instructions: direction,
          voice: this.speaker.voice,
          voiceStyle: this.speaker.voiceStyle,
          timestamp: new Date(),
        };

        logger.info(
          `Speech generated for ${this.speaker.name}: ${speechText.substring(
            0,
            100
          )}...`
        );
```

with:

```typescript
        const { toolName, message, style } = await this.generateSpeech(
          script,
          direction
        );

        const speech: Speech = {
          id: this.generateId(),
          speaker: this.speaker,
          message,
          instructions: style,
          voice: this.speaker.voice,
          voiceStyle: this.speaker.voiceStyle,
          timestamp: new Date(),
          tool: toolName,
        };

        logger.info(
          `Speech generated for ${this.speaker.name} (${toolName}): ${message.substring(
            0,
            100
          )}...`
        );
```

- [ ] **Step 5: Update the barrel export**

In `src/agents/index.ts`, replace:

```typescript
export { SpeakerAgent, SpeakerAgentTool } from './SpeakerAgent';
```

with:

```typescript
export { SpeakerAgent } from './SpeakerAgent';
export { SpeakerAgentToolName } from './speaker-tools';
```

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: compiles with no errors. Search the codebase for any other usage of the removed `SpeakerAgentTool` name to make sure nothing else references it:

Run: `grep -rn "SpeakerAgentTool\b" src`
Expected: no matches (only `SpeakerAgentToolName` should appear).

- [ ] **Step 7: Commit**

```bash
git add src/agents/SpeakerAgent.ts src/agents/index.ts
git commit -m "feat: switch SpeakerAgent to native tool-use response styles"
```

---

### Task 5: Manual smoke test

**Files:**
- Create (temporary, not committed): `/private/tmp/claude-501/-Users-barryearsman-projects-tweedy/8af21180-ae30-45b0-bfb9-fb4ef111a41f/scratchpad/smoke-test.ts`

Since there's no test framework in this repo, verify the end-to-end flow manually with a real API call (requires `ANTHROPIC_API_KEY` to be set in the environment).

- [ ] **Step 1: Write a throwaway smoke-test script**

```typescript
import { SpeakerAgent } from "../../../../src/agents/SpeakerAgent";
import { Speaker, PodcastScript, VocalProviderName, SourceType } from "../../../../src/types";

async function main() {
  const speaker: Speaker = {
    id: "s1",
    name: "Alex",
    personality: "Curious and energetic",
    voice: {
      id: "v1",
      name: "Test Voice",
      description: "test",
      provider: VocalProviderName.ElevenLabs,
      providerId: "test",
      settings: {},
    },
    voiceStyle: "energetic",
    isExpert: false,
  };

  const script: PodcastScript = {
    id: "sc1",
    title: "Test Episode",
    description: "A test podcast about frisbees",
    speakers: [speaker],
    speeches: [],
    materials: [
      {
        id: "m1",
        title: "Frisbee History",
        content: "The frisbee was invented in the 1930s.",
        source: "test",
        sourceType: SourceType.Manual,
        metadata: {},
        createdAt: new Date(),
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const agent = new SpeakerAgent(speaker);
  const speech = await agent.speak(script, "Introduce the topic of frisbees.");
  console.log(JSON.stringify(speech, null, 2));
}

main();
```

Adjust the relative import paths to match wherever the script actually lives relative to `src/`.

- [ ] **Step 2: Run it**

Run: `npx ts-node <path-to-smoke-test.ts>` (with `ANTHROPIC_API_KEY` set)
Expected: prints a `Speech` object where `tool` is one of the 7 `SpeakerAgentToolName` values, `message` is plausible spoken text for that style, and `instructions` is a plausible delivery direction (not empty, not identical to the raw director prompt).

- [ ] **Step 3: Discard the smoke-test script**

It's scratch-only and was never added to git, so no cleanup commit is needed.

---

## Completion

After Task 5 passes, this feature is complete: `SpeakerAgent` now selects one of 7 response styles per turn via native Claude tool-use, with `Speech.tool` and `Speech.instructions` reflecting the model's own choice.
