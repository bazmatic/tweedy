# Design: AI Provider Abstraction (LLM)

## Goal

Make the LLM layer provider-agnostic, mirroring the pattern already used for voice/TTS (`IVocalProvider` → `BaseVocalProvider` → concrete providers → `VocalProviderFactory`). Currently, LLM calls are hardcoded to Anthropic's SDK, funneled through three methods on `BaseAgent`. This design abstracts that layer using LangChain's `BaseChatModel` as the provider-agnostic interface, with `ChatAnthropic` as the first (and currently only) concrete provider.

## Current state

- `BaseAgent` (`src/agents/BaseAgent.ts`) constructs `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` directly and exposes three methods: `callClaude`, `callClaudeWithTools`, `callClaudeForToolInput<T>` — all calling `messages.create()` with the hardcoded model `"claude-sonnet-4-5"`.
- `DirectorAgent` and `SpeakerAgent` (both extend `BaseAgent`) call these three methods; no other agent code touches the Anthropic SDK.
- `director-tools.ts` and `speaker-tools.ts` define tool schemas typed against `Tool` from `@anthropic-ai/sdk/resources/messages`, in Anthropic's `input_schema` shape.
- LangChain (`langchain`, `@langchain/community`, `@langchain/openai`) is already a dependency, currently used only for RAG/embeddings (`src/rag/`), not for chat/LLM calls. `@langchain/anthropic` is not yet installed.

## Non-goals

- No second LLM provider is implemented now — only `ChatAnthropic`. The design just makes adding one (e.g. `ChatOpenAI`) a matter of adding an enum case and factory branch, same as voice providers.
- No change to `DirectorAgent`/`SpeakerAgent` business logic — only their calls to renamed `BaseAgent` methods.
- No streaming support — matches current synchronous, non-streaming usage.
- No new automated test suite — the codebase has no existing tests for the agent layer (only `audio-timeline.test.ts`, unrelated); verification is manual (see Testing below), consistent with current practice.

## Changes

### 1. `AiProviderName` enum (`src/types/index.ts`)

```ts
export enum AiProviderName {
  Anthropic = "anthropic",
}
```

Add `LlmTool` type for provider-agnostic tool schemas. This keeps the field name `input_schema` (rather than a generic `schema`) because `ChatAnthropic.bindTools()` detects tools already in Anthropic's native shape (`"input_schema" in tool`) and passes them through unchanged — verified against `@langchain/anthropic`'s `formatStructuredToolToAnthropic`. Using this field name means zero runtime shape change from today's Anthropic SDK calls; only the TypeScript type's origin changes (no longer imported from `@anthropic-ai/sdk`):

```ts
export interface LlmTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}
```

Also add a provider-agnostic message type, replacing the current `any[]` / `Anthropic.MessageParam[]` message parameters:

```ts
export interface LlmMessage {
  role: "user" | "assistant" | "system";
  content: string;
}
```

### 2. `AiModelFactory` (`src/providers/AiModelFactory.ts`)

Mirrors `VocalProviderFactory`: static `getModel(provider: AiProviderName, maxTokens: number): BaseChatModel`, lazily instantiated and cached in a `Map<string, BaseChatModel>` keyed by `` `${provider}:${maxTokens}` ``, `switch` over the enum.

The `maxTokens` parameter is necessary (and not just a `provider` key, as voice's `VocalProviderFactory` uses) because this version of `@langchain/anthropic` reads `max_tokens` only from the model instance's construction-time config (`this.maxTokens` in `invocationParams()`), not from per-call options — so varying `max_tokens` per call (the current code uses 200/300/800/80 across different call sites) requires distinct cached instances. The set of distinct values is small and fixed, so this is cheap.

- `case AiProviderName.Anthropic`: constructs `new ChatAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY, model: "claude-sonnet-4-5", maxTokens })`. Throws `"ANTHROPIC_API_KEY environment variable is required"` if the key is missing — matching the existing voice-provider constructor validation style — replacing the equivalent check currently in `BaseAgent`'s constructor.

New dependency: `@langchain/anthropic`.

### 3. `BaseAgent` refactor (`src/agents/BaseAgent.ts`)

Replace the direct `Anthropic` client with per-call `BaseChatModel` instances obtained via `AiModelFactory.getModel(appConfig.defaultAiProvider, maxTokens)`. `BaseAgent` no longer needs a constructor (no client field to initialize). Rename methods (no more Claude-specific naming), and add a local `toBaseMessages(messages: LlmMessage[]): BaseMessage[]` helper (maps `role` to `HumanMessage`/`AIMessage`/`SystemMessage`):

- `callClaude(messages, maxTokens)` → **`callModel(messages: LlmMessage[], maxTokens)`**: converts messages via `toBaseMessages`, calls `model.invoke(...)`, returns `.content` as a string (empty string if not a plain string).
- `callClaudeWithTools(messages, tools, maxTokens)` → **`callModelWithTools(messages: LlmMessage[], tools: LlmTool[], maxTokens)`**: `model.bindTools(tools, { tool_choice: "any" }).invoke(...)`, reads the first entry of the response's normalized `.tool_calls` array (`{name, args, id}` — the same shape across providers, replacing the current manual scan for an Anthropic `tool_use` content block).
- `callClaudeForToolInput<T>(messages, tools, maxTokens)` → **`callModelForToolInput<T>(messages: LlmMessage[], tools: LlmTool[], maxTokens)`**: same call pattern, returns `toolCall.args as T`.

### 4. Tool schema definitions (`director-tools.ts`, `speaker-tools.ts`)

Drop the `import type { Tool } from "@anthropic-ai/sdk/resources/messages"` import. Tool-building functions return `LlmTool[]`/`LlmTool` instead of Anthropic's `Tool` shape, using `schema` (JSON schema) in place of `input_schema`. `toAnthropicTools()` renamed to `toLlmTools()`. No per-provider translation is needed — this is the shape LangChain's `bindTools()` accepts directly.

### 5. `DirectorAgent` / `SpeakerAgent`

Update call sites only: `this.callClaude(...)` → `this.callModel(...)`, `this.callClaudeForToolInput(...)` → `this.callModelForToolInput(...)`, `this.callClaudeWithTools(...)` → `this.callModelWithTools(...)`, and `toAnthropicTools(...)` → `toLlmTools(...)`. No logic changes.

### 6. Config & selection (`src/utils/config.ts`, `src/types/index.ts`)

Add `defaultAiProvider: AiProviderName` to `AppConfig`, mirroring `defaultVoiceProvider`:

```ts
defaultAiProvider:
  (process.env.DEFAULT_AI_PROVIDER as AiProviderName) ||
  AiProviderName.Anthropic,
```

`validateConfig`'s required-env-var check is unchanged (`ANTHROPIC_API_KEY` stays required while it's the only/default provider).

## Error handling

- `AiModelFactory.getModel()` throws a clear, provider-named error if the required API key is missing, matching the voice-provider constructor pattern. This replaces the equivalent check currently inline in `BaseAgent`'s constructor.
- No other error-handling changes — agents' existing try/catch behavior around these calls is unaffected.

## Testing

No existing test coverage exists for `BaseAgent`, `DirectorAgent`, or `SpeakerAgent`, so this refactor does not introduce a new automated suite. Verification is a manual smoke test: run the CLI's podcast-generation flow end-to-end and confirm director/speaker tool-calls and script generation still work against the live Anthropic API.
