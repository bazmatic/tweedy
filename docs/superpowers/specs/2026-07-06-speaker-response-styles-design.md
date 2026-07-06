# Speaker Response Styles — Design

## Problem

`SpeakerAgent` currently always produces a single kind of response: a plain, conversational speech generated from one text completion. There's an unused `SpeakerAgentTool` enum (`SPEAK`, `INTERJECT`, `ONE_LINER`, `QUESTION`, `COMMENT`) that was never wired into the generation call — no tool-calling is actually happening today.

We want speakers to choose from a set of distinct response styles (brief speech, interjection, one-liner, filler comment, quote, short question, "nearly out of time" notice) each turn, using Claude's native tool-use API so the model explicitly picks one style and supplies both the message and its own delivery direction.

## Architecture

Tool definitions are data, not code branches (SOLID: OCP). Adding a new response style later means adding one object to an array — no changes to `BaseAgent` or `SpeakerAgent` logic.

### `src/agents/speaker-tools.ts` (new)

- `SpeakerAgentToolName` enum — replaces the current unused `SpeakerAgentTool` enum:
  - `SPEAK`, `INTERJECT`, `ONE_LINER`, `FILLER_COMMENT`, `QUOTE`, `SHORT_QUESTION`, `NEARLY_OUT_OF_TIME`
- `SpeakerToolDefinition` interface: `{ name: SpeakerAgentToolName; toolDescription: string; styleDescription: string }`
- `SPEAKER_TOOL_DEFINITIONS: SpeakerToolDefinition[]` — single source of truth, one entry per style, ported from the tool list provided (toolDescription/styleDescription content per tool).
- `toAnthropicTools(): Anthropic.Tool[]` — pure function mapping each definition to an Anthropic tool schema:
  - `name`: the enum value
  - `description`: the `toolDescription`
  - `input_schema`: object requiring two string properties:
    - `message` — the spoken text
    - `style` — the delivery direction (using `styleDescription` as the property's description)

### `BaseAgent` (extended)

New method alongside the existing `callClaude` (which stays unchanged for `DirectorAgent`'s use):

```ts
protected async callClaudeWithTools(
  messages: Anthropic.MessageParam[],
  tools: Anthropic.Tool[],
  maxTokens: number
): Promise<{ toolName: string; message: string; style: string }>
```

- Calls `this.client.messages.create` with `tools`, `tool_choice: { type: "any" }`, and `max_tokens: maxTokens`.
- Finds the `tool_use` content block in the response.
- Throws if no `tool_use` block is present (defensive — shouldn't happen with forced tool choice).
- Returns `{ toolName: block.name, message: block.input.message, style: block.input.style }`.

### `SpeakerAgent` (updated)

- `generateSpeech` builds the same contextual prompt as today (speaker personality, conversation history, materials, director's guidance), but calls `callClaudeWithTools(messages, toAnthropicTools(), maxTokens)` instead of `callClaude`.
- Returns `{ toolName: SpeakerAgentToolName; message: string; style: string }`.
- `speak()` uses the result to build `Speech`:
  - `message` ← tool result's `message`
  - `instructions` ← tool result's `style` (the model's own stated delivery direction — more accurate than echoing the director's raw prompt)
  - `tool` ← tool result's `toolName`
- Retry loop in `speak()` is unchanged: `generateSpeech` throwing is caught and retried up to `maxAttempts`, then falls back.
- `createFallbackSpeech()` is unchanged: plain message, `instructions: "Fallback response due to generation failure"`, no `tool` field set.

### `src/types/index.ts` (updated)

- `Speech` interface gains: `tool?: SpeakerAgentToolName`.

## Data Flow

1. `DirectorAgent.giveDirection()` produces a `direction` string (unchanged).
2. `SpeakerAgent.speak(script, direction)` calls `generateSpeech`, which sends the prompt + all 7 tools to Claude with forced tool choice.
3. Claude picks exactly one tool and returns `message` + `style` as that tool's arguments.
4. `speak()` maps the result into a `Speech` with `message`, `instructions` (from `style`), and `tool` (from `toolName`) populated.
5. On failure after retries, falls back to a plain untagged `Speech` as today.

## Error Handling

- `callClaudeWithTools` throws if the response has no `tool_use` block; this propagates into the existing `speak()` retry loop unchanged — no new failure modes.

## Testing

No existing test suite exists in the repo. New unit tests to add, scoped to the new pure/parsing logic only:

- `toAnthropicTools()` — definitions map to correctly-shaped Anthropic tool schemas (name, description, required `message`/`style` string properties).
- `callClaudeWithTools`'s response parsing — given a mocked Anthropic response containing a `tool_use` block, extracts `{toolName, message, style}` correctly; throws when no `tool_use` block is present.

Testing `SpeakerAgent.speak()`'s retry/fallback path end-to-end would require mocking the Anthropic client and is optional — no existing infra to extend, and the retry logic itself isn't changing.

## Out of Scope

- No changes to `DirectorAgent` or how direction is generated.
- No changes to fallback behavior beyond what exists today.
- `NEARLY_OUT_OF_TIME` is just another tool in the list — no separate director-triggered code path.
