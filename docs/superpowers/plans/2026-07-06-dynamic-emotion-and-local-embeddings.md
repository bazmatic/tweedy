# Dynamic Per-Line Emotion and Local Embeddings Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cartesia and Hume TTS output reflect each line's actual delivery style (not just a static per-voice setting) by matching `SpeakerAgent`'s per-line style text to Cartesia's fixed emotion vocabulary via local embedding similarity, and hard-swap RAG's document-search embeddings from OpenAI to the same local model.

**Architecture:** A single shared module (`local-embeddings.ts`) loads a small local embedding model via `@xenova/transformers` once per process. Two thin adapters expose it through the project's existing `EmbeddingService` interface and LangChain's `Embeddings` base class respectively. `CartesiaEmotionMatcher` uses the former to do cosine-similarity matching against Cartesia's 54 emotion words; `LangChainVectorStore` uses the latter in place of `OpenAIEmbeddings`. `HumeProvider` needs no matching — it just concatenates free text.

**Tech Stack:** TypeScript, `@xenova/transformers` (new dependency), existing `langchain`/`@langchain/openai` (removing usage, not the packages), axios.

**Note on testing:** This codebase has no test framework (no jest/vitest, no `*.test.ts` files) — see the prior Hume/Cartesia providers plan for the same note. Verification is via `npm run build` and manual smoke tests, consistent with the rest of the codebase.

---

## Chunk 1: Shared local embedding infrastructure

### Task 1: Add the `@xenova/transformers` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the dependency**

In `package.json`, add to `"dependencies"` (keep alphabetical, so between `"axios"` and `"chalk"`... actually check current ordering — the list isn't strictly alphabetical already, so just add it near the top of dependencies, after `"@anthropic-ai/sdk"`):

```json
    "@xenova/transformers": "^2.17.2",
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: installs successfully, `@xenova/transformers` appears in `pnpm-lock.yaml`.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add @xenova/transformers for local embeddings"
```

---

### Task 2: Create the shared local embedding core

**Files:**
- Create: `src/rag/local-embeddings.ts`

- [ ] **Step 1: Write the module**

```ts
import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

let pipelinePromise: Promise<FeatureExtractionPipeline> | undefined;

function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = pipeline('feature-extraction', MODEL_NAME) as Promise<FeatureExtractionPipeline>;
  }
  return pipelinePromise;
}

export async function embedText(text: string): Promise<number[]> {
  const extractor = await getPipeline();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  return Promise.all(texts.map((text) => embedText(text)));
}
```

**Note for implementer:** `@xenova/transformers`'s exact TypeScript types for `pipeline()`/`FeatureExtractionPipeline` can be finicky across versions. If `FeatureExtractionPipeline` isn't exported under that name, check the package's `.d.ts` (`node_modules/@xenova/transformers/types/`) for the correct type name, or fall back to typing `getPipeline()`'s return as the awaited return type of `pipeline(...)` using `Awaited<ReturnType<typeof pipeline>>`. Don't use `any` for this without a comment explaining why, per this repo's TypeScript rules.

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: succeeds. (First run of any code that actually calls `embedText`/`embedTexts` will download the model — that happens in Task 4/8's smoke tests, not here, since this task only adds the module.)

- [ ] **Step 3: Commit**

```bash
git add src/rag/local-embeddings.ts
git commit -m "feat: add shared local embedding core using transformers.js"
```

---

### Task 3: Create `LocalEmbeddingService` (EmbeddingService adapter)

**Files:**
- Create: `src/rag/LocalEmbeddingService.ts`

- [ ] **Step 1: Write the adapter**

```ts
import { EmbeddingService } from '../types';
import { embedText, embedTexts } from './local-embeddings';

export class LocalEmbeddingService implements EmbeddingService {
  async embedText(text: string): Promise<number[]> {
    return embedText(text);
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    return embedTexts(documents);
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/rag/LocalEmbeddingService.ts
git commit -m "feat: add LocalEmbeddingService implementing EmbeddingService"
```

---

### Task 4: Create `LocalLangChainEmbeddings` (LangChain adapter) and smoke-test the core

**Files:**
- Create: `src/rag/LocalLangChainEmbeddings.ts`

- [ ] **Step 1: Write the adapter**

```ts
import { Embeddings } from 'langchain/embeddings/base';
import { embedText, embedTexts } from './local-embeddings';

export class LocalLangChainEmbeddings extends Embeddings {
  constructor() {
    super({});
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    return embedTexts(documents);
  }

  async embedQuery(text: string): Promise<number[]> {
    return embedText(text);
  }
}
```

**Note for implementer:** importing from `langchain/embeddings/base` currently works but logs a deprecation warning pointing at `@langchain/core/embeddings`. This codebase already imports other LangChain pieces via the `langchain` package path (see `src/rag/VectorStore.ts`'s imports), so match that existing convention rather than introducing a new import path unless `@langchain/core/embeddings` is confirmed resolvable as a direct dependency (it wasn't at plan-writing time — it resolved as a nested dependency, not a top-level importable path).

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual smoke test of the shared core**

Run:
```bash
node -e "
const { embedText } = require('./dist/rag/local-embeddings');
embedText('hello world').then(v => console.log('vector length:', v.length)).catch(e => { console.error(e); process.exit(1); });
"
```
Expected: prints `vector length: 384` (all-MiniLM-L6-v2's output dimension). First run downloads the model (~90MB) — this may take a minute or two and requires network access; subsequent runs are fast and offline.

If this fails, do not proceed to later tasks — debug the model loading here first, since everything else in this plan depends on it working.

- [ ] **Step 4: Commit**

```bash
git add src/rag/LocalLangChainEmbeddings.ts
git commit -m "feat: add LocalLangChainEmbeddings adapter for MemoryVectorStore"
```

---

## Chunk 2: RAG hard-swap to local embeddings

### Task 5: Point `LangChainVectorStore` at local embeddings

**Files:**
- Modify: `src/rag/VectorStore.ts`

- [ ] **Step 1: Update imports and `ensureInitialized()`**

Current relevant code:
```ts
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { OpenAIEmbeddings } from "@langchain/openai";
```
and
```ts
export class LangChainVectorStore implements VectorStore {
  private vectorStore?: MemoryVectorStore;
  private embeddings?: OpenAIEmbeddings;
  ...
  private ensureInitialized(): void {
    if (!this.embeddings) {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error(
          "OPENAI_API_KEY environment variable is required for RAG functionality"
        );
      }
      this.embeddings = new OpenAIEmbeddings({
        modelName: appConfig.defaultEmbeddingModel,
        openAIApiKey: process.env.OPENAI_API_KEY!,
      });
      this.vectorStore = new MemoryVectorStore(this.embeddings);
    }
  }
```

Change to:
```ts
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { LocalLangChainEmbeddings } from "./LocalLangChainEmbeddings";
```
and
```ts
export class LangChainVectorStore implements VectorStore {
  private vectorStore?: MemoryVectorStore;
  private embeddings?: LocalLangChainEmbeddings;
  ...
  private ensureInitialized(): void {
    if (!this.embeddings) {
      this.embeddings = new LocalLangChainEmbeddings();
      this.vectorStore = new MemoryVectorStore(this.embeddings);
    }
  }
```

Remove the now-unused `appConfig` import if `appConfig` isn't referenced elsewhere in this file — check with `grep -n appConfig src/rag/VectorStore.ts` before removing; `appConfig.defaultChunkSize`/`defaultChunkOverlap` are still used in the constructor, so `appConfig` itself should stay imported, only the `OpenAIEmbeddings` import and the `OPENAI_API_KEY` check go away.

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/rag/VectorStore.ts
git commit -m "feat: switch LangChainVectorStore to local embeddings"
```

---

### Task 6: Remove dead `embeddingService` field from `RAGService`

**Files:**
- Modify: `src/rag/RAGService.ts`

- [ ] **Step 1: Remove the unused field and its import**

Current:
```ts
import { VectorStore, EmbeddingService, Document, PodcastMaterial } from '../types';
import { LangChainVectorStore } from './VectorStore';
import { LangChainEmbeddingService } from './EmbeddingService';
import { logger } from '../utils/logger';

export class RAGService {
  private vectorStore: VectorStore;
  private embeddingService: EmbeddingService;

  constructor() {
    this.vectorStore = new LangChainVectorStore();
    this.embeddingService = new LangChainEmbeddingService();
  }
```

Change to:
```ts
import { VectorStore, Document, PodcastMaterial } from '../types';
import { LangChainVectorStore } from './VectorStore';
import { logger } from '../utils/logger';

export class RAGService {
  private vectorStore: VectorStore;

  constructor() {
    this.vectorStore = new LangChainVectorStore();
  }
```

Verify with `grep -n "embeddingService" src/rag/RAGService.ts` that no other method in the file references `this.embeddingService` before removing it — per the design, it's confirmed dead code, but double-check in case this specific file has drifted since the design was written.

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/rag/RAGService.ts
git commit -m "refactor: remove unused embeddingService field from RAGService"
```

---

### Task 7: Remove the now-unused `LangChainEmbeddingService` and `defaultEmbeddingModel` config

**Files:**
- Delete: `src/rag/EmbeddingService.ts`
- Modify: `src/rag/index.ts`
- Modify: `src/types/index.ts`
- Modify: `src/utils/config.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Confirm nothing else references `LangChainEmbeddingService`**

Run: `grep -rn "LangChainEmbeddingService" src`
Expected: only `src/rag/EmbeddingService.ts` (its own definition) and `src/rag/index.ts` (its export) — RAGService's reference was removed in Task 6. If anything else shows up, stop and report back rather than deleting.

- [ ] **Step 2: Delete the file and its export**

```bash
rm src/rag/EmbeddingService.ts
```

In `src/rag/index.ts`, remove the line:
```ts
export { LangChainEmbeddingService } from './EmbeddingService';
```

- [ ] **Step 3: Remove `defaultEmbeddingModel` from `AppConfig`**

In `src/types/index.ts`, find:
```ts
export interface AppConfig {
  dataDir: string;
  audioDir: string;
  scriptsDir: string;
  embeddingsDir: string;
  defaultVoiceProvider: VocalProviderName;
  defaultEmbeddingModel: string;
  defaultChunkSize: number;
  defaultChunkOverlap: number;
}
```
Remove the `defaultEmbeddingModel: string;` line.

- [ ] **Step 4: Remove it from `loadConfig()`**

In `src/utils/config.ts`, find:
```ts
    defaultEmbeddingModel:
      process.env.DEFAULT_EMBEDDING_MODEL || "text-embedding-3-small",
```
Delete these two lines.

- [ ] **Step 5: Remove the CLI status line**

In `src/cli/index.ts`, find and delete:
```ts
      console.log(
        `  Default Embedding Model: ${appConfig.defaultEmbeddingModel}`
      );
```

- [ ] **Step 6: Type-check**

Run: `npm run build`
Expected: succeeds with no errors (confirms no remaining references to the removed field/class).

- [ ] **Step 7: Commit**

```bash
git add -A src/rag/EmbeddingService.ts src/rag/index.ts src/types/index.ts src/utils/config.ts src/cli/index.ts
git commit -m "refactor: remove OpenAI-based embedding service and defaultEmbeddingModel config"
```

---

### Task 8: Manual smoke test of RAG with local embeddings

**Files:** none (verification only)

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 2: Add a test material and search for it**

Run:
```bash
node dist/index.js material add --text "The Eiffel Tower is located in Paris, France, and was completed in 1889." --name "Eiffel Tower Fact"
node dist/index.js material search "landmark in Paris"
```
Expected: the search returns the Eiffel Tower material (or at least doesn't error) — confirms `LangChainVectorStore`/`RAGService` work end-to-end without `OPENAI_API_KEY` needing to be involved in this path. If the CLI doesn't expose a direct `material search` wired to `RAGService.searchRelevantContent` specifically, check `src/cli/commands/` for the actual material search command name and adjust.

- [ ] **Step 3: Report and fix if needed**

If search fails or returns clearly wrong results, investigate whether `LocalLangChainEmbeddings`/`MemoryVectorStore` are wired correctly (e.g. check `pooling`/`normalize` options in `local-embeddings.ts` — inconsistent normalization between document and query embeddings is a common cause of bad cosine-similarity results). Fix, rebuild, retest, then commit any fix separately.

---

## Chunk 3: Per-line emotion for Cartesia and Hume

### Task 9: Create `CartesiaEmotionMatcher`

**Files:**
- Create: `src/providers/CartesiaEmotionMatcher.ts`

- [ ] **Step 1: Write the matcher**

```ts
import { EmbeddingService } from '../types';

const EMOTION_MATCH_THRESHOLD = 0.75;

// Full list of Cartesia's supported emotion words, verbatim from
// https://docs.cartesia.ai/build-with-cartesia/capability-guides/volume-speed-emotion
const CARTESIA_EMOTIONS = [
  'neutral', 'happy', 'excited', 'enthusiastic', 'elated', 'euphoric',
  'triumphant', 'amazed', 'surprised', 'flirtatious', 'curious', 'content',
  'peaceful', 'serene', 'calm', 'grateful', 'affectionate', 'trust',
  'sympathetic', 'anticipation', 'mysterious', 'angry', 'mad', 'outraged',
  'frustrated', 'agitated', 'threatened', 'disgusted', 'contempt', 'envious',
  'sarcastic', 'ironic', 'sad', 'dejected', 'melancholic', 'disappointed',
  'hurt', 'guilty', 'bored', 'tired', 'rejected', 'nostalgic', 'wistful',
  'apologetic', 'hesitant', 'insecure', 'confused', 'resigned', 'anxious',
  'panicked', 'alarmed', 'scared', 'proud', 'confident', 'distant',
  'skeptical', 'contemplative', 'determined',
];

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class CartesiaEmotionMatcher {
  private emotionEmbeddings?: number[][];

  constructor(private readonly embeddingService: EmbeddingService) {}

  private async getEmotionEmbeddings(): Promise<number[][]> {
    if (!this.emotionEmbeddings) {
      this.emotionEmbeddings = await this.embeddingService.embedDocuments(CARTESIA_EMOTIONS);
    }
    return this.emotionEmbeddings;
  }

  async match(style: string | undefined): Promise<string | undefined> {
    if (!style || style.trim().length === 0) {
      return undefined;
    }

    const [styleEmbedding, emotionEmbeddings] = await Promise.all([
      this.embeddingService.embedText(style),
      this.getEmotionEmbeddings(),
    ]);

    let bestIndex = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < emotionEmbeddings.length; i++) {
      const score = cosineSimilarity(styleEmbedding, emotionEmbeddings[i]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex === -1 || bestScore < EMOTION_MATCH_THRESHOLD) {
      return undefined;
    }

    return CARTESIA_EMOTIONS[bestIndex];
  }
}
```

**Note for implementer:** double-check the `CARTESIA_EMOTIONS` list against the live docs page (`https://docs.cartesia.ai/build-with-cartesia/capability-guides/volume-speed-emotion.md` — append `.md` to get raw markdown instead of the JS-rendered page) before committing, in case the list has changed since this plan was written.

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/providers/CartesiaEmotionMatcher.ts
git commit -m "feat: add CartesiaEmotionMatcher for style-to-emotion matching"
```

---

### Task 10: Wire `CartesiaEmotionMatcher` into `CartesiaProvider`

**Files:**
- Modify: `src/providers/CartesiaProvider.ts`

- [ ] **Step 1: Add the matcher as a constructor dependency**

Add imports:
```ts
import { CartesiaEmotionMatcher } from './CartesiaEmotionMatcher';
import { LocalEmbeddingService } from '../rag/LocalEmbeddingService';
```

Add a field and initialize it in the constructor:
```ts
export class CartesiaProvider extends BaseVocalProvider {
  private apiKey: string;
  private baseUrl = 'https://api.cartesia.ai';
  private emotionMatcher: CartesiaEmotionMatcher;

  constructor() {
    super();
    this.apiKey = process.env.CARTESIA_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('CARTESIA_API_KEY environment variable is required');
    }
    this.emotionMatcher = new CartesiaEmotionMatcher(new LocalEmbeddingService());
  }
```

- [ ] **Step 2: Use the matcher in `tts()`**

Current:
```ts
      const options = params.voice.settings.providerOptions || {};
      const generationConfig: Record<string, unknown> = {};
      if (options.emotion !== undefined) generationConfig.emotion = options.emotion;
      if (options.speed !== undefined) generationConfig.speed = options.speed;
      if (options.volume !== undefined) generationConfig.volume = options.volume;
```

Change to:
```ts
      const options = params.voice.settings.providerOptions || {};
      const matchedEmotion = await this.emotionMatcher.match(params.speech.instructions);
      const emotion = matchedEmotion ?? options.emotion;

      const generationConfig: Record<string, unknown> = {};
      if (emotion !== undefined) generationConfig.emotion = emotion;
      if (options.speed !== undefined) generationConfig.speed = options.speed;
      if (options.volume !== undefined) generationConfig.volume = options.volume;
```

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/providers/CartesiaProvider.ts
git commit -m "feat: use per-line style to pick Cartesia emotion via embedding match"
```

---

### Task 11: Combine per-line style into Hume's `description`

**Files:**
- Modify: `src/providers/HumeProvider.ts`

- [ ] **Step 1: Update the `description` field**

Current:
```ts
      const response = await axios.post(
        `${this.baseUrl}/tts`,
        {
          utterances: [
            {
              text: params.speech.message,
              voice: { id: params.voice.providerId },
              description: params.voice.settings.instructions,
              ...(speed !== undefined ? { speed } : {}),
            },
          ],
        },
```

Change to (add this small helper above the class, or as a private method — a private method is more consistent with this file's existing style of small focused methods):

```ts
  private buildDescription(params: VocalProviderTtsParams): string | undefined {
    const parts = [params.voice.settings.instructions, params.speech.instructions].filter(
      (part): part is string => Boolean(part && part.trim().length > 0)
    );
    return parts.length > 0 ? parts.join('. ') : undefined;
  }
```

And in `tts()`:
```ts
      const response = await axios.post(
        `${this.baseUrl}/tts`,
        {
          utterances: [
            {
              text: params.speech.message,
              voice: { id: params.voice.providerId },
              description: this.buildDescription(params),
              ...(speed !== undefined ? { speed } : {}),
            },
          ],
        },
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/providers/HumeProvider.ts
git commit -m "feat: combine per-line style with voice instructions in Hume description"
```

---

### Task 12: Manual smoke test of per-line emotion matching

**Files:** none (verification only) — requires `HUME_API_KEY`/`CARTESIA_API_KEY` in `.env`

- [ ] **Step 1: Build**

Run: `npm run build`

- [ ] **Step 2: Test the matcher directly with varied styles**

Run:
```bash
node -e "
const { CartesiaEmotionMatcher } = require('./dist/providers/CartesiaEmotionMatcher');
const { LocalEmbeddingService } = require('./dist/rag/LocalEmbeddingService');
const matcher = new CartesiaEmotionMatcher(new LocalEmbeddingService());
(async () => {
  for (const style of ['excited and enthusiastic, leaning in', 'somber and quiet, almost whispering', 'matter-of-fact, reading from notes', 'skeptical, raising an eyebrow']) {
    console.log(style, '->', await matcher.match(style));
  }
})();
"
```
Expected: each style prints a plausible emotion word (e.g. "excited and enthusiastic..." → `excited` or similar; "matter-of-fact..." likely → `undefined` since it's not emotionally charged). Use judgment — exact matches aren't guaranteed, but results should be directionally sensible, not random.

- [ ] **Step 3: End-to-end TTS smoke test**

Using a real Cartesia voice ID (from `node dist/index.js voice list` after `voice import -p cartesia`, per the prior Hume/Cartesia plan's Task 7), synthesize two lines with clearly different styles through whatever code path exercises `IVocalProvider.tts()` with a populated `Speech.instructions` (check `src/services/AudioService.ts`'s `generateSpeechAudio` — it passes the full `speech` object through already, so this should work via the normal script-generation flow, or via a throwaway script like the one used in the prior plan's Task 7). Confirm audio files are produced and listen for an audible difference in delivery between the two styles.

- [ ] **Step 4: Fix and re-test if the matcher or provider wiring has issues**

If results are clearly wrong (e.g. always returns the same emotion regardless of style, or always `undefined`), check: is `params.speech.instructions` actually populated by `SpeakerAgent` in this flow? Is `EMOTION_MATCH_THRESHOLD` too high/low? Fix, rebuild, retest, commit fixes separately.

```bash
git add src/providers/CartesiaEmotionMatcher.ts
git commit -m "fix: adjust emotion matching based on live smoke test findings"
```
(Skip this commit if no fixes were needed.)

---

## Done criteria

- `npm run build` passes with no errors.
- RAG document search works without `OPENAI_API_KEY` being read anywhere in `src/rag/`.
- `OpenAIProvider` (TTS) and Claude/Anthropic calls still work — `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` remain required overall, just not for RAG specifically.
- Cartesia TTS lines with different per-line styles produce different `generation_config.emotion` values (verified in Task 12).
- Hume TTS `description` includes both the voice's baseline instructions and the per-line style when both are present.
- Manual smoke tests (Tasks 4, 8, 12) have been run, or their absence explicitly reported.
