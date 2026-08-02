# Card hypergraph — design

## Problem

`DirectorAgent.createPodcastPlan()` prepares `EditorialCard[]` per material
(`MaterialPreparerAgent.prepare`), then dumps all cards as flat text into one
big planning prompt (`src/agents/DirectorAgent.ts:172-184`). The model has to
infer, from scratch and inside that single call, which cards connect to which
across materials. `EditorialCard.relatedCardIds` already exists for exactly
this purpose (`src/types/index.ts:277`) but is always set to `[]`
(`MaterialPreparerAgent.ts:83`, `:111`) and nothing reads it.

There is no persisted graph/relationship structure anywhere in the codebase
today — only the unused field above and per-plan, non-reusable prerequisite
chains (`DiscussionPoint.prerequisiteClaimIds`, `Claim.prerequisiteClaimIndexes`).

## Goal

Build a small hypergraph over `EditorialCard`s — a hyperedge connects 2+ cards
that share a concept, contrast, cause/effect, or narrative link — that:

1. Populates once cards are prepared, reusing the existing embedding service
   (no new dependency).
2. Gives `createPodcastPlan()` real connections to build a listener journey
   from, instead of asking the LLM to discover structure in raw text.
3. Is queryable mid-episode so `chooseNextSpeaker` / speaker agents can ask
   "what else connects to the card just spoken about" for on-the-fly
   transitions, not only at plan time.

## Why not an existing library

Checked npm/GitHub for lightweight hypergraph or LLM-graph-extraction
libraries (`yamafaktory/hypergraph`, `NamesJ/hypergraph-tools`, LightRAG,
GraphRAG-lite, OpenKE, PyKEEN). None fit: the JS/TS options are generic graph
toy libraries with no persistence or LLM-extraction story; the mature
LLM-graph-extraction projects (LightRAG, GraphRAG) are Python packages built
around their own vector/graph DBs (Neo4j, networkx) — adopting one would mean
a second storage engine and a cross-language boundary for a data shape (list
of `{cardIds, relationType}` records) that's maybe 150 lines to own directly.
The codebase's existing pattern — plain JSON via `BaseRepository`, embeddings
via the existing `EmbeddingService` interface — already covers what these
libraries provide for our case: candidate generation by similarity, edges
labelled by an LLM call.

## Data model

```ts
// src/types/index.ts — new additions near EditorialCard

export enum CardRelationType {
  Supports = "supports",       // one card is evidence/example for another
  Contrasts = "contrasts",     // opposing views, before/after, tension
  CausesOrLeadsTo = "causes_or_leads_to",
  SharesConcept = "shares_concept", // same underlying idea from different materials
  Extends = "extends",         // deepens/elaborates on the linked card(s)
  AnswersQuestion = "answers_question",
}

export interface CardHyperedge {
  id: string;
  cardIds: string[];       // 2+ EditorialCard ids; order not significant
  relationType: CardRelationType;
  rationale: string;       // one sentence, why these cards connect — used in prompts
  weight: number;          // 0-1, cosine similarity that generated the candidate
}
```

A hyperedge, not a pair-only edge, because the natural unit here is often
"these three cards from two different materials all illustrate the same
underlying mechanism" — forcing that into 3 separate pairwise edges loses the
fact that they form one cluster, and a listener path wants to know they're
interchangeable illustrations of the same point, not three separate facts.

## Components

Follows the existing Provider → Service → Repository layering.

### `CardGraphRepository` (`src/repositories/CardGraphRepository.ts`)

Extends `BaseRepository<CardHyperedge>`, same shape as `MaterialRepository`.
Stores one JSON file per hyperedge under `dataDir/card-graph`, scoped per
script (path `dataDir/card-graph/<scriptId>/<edgeId>.json`) — the graph is
episode-scoped like `editorialCards` already are, not a global cross-episode
graph, since cards themselves are regenerated per plan and materialIds aren't
guaranteed stable across episodes.

```ts
findByCardId(scriptId: string, cardId: string): Promise<CardHyperedge[]>;
```

### `CardGraphService` (`src/services/CardGraphService.ts`)

```ts
class CardGraphService {
  constructor(
    private readonly repository: CardGraphRepository,
    private readonly embeddingService: EmbeddingService, // reuse LocalEmbeddingService
    private readonly relationExtractor: CardRelationExtractorAgent
  ) {}

  async build(scriptId: string, cards: EditorialCard[]): Promise<CardHyperedge[]>;
  async getConnections(scriptId: string, cardId: string): Promise<CardHyperedge[]>;
}
```

`build()`:

1. Embed each card via `embeddingService.embedDocuments(cards.map(c =>
   `${c.content} ${c.significance}`))` — same call shape
   `DiscourseRoleMatcher` already uses (`src/agents/DiscourseRoleMatcher.ts:79`).
2. Cosine-prefilter: for each card, keep candidate partners above a similarity
   floor (e.g. top-K=5 and score > 0.55), skipping same-material pairs by
   default (same-material cards are usually connected implicitly by the
   synopsis already — cross-material links are the ones the plan actually
   needs help finding).
3. Cluster tightly-linked candidate pairs (union-find on similarity above a
   higher threshold, e.g. 0.75) into hyperedge groups of 2-4 cards, instead of
   emitting one hyperedge per pair.
4. Send each candidate group to `CardRelationExtractorAgent` in one batched
   structured-output call per script (not per pair — keep this to a single
   LLM call the way `assignSpeakerRoles` does one call for all speakers) to
   assign `relationType` + `rationale`, or reject the group as unrelated.
5. Persist accepted edges via the repository, and also backfill
   `card.relatedCardIds` on the in-memory `EditorialCard[]` so existing code
   that already reads that field (currently none, but it's the documented
   extension point) starts working.

### `CardRelationExtractorAgent` (`src/agents/CardRelationExtractorAgent.ts`)

Extends `BaseAgent`, same as `MaterialPreparerAgent`. One
`callModelForStructuredOutput` call, new `ModelTask.CardRelationExtraction`
routing entry (`src/providers/ModelRoutingPolicy.ts`), Zod schema in
`editorial-schemas.ts`:

```ts
export const cardRelationSchema = z.object({
  edges: z.array(z.object({
    cardIds: z.array(z.string()).min(2),
    relationType: z.nativeEnum(CardRelationType),
    rationale: z.string(),
  })),
});
```

Prompt gives the LLM the candidate groups (card id, kind, content,
significance for each member) and asks it to confirm/type/discard each group
— cheap because embeddings already did the expensive candidate search; the
LLM only judges a short list.

## Wiring into `createPodcastPlan`

`src/agents/DirectorAgent.ts:160-186`, right after `preparedMaterials` is
built and before `materialText` is assembled:

```ts
const allCards = preparedMaterials.flatMap((p) => p.cards);
const hyperedges = await this.cardGraphService.build(this.script.id, allCards);
```

Then extend the `materialText` block passed into the planning prompt with a
compact connections section, e.g.:

```
Known connections between cards:
- [shares_concept] m1-card-2, m3-card-1: both describe the same feedback loop
- [contrasts] m2-card-4, m1-card-5: opposing predictions about outcome
```

This gives the single planning LLM call pre-computed structure to route beats
through, instead of asking it to notice cross-material links unaided inside
an already large prompt.

## On-the-fly use during a turn

`chooseNextSpeaker` (`DirectorAgent.ts:363`) already assembles an
`editorialSection` from `this.getEditorialSection(...)`. Extend that call site
to also pull `cardGraphService.getConnections(scriptId, lastMentionedCardId)`
for the card(s) referenced in the most recent speech, and surface the
connected cards as candidate material for the *next* turn's direction — e.g.
"card X was just discussed; connections: Y (contrasts), Z (extends)". This
reuses the same repository lookup with no extra LLM call, since edges were
already computed at plan time; it only needs a cheap `findByCardId` read.
No new extraction happens mid-episode — the graph is fixed once per episode,
consistent with `editorialCards` and `discussionPoints` already being
pre-computed once per plan rather than incrementally.

## Cost / complexity

- No new runtime dependency.
- One extra LLM call per episode (batched relation extraction), sized by
  candidate-group count after cosine prefiltering, not by card-pair count —
  for a typical episode (2-4 materials, 6-12 cards each) this is tens of
  candidate groups, not hundreds of pairs.
- One extra embedding pass per episode over card text, same cost class as the
  existing `DiscourseRoleMatcher` embedding calls.
- New repository/service/agent files only; no changes to persistence
  mechanics (still per-script JSON, same as `editorialCards`).

## Open questions

- Similarity thresholds (0.55 prefilter / 0.75 cluster) are starting guesses;
  need tuning against real transcripts once implemented.
- Whether `getConnections` should also feed `SpeakerAgent.speak` directly
  (richer transitions) or stay Director-only for now — recommend starting
  Director-only and revisiting once the plan-time integration is proven.
- Cross-episode graph reuse (e.g. a recurring podcast revisiting the same
  material) is out of scope for v1; the model above is per-script.
