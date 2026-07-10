# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install          # install deps (this repo uses pnpm, see pnpm-lock.yaml/pnpm-workspace.yaml)
pnpm build             # tsc compile to dist/
pnpm dev               # run CLI from source via ts-node (src/index.ts)
pnpm test              # vitest run (all tests)
npx vitest run <path>  # run a single test file
npx tsc --noEmit       # type-check without emitting
```

There is no lint script configured. The CLI binary is `tweedy` (bin: `dist/index.js`); `pnpm link --global` symlinks it after a build.

Required env vars (see `env.example`): `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`. Optional: `ELEVENLABS_API_KEY`, `HUME_API_KEY`, `CARTESIA_API_KEY`, `DATA_DIR`/`AUDIO_DIR`/`SCRIPTS_DIR`/`EMBEDDINGS_DIR` (default to `./data`, `./audio`, `./scripts`, `./embeddings`).

## Architecture

Layered: **CLI → Service → Repository → Provider**, plus a standalone **RAG** layer. Each repository namespaces its JSON file storage under one `appConfig` dir (`src/utils/config.ts`): e.g. `MaterialRepository`/`SpeechRepository`/`SpeakerRepository`/`VoiceRepository` live under `dataDir/<name>`, `ScriptRepository` uses `scriptsDir` directly, and the vector store uses `embeddingsDir`. CLI subcommands live one-per-domain in `src/cli/commands/` (`MaterialCommands.ts`, `ScriptCommands.ts`, `VoiceCommands.ts`, `SpeakerCommands.ts`, `AudioCommands.ts`, `ResearchCommands.ts`).

### Script generation (agent) pipeline

`ScriptService.generateScriptContent` is the orchestrator: it builds one `DirectorAgent` per script, calls `createPodcastPlan()` once, then loops up to `maxTurns` times calling `directorAgent.chooseNextSpeaker(script)` (forces a `select_next_speaker` tool call) followed by a fresh `SpeakerAgent(speaker).speak(script, direction)`. Both agents extend `BaseAgent`, which wraps `AiModelFactory.getModel` with LangChain `bindTools({tool_choice: "any"})` — every turn is forced to be a tool call, never freeform text.

`src/agents/speaker-tools.ts` defines the tools a speaker can pick: `SPEAK`, `INTERJECT`, `ONE_LINER`, `FILLER_COMMENT`, `QUOTE`, `SHORT_QUESTION`, `NEARLY_OUT_OF_TIME`, `CHALLENGE`. `CHALLENGE` is one of the reduced `INTERJECTION_TOOLS` set offered during forced interjections (for a co-host pushing back rather than just reacting); `SHORT_REACTION_TOOLS` drives `getBrevityNudge`, which discourages consecutive long `SPEAK` turns.

After every real turn, `ScriptService` calls `shouldInterject(speech, speakerCount, Math.random())` (`src/services/interjection-policy.ts`): if the model's `stopReason === "max_tokens"` (recovered via `BaseAgent.recoverTruncatedToolCall`), an interjection is *always* forced — a truncated line is treated as the natural place for a co-host to jump in. Otherwise a long `SPEAK` (>80 chars) triggers an interjection with 80% probability. A forced interjection picks a different random speaker, restricts them to `INTERJECTION_TOOLS`, and caps them at 30 tokens (vs 80 for normal speech).

### Provider factory pattern

`AiModelFactory`, `VocalProviderFactory`, `DocumentProcessorFactory`, and `ResearchProviderFactory` all follow the same shape: a static `Map` cache keyed by enum (or file extension), a `getProvider`/`getModel` switch instantiating the concrete class on first use, throwing on an unrecognized key. To add a provider: add the enum value, add the `case`, implement the shared interface (`IVocalProvider`, `IResearchProvider`, `IDocumentProcessor`), wire any needed env var. `ResearchProviderFactory` is the newest and currently only wires `PerplexityProvider`; `ResearchService` wraps it and calls `MaterialService.addMaterial` to feed research results into the same material pipeline used by document/URL/manual ingestion.

### RAG / vector store

`RAGService` wraps `LangChainVectorStore`, which lazily builds a LangChain `MemoryVectorStore` + `LocalLangChainEmbeddings` (local transformer embeddings via `src/rag/local-embeddings.ts`). **Known limitation:** `LangChainVectorStore` computes a `storePath` (`embeddingsDir/vectorstore.json`) but `persistStore()`/`loadStore()` are no-op stubs — the vector store is purely in-memory and rebuilt from repository records on every CLI invocation. `deleteDocuments` and `RAGService.clearStore` are likewise unimplemented placeholders; bulk-clearing materials (`tweedy material clear`) only removes the JSON records in `dataDir/materials`, not any vector state (there is none to persist).

### Audio pipeline

`AudioProcessor.concatenateAudio` computes each clip's real speech end via `getSpeechEndSeconds` (strips trailing TTS silence), then `computeClipOffsets` (`src/providers/audio-timeline.ts`) lays clips on an ffmpeg `adelay`+`amix` timeline. Normal clips start `GAP_SECONDS` (0.3s) after the previous clip's speech ends. Clips flagged `isInterjection` instead start `OVERLAP_SECONDS` (1s) *before* the previous clip's speech end, producing genuine audio overlap rather than sequential turns — this is what makes forced interjections sound like a real interruption.
