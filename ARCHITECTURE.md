# Tweedy — Technical Architecture

Tweedy is a CLI tool for generating multi-speaker podcast episodes: ingesting source material, planning and drafting a script via LLM agents, synthesizing speech per turn, and stitching the clips into a final audio (and optionally video) file.

## Layered structure

```
CLI  →  Service  →  Repository  →  Provider
              +
         RAG (standalone)
```

- **CLI** (`src/cli/`) — one command file per domain: `MaterialCommands.ts`, `ScriptCommands.ts`, `SpeakerCommands.ts`, `VoiceCommands.ts`, `AudioCommands.ts`, `ResearchCommands.ts`. `src/cli/index.ts` wires them into the `tweedy` binary.
- **Service** (`src/services/`) — business logic per domain (`ScriptService`, `MaterialService`, `SpeakerService`, `VoiceService`, `AudioService`, `DocumentService`, `ResearchService`).
- **Repository** (`src/repositories/`) — JSON file persistence. Each repo namespaces its storage dir under `appConfig` (`src/utils/config.ts`): `MaterialRepository`, `SpeechRepository`, `SpeakerRepository`, `VoiceRepository` live under `dataDir/<name>`; `ScriptRepository` uses `scriptsDir` directly.
- **Provider** (`src/providers/`) — external integrations (LLMs, TTS vendors, research APIs), selected via factories.
- **RAG** (`src/rag/`) — vector store for material retrieval, independent of the above chain.

## Script generation (agent) pipeline

`ScriptService.generateScriptContent` is the orchestrator:

1. Builds one `DirectorAgent` per script.
2. Calls `createPodcastPlan()` once to produce the episode plan.
3. Loops up to `maxTurns` times:
   - `directorAgent.chooseNextSpeaker(script)` — forces a `select_next_speaker` tool call.
   - `new SpeakerAgent(speaker).speak(script, direction)` — the chosen speaker's turn.

Both `DirectorAgent` and `SpeakerAgent` extend `BaseAgent` (`src/agents/BaseAgent.ts`), which wraps `AiModelFactory.getModel` with LangChain `bindTools({ tool_choice: "any" })`. Every turn is forced to be a tool call — the model never returns freeform text.

### Speaker tools

`src/agents/speaker-tools.ts` defines what a speaker can pick each turn:

- `SPEAK`, `INTERJECT`, `ONE_LINER`, `FILLER_COMMENT`, `QUOTE`, `SHORT_QUESTION`, `NEARLY_OUT_OF_TIME`, `CHALLENGE`
- `CHALLENGE` belongs to the reduced `INTERJECTION_TOOLS` set offered during forced interjections (a co-host pushing back, not just reacting).
- `SHORT_REACTION_TOOLS` drives `getBrevityNudge`, discouraging consecutive long `SPEAK` turns.

### Interjection policy

After every real turn, `ScriptService` calls `shouldInterject(speech, speakerCount, Math.random())` (`src/services/interjection-policy.ts`):

- If the model's `stopReason === "max_tokens"` (recovered via `BaseAgent.recoverTruncatedToolCall`), an interjection is **always** forced — a truncated line is treated as a natural interruption point.
- Otherwise, a long `SPEAK` turn (>80 chars) triggers an interjection with 80% probability.
- A forced interjection picks a different random speaker, restricts them to `INTERJECTION_TOOLS`, and caps them at 30 tokens (vs. 80 for normal speech).

## Provider factory pattern

`AiModelFactory`, `VocalProviderFactory`, `DocumentProcessorFactory`, and `ResearchProviderFactory` all share one shape:

- A static `Map` cache keyed by enum (or file extension for document processors).
- A `getProvider`/`getModel` method with a switch that instantiates the concrete class on first use, throwing on an unrecognized key.

To add a new provider: add the enum value, add the `case`, implement the shared interface (`IVocalProvider`, `IResearchProvider`, `IDocumentProcessor`), and wire any required env var.

`ResearchProviderFactory` is the newest and currently only wires `PerplexityProvider`. `ResearchService` wraps it and calls `MaterialService.addMaterial` to feed research results into the same pipeline used by document/URL/manual ingestion.

## RAG / vector store

`RAGService` wraps `LangChainVectorStore`, which lazily builds a LangChain `MemoryVectorStore` + `LocalLangChainEmbeddings` (local transformer embeddings, `src/rag/local-embeddings.ts`).

**Known limitation:** `LangChainVectorStore` computes a `storePath` (`embeddingsDir/vectorstore.json`) but `persistStore()`/`loadStore()` are no-op stubs — the store is purely in-memory and rebuilt from repository records on every CLI invocation. `deleteDocuments` and `RAGService.clearStore` are likewise unimplemented placeholders; `tweedy material clear` only removes JSON records in `dataDir/materials`, not any vector state (there is none to persist).

## Audio pipeline

`AudioProcessor.concatenateAudio`:

1. Computes each clip's real speech end via `getSpeechEndSeconds` (strips trailing TTS silence).
2. Calls `computeClipOffsets` (`src/providers/audio-timeline.ts`) to lay clips on an ffmpeg `adelay`+`amix` timeline.
3. Normal clips start `GAP_SECONDS` (0.3s) after the previous clip's speech ends.
4. Clips flagged `isInterjection` instead start `OVERLAP_SECONDS` (1s) *before* the previous clip's speech end — producing genuine audio overlap rather than sequential turns, which is what makes forced interjections sound like a real interruption.

## Directory map

```
src/
  agents/         DirectorAgent, SpeakerAgent, BaseAgent, MaterialSummarizerAgent, tool defs
  cli/            command entrypoints (one file per domain) + index.ts
  processors/     document ingestion (PDF/HTML/Text) behind DocumentProcessorFactory
  providers/      LLM, TTS (ElevenLabs/Hume/Cartesia/Kokoro/OpenAI/Grok), Perplexity, audio timeline/processing
  rag/            vector store + local embeddings
  repositories/   JSON-file persistence per domain
  services/       business logic per domain
  types/          shared types
  utils/          config, logger, validation
```

## Commands

```bash
pnpm install
pnpm build             # tsc -> dist/
pnpm dev                # run CLI from source via ts-node
pnpm test               # vitest run
npx vitest run <path>   # single test file
npx tsc --noEmit        # type-check only
```

Required env: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`. Optional: `ELEVENLABS_API_KEY`, `HUME_API_KEY`, `CARTESIA_API_KEY`, `DATA_DIR`/`AUDIO_DIR`/`SCRIPTS_DIR`/`EMBEDDINGS_DIR`.
