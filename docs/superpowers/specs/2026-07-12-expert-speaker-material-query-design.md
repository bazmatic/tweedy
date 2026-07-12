# Expert Speaker Semantic Material Query — Design

## Problem

`SpeakerAgent.getRelevantMaterials()` (`src/agents/SpeakerAgent.ts:258`) already gates access to script materials on `this.speaker.isExpert`, but the "relevance" is naive: it takes `script.materials.slice(0, 3)` and truncates each to 200 characters, regardless of what's actually being discussed. Meanwhile `RAGService` (`src/rag/RAGService.ts`) already implements semantic search (`searchRelevantContent`, `getContextForQuery`) over a vector store, but nothing wires it into script generation — `ScriptService` doesn't hold a `RAGService`, and no code path bulk-loads a script's materials into the vector store before generation runs.

We want expert speakers to pull material that's actually relevant to the current beat of conversation (the director's `direction` for this turn), not just the first few materials attached to the script.

## Approach

Wire `RAGService` into `ScriptService` and `SpeakerAgent` via constructor injection (matching the existing repository-injection pattern), populate the vector store once per script generation run, and replace the naive slice with a semantic search keyed on `direction`. Fall back to today's naive behavior if RAG is unavailable or returns nothing, so a script generation run never hard-fails because of this.

This stays a prompt-injection mechanism — no new agent tool. Experts still don't "decide" to look something up mid-turn; the relevant material is fetched and folded into the prompt before the model is called, same shape as today, just relevance-ranked.

## Changes

### `src/services/ScriptService.ts`

- Add `ragService: RAGService` as a new constructor parameter, stored as `this.ragService` alongside the existing repositories.
- At the top of `generateScriptContent` (before the turn loop starts), call `await this.ragService.addMaterials(script.materials)` once, so the vector store has this script's materials available for search. `RAGService.addMaterials` is not deduplicated by id — it just calls `vectorStore.addDocuments`, which appends to the in-memory `MemoryVectorStore` with no dedup. This is safe here only because each CLI invocation constructs a fresh `RAGService` (and its vector store) once, so the store never survives to see a second `generateScriptContent` call in practice. Reusing one `RAGService` instance across multiple `generateScriptContent` calls would insert duplicate documents. This call is wrapped in a try/catch so a RAG indexing failure logs a warning and lets the run continue rather than aborting it.
- Pass `this.ragService` into both `SpeakerAgent` instantiations in the turn loop: the main per-turn speaker (`new SpeakerAgent(speaker, this.ragService)`) and the interjection speaker (`new SpeakerAgent(interjector, this.ragService)`).

### Callers of `new ScriptService(...)`

- `src/cli/commands/ScriptCommands.ts` and `src/cli/commands/AudioCommands.ts` (wherever `ScriptService` is constructed) construct a `RAGService` and pass it in, matching how they already construct the other repositories.

### `src/agents/SpeakerAgent.ts`

- Constructor becomes `constructor(speaker: Speaker, ragService?: RAGService)`, storing `this.ragService`. Optional so any other caller/test that doesn't need expert material lookup isn't forced to supply one.
- `getRelevantMaterials` becomes:

```ts
private async getRelevantMaterials(script: PodcastScript, direction: string): Promise<string>
```

- If `this.ragService` is set: call `await this.ragService.searchRelevantContent(direction, 3)`, format each returned `Document` the same way materials are formatted today (`${title}: ${content.substring(0, 200)}...` using `doc.metadata.title` and `doc.content`), joined with blank lines.
- If `this.ragService` is undefined, the call throws, or it resolves to an empty array: fall back to the current naive behavior (`script.materials.slice(0, 3)...`) unchanged.
- `generateSpeech` awaits this (`await this.getRelevantMaterials(script, direction)`) and only invokes it when `this.speaker.isExpert`, same trigger condition as today.

### Not changing

- `interject()` — untouched. Interjections stay reactive one-liners; they don't gain material access.
- No new `SpeakerAgentToolName` / tool. `toLlmTools()` and tool availability are unchanged.
- `RAGService`/`VectorStore` internals are unchanged — this only adds a new caller of existing public methods.

## Testing

- `src/agents/SpeakerAgent.test.ts`: construct `SpeakerAgent` with a mock `RAGService` whose `searchRelevantContent` returns fixed documents; assert the prompt passed to `callModelWithTools` for an expert speaker contains the mock content, keyed on the `direction` argument passed to `speak()`.
- A fallback case: construct `SpeakerAgent` with `ragService: undefined` (or a mock that rejects/returns `[]`) and assert the prompt still contains material drawn from `script.materials` (today's naive slice), proving generation doesn't fail when RAG is unavailable.
- `src/services/ScriptService.test.ts` (or equivalent): assert `ragService.addMaterials` is called once with `script.materials` near the start of `generateScriptContent`, and that the `SpeakerAgent` constructor calls receive the injected `ragService`.

## Out of Scope

- No agent-invoked `LOOKUP_MATERIAL` tool — deferred per explicit decision during design.
- No fix for `LangChainVectorStore.persistStore`/`loadStore` being no-op stubs (existing known limitation, documented in `CLAUDE.md`) — the vector store stays in-memory, rebuilt per `generateScriptContent` call via the new `addMaterials` call, not persisted across CLI invocations.
- No change to `interject()`.
- Not fixing the stale `CLAUDE.md` claim that the vector store is "rebuilt from repository records on every CLI invocation" — flagged separately, not part of this feature.
