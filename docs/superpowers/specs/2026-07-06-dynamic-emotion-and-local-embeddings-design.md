# Design: Dynamic Per-Line Emotion for Cartesia/Hume + Local Embeddings for RAG

## Goal

Make Cartesia and Hume TTS output more dynamic, emotional, and real by using the per-line delivery style (`Speech.instructions`) that `SpeakerAgent` already generates per turn, instead of only a static per-voice setting. Matching Cartesia's free-text style to one of its fixed 54 emotion words requires semantic similarity, which requires an embedding model — and since the project already needs one for this, also hard-swap the existing RAG document-search embeddings from OpenAI to the same local model, removing an API dependency and cost from a system that doesn't need OpenAI-quality embeddings for a 54-word (or a few-thousand-document) matching problem.

## Non-goals

- No intensity levels for Cartesia emotion — Cartesia's `generation_config.emotion` is a single plain word (e.g. `"angry"`), not `word:level`. (Confirmed against `docs.cartesia.ai/build-with-cartesia/capability-guides/volume-speed-emotion` — the API silently ignores unrecognized/malformed values rather than rejecting them, so guessing at a `word:level` syntax previously used in ad hoc testing was actively wrong.)
- No per-line speed/volume derivation from style text (separate future work).
- No change to `IVocalProvider`, `SpeakerAgent`'s tool schema, or any other provider-agnostic interface.
- No configurable embedding backend switch (OpenAI vs. local) for RAG — this is a hard swap.
- No persistence/migration work for the vector store — `LangChainVectorStore.persistStore()`/`loadStore()` are currently no-op placeholders (nothing is persisted to disk today), so there is no existing embedded data to migrate.

## Part A: Cartesia and Hume per-line emotion

### Cartesia's emotion API (verified against live account + docs)

- `generation_config.emotion` accepts one of 54 fixed plain-word values. The 6 "primary" emotions with the best results are `neutral`, `calm`, `angry`, `content`, `sad`, `scared`; the full list of 54 also includes words like `excited`, `curious`, `nostalgic`, `flirtatious`, `skeptical`, `determined`, etc. (full list to be copied verbatim from the docs page into the implementation, not retyped from memory, to avoid transcription errors).
- Cartesia's docs warn that an emotion tag only takes effect when it's consistent with the transcript's actual sentiment — a mismatched tag is unlikely to change anything. This is a property of Cartesia's model, not something this design can control; it's a reason to expect diminishing (but not zero) returns from more exotic emotion matches.
- The API does not validate the `emotion` string server-side — unrecognized values are silently accepted and presumably ignored. This means correctness depends entirely on this implementation using exact, correctly-spelled values from the canonical list.

### `CartesiaEmotionMatcher` (new: `src/providers/CartesiaEmotionMatcher.ts`)

- Constructed with an `EmbeddingService` (dependency-injected, per the existing interface in `src/types/index.ts`).
- Holds the fixed list of Cartesia's 54 emotion words as a local constant.
- Lazily embeds all 54 words once per process (cached in memory — same "delay until first use" pattern already used by `LangChainEmbeddingService`).
- `async match(style: string | undefined): Promise<string | undefined>`:
  - Returns `undefined` immediately if `style` is empty/undefined.
  - Otherwise embeds `style`, computes cosine similarity against the 54 cached emotion-word embeddings, and returns the closest word if its similarity is at or above a threshold constant (`EMOTION_MATCH_THRESHOLD = 0.75`, tunable later — not exposed as user config for this iteration).
  - Returns `undefined` if nothing clears the threshold, so an ambiguous or purely descriptive style (e.g. "matter-of-fact") doesn't force a bad match.
- A small local `cosineSimilarity(a: number[], b: number[]): number` helper lives in this file — it's a few lines and specific to this matcher, not worth generalizing into a shared util for a single caller.

### `CartesiaProvider` changes

- Constructor builds `new CartesiaEmotionMatcher(new LocalEmbeddingService())` internally (matching how other providers self-construct dependencies — there's no DI container in this codebase).
- In `tts()`, replace the current `if (options.emotion !== undefined) generationConfig.emotion = options.emotion` line with:
  1. `const matchedEmotion = await this.emotionMatcher.match(params.speech.instructions);`
  2. Use `matchedEmotion` if present, else fall back to `options.emotion` (the existing static per-voice `providerOptions.emotion`), else omit the field entirely.
- `speed` and `volume` continue to come only from `providerOptions` as before (no per-line derivation, per non-goals).

### `HumeProvider` changes

- No matching needed — Hume's `description` field takes free text.
- In `tts()`, change the `description` value from `params.voice.settings.instructions` alone to a combination: join `voice.settings.instructions` (persona/voice baseline) and `params.speech.instructions` (this line's delivery direction) with `. ` when both are present; use whichever one is present if only one is; omit `description` if neither is set (matches current behavior when `instructions` is undefined).

## Part B: Local embeddings (shared infrastructure + RAG hard-swap)

### `src/rag/local-embeddings.ts` (new)

The single shared implementation both Part A and Part B build on, avoiding loading the embedding model twice or duplicating the `@xenova/transformers` integration:

- Loads the `@xenova/transformers` feature-extraction pipeline for `Xenova/all-MiniLM-L6-v2`, lazily, cached as a module-level singleton (loaded at most once per process).
- Exposes `embedText(text: string): Promise<number[]>` and `embedTexts(texts: string[]): Promise<number[][]>`.
- First run downloads and caches the model (~90MB) via transformers.js's own caching; subsequent runs are fully offline.

### `src/rag/LocalEmbeddingService.ts` (new)

Thin adapter implementing the existing `EmbeddingService` interface (`embedText`/`embedDocuments`) by delegating to `local-embeddings.ts`. Used by `CartesiaEmotionMatcher` (Part A) and available generally wherever `EmbeddingService` is used.

### `src/rag/LocalLangChainEmbeddings.ts` (new)

Thin adapter extending LangChain's `Embeddings` base class (`embedDocuments`/`embedQuery`), delegating to the same `local-embeddings.ts`. Needed because `MemoryVectorStore` (used by `LangChainVectorStore`) requires a LangChain `Embeddings` instance, which has a different method shape than this project's own `EmbeddingService` interface — hence two thin adapters over one shared core rather than one adapter or a duplicated implementation.

### `LangChainVectorStore` changes (`src/rag/VectorStore.ts`)

- `ensureInitialized()`: remove the `OPENAI_API_KEY` required-env check and the `OpenAIEmbeddings` construction; replace with `new LocalLangChainEmbeddings()` passed into `new MemoryVectorStore(...)`.
- Remove the now-unused `OpenAIEmbeddings` import.

### `RAGService` changes (`src/rag/RAGService.ts`)

- Remove the `embeddingService: EmbeddingService` field and its `LangChainEmbeddingService` import/construction. This field is currently constructed but never called anywhere in the class — `searchRelevantContent`/`getContextForQuery` go through `vectorStore.similaritySearch` directly, which does its own embedding internally via `MemoryVectorStore`. This is pre-existing dead code; since this change is already touching the embedding backend, remove it now rather than leave dead code referencing the OpenAI dependency being replaced.

### Config cleanup (`src/types/index.ts`, `src/utils/config.ts`, `src/cli/index.ts`)

- Remove `defaultEmbeddingModel` from `AppConfig` and its `DEFAULT_EMBEDDING_MODEL` env var handling in `loadConfig()`. It currently holds an OpenAI model name (`"text-embedding-3-small"`) used only by the two files above being changed; once nothing reads it, it becomes dead configuration.
- Remove or update the line in `src/cli/index.ts` (`status` command) that prints `Default Embedding Model: ${appConfig.defaultEmbeddingModel}` — either delete the line, or replace it with a hardcoded mention of the local model name (implementer's judgment; deleting is simpler and avoids a stale-looking hardcoded string).

### `OPENAI_API_KEY` impact

- Still required for `OpenAIProvider` (TTS) and is unrelated to Claude/Anthropic calls (separate key). This change only removes the RAG-specific requirement that `validateConfig()`/`LangChainVectorStore` previously enforced. `validateConfig()`'s required-vars list (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) in `src/utils/config.ts` is unrelated to this RAG-specific check inside `VectorStore.ensureInitialized()` and does not need to change — `OPENAI_API_KEY` remains required overall because of `OpenAIProvider`.

## New dependency

`@xenova/transformers`, added once, shared by Parts A and B.

## Error handling

- `CartesiaEmotionMatcher.match()` doesn't throw for empty/undefined style — returns `undefined`, which is a normal, expected "no match" outcome handled by the existing fallback chain in `CartesiaProvider.tts()`.
- If the local model fails to load (e.g. disk/network issue on first run), errors propagate normally through the existing try/catch in whichever caller triggered the lazy load — no special handling is added, consistent with how other providers currently propagate construction/request errors.

## Testing

No test framework exists in this codebase (established in the prior Hume/Cartesia providers work) — verification is via `npm run build` (type-checking) plus manual smoke testing:
- Cartesia: synthesize a few lines with clearly different styles (e.g. "excited and enthusiastic" vs. "somber and quiet") and confirm the matcher selects sensibly different emotion words (log the matched word during manual testing, don't ship the log).
- RAG: run an existing material-search flow end-to-end and confirm results are still relevant now that embeddings come from the local model instead of OpenAI — retrieval quality is expected to differ somewhat (MiniLM is a much smaller model), so this is a sanity check, not a strict regression test.
