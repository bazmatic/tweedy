# Tweedy CLI - AI-Powered Podcast Generation

A TypeScript CLI application that generates podcasts from various inputs using RAG-enhanced content generation and AI agents.

## Features

- **RAG-Enhanced Content Generation**: Uses semantic search to retrieve relevant content
- **Multiple Input Sources**: Claude queries, document folders, web pages
- **AI Agent System**: Director and Speaker agents for natural conversation flow
- **Voice Management**: Support for ElevenLabs, OpenAI, Hume, and Cartesia TTS providers
- **Document Processing**: PDF, text, markdown, and HTML support
- **Audio Processing**: FFmpeg integration for high-quality audio output

## Architecture

The system follows a clean architecture pattern with clear separation of concerns:

```
┌─────────────────────────────────────┐
│           CLI Layer                  │
├─────────────────────────────────────┤
│         Service Layer               │
│  ┌─────────────────────────────────┐│
│  │        RAG Service              ││
│  │  ┌─────────────────────────────┐││
│  │  │    Vector Store Service    │││
│  │  └─────────────────────────────┘││
│  └─────────────────────────────────┘│
├─────────────────────────────────────┤
│       Repository Layer              │
├─────────────────────────────────────┤
│        Provider Layer               │
│  ┌─────────────────────────────────┐│
│  │    AI Providers (Claude)       ││
│  │    TTS Providers (4 vendors)   ││
│  │    Document Loaders            ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

## How Tweedy Creates Engaging Episodes

Tweedy does more than divide source material between speakers. It prepares the
material as editorial ingredients, designs a listener journey, and gives each
speaker a specific conversational job. The aim is to balance three outcomes:

- **Understanding** — listeners can follow and remember the subject.
- **Entertainment** — the conversation has personality, variety, surprise, and
  momentum.
- **Insight** — important connections, tensions, and meanings have room to
  emerge when the material supports them.

No individual turn must achieve all three. A short reaction may improve rhythm;
an analogy may make a difficult idea understandable; a story may create an
emotional connection; and a reflective turn may draw out a broader meaning.

### Editorial Flow

```text
Source materials
      ↓
MaterialPreparerAgent
      ↓
Editorial cards
      ↓
DirectorAgent
      ↓
Episode plan and conversation beats
      ↓
Turn brief
      ↓
SpeakerAgent
      ↓
TurnReviewerAgent
      ↓
Accepted speech and updated conversation state
```

The stages deliberately have separate responsibilities:

1. **Prepare the material.** `MaterialPreparerAgent` identifies useful facts,
   explanations, examples, stories, characters, quotes, vivid details,
   surprises, humour opportunities, tensions, perspectives, connections,
   takeaways, and open questions. These become reusable `EditorialCard`
   records tied back to their source material.
2. **Design the episode.** `DirectorAgent` arranges the material into
   `ConversationBeat` records that describe the listener's journey rather than
   merely listing facts to mention.
3. **Direct the next turn.** The director produces a `TurnBrief` describing
   the next speaker's goal, editorial move, source cards, audience value, and
   desired energy.
4. **Perform the turn.** `SpeakerAgent` turns that brief into concise,
   natural speech consistent with the speaker's personality and role.
5. **Review the result.** `TurnReviewerAgent` judges the speech according to
   its assigned purpose. It does not demand analysis from a story, humour from
   an explanation, or profundity from a brief reaction.

`ConversationRhythmPolicy` also watches recent speech types. It recommends a
substantive turn after too many reactions, or a question, reframe, or lighter
turn after several information-heavy contributions.

### Beats and Moves

A **beat** describes where the episode is going. A **move** describes what one
speaker does next.

| Concept | Scale | Question it answers |
| --- | --- | --- |
| `ConversationBeat` | One or more turns | What should this stage of the episode accomplish? |
| `BeatPurpose` | Episode structure | Why does this stage exist? |
| `TurnBrief` | One speaker turn | What contribution is needed now? |
| `EditorialMove` | One speaker turn | What should the speaker do? |

Beat purposes include welcoming, hooking, orienting, explaining, illustrating,
surprising, exploring, challenging, reflecting, paying off, recapping, and
closing. Editorial moves include explaining, telling a story, adding context,
comparing, contrasting, connecting, reframing, questioning, challenging,
reacting, humanising, finding meaning, summarising, and transitioning.

For example, an episode might contain this beat:

```text
Beat purpose: Explore
Goal: Explore why an early rejection became a source of motivation.
Target: Three turns
```

The director could serve that beat through several different moves:

```text
Turn 1 — TellStory: describe the rejection letter kept above the desk
Turn 2 — Question: ask whether it motivated the subject or preserved the hurt
Turn 3 — FindMeaning: connect the anecdote to the subject's later identity
```

The same distinction applies when both levels use a similar word. An
`Explain` beat means that a stage of the episode exists to build understanding.
It might be delivered through `Question`, `Explain`, `Illustrate`, and
`Reframe` moves across several turns. Conversely, an `Explain` move can serve
an `Orient`, `Explore`, `Challenge`, or `Payoff` beat.

### The Supporting Concepts

- `EditorialCard` answers **what useful material is available**.
- `ConversationBeat` answers **where the episode is taking the listener**.
- `BeatPurpose` answers **why that stage exists**.
- `TurnBrief` answers **what the next contribution must accomplish**.
- `EditorialMove` answers **what the speaker should do**.
- `AudienceValue` answers **what the listener gains**: understanding,
  entertainment, insight, momentum, or connection.
- `EnergyLevel` answers **how the moment should feel**.
- `ConversationalDevice` offers an optional technique such as a vivid image,
  callback, contrast, reveal, or humour.

Discussion points remain separate from beats. A `DiscussionPoint` protects
against omitting required subject matter; a `ConversationBeat` tracks whether
the episode has achieved an editorial purpose. Mentioning every fact is not the
same as creating a satisfying episode.

### Established Foundations

Tweedy's exact taxonomy is custom, but it adapts several established ideas:

- **Story beats and beat sheets** from dramatic writing organise important
  moments into a progression that creates momentum and payoff. See
  [Learn About Beats in Screenwriting](https://www.masterclass.com/articles/what-is-a-beat-in-screenwriting).
- **Rhetorical moves** describe functional parts of discourse that accomplish
  communicative purposes. See
  [Move Analysis](https://onlinelibrary.wiley.com/doi/10.1002/9781405198431.wbeal1485).
- **Dialogue acts** describe actions performed through an utterance, such as
  questioning, informing, acknowledging, or challenging. See
  [ISO 24617-2:2020](https://www.iso.org/standard/76443.html).
- **Hierarchical dialogue planning** separates longer-term conversational goals
  from individual dialogue actions and their natural-language realisation. See
  [Follow Me: Conversation Planning for Target-driven Recommendation Dialogue Systems](https://arxiv.org/abs/2208.03516)
  and
  [Learning to Plan and Realize Separately for Open-Ended Dialogue Systems](https://aclanthology.org/2020.findings-emnlp.247/).

The combined pipeline is not an industry-standard podcast framework. It is
Tweedy's synthesis of these techniques for generating conversations that feel
purposeful without becoming rigid or formulaic.

## Installation

Requires Node.js 20 or later and pnpm.

1. Clone the repository:

```bash
git clone <repository-url>
cd tweedy
```

2. Install dependencies:

```bash
pnpm install
```

3. Build the project:

```bash
pnpm build
```

4. Set up environment variables:

```bash
cp env.example .env
# Edit .env with your API keys
```

5. (Optional) Make the `tweedy` command available globally:

```bash
pnpm link --global
```

This symlinks the built CLI into your global pnpm bin directory, so you can run `tweedy` from anywhere instead of `node dist/index.js`. Since it's a symlink, `tweedy` will always reflect the latest build — just re-run `pnpm build` after making changes.

## Configuration

Required environment variables:

- `OPENAI_API_KEY`: OpenAI API key for embeddings and TTS
- `ANTHROPIC_API_KEY`: Anthropic API key for Claude AI agents

Optional environment variables:

- `ELEVENLABS_API_KEY`: ElevenLabs API key for premium voices
- `HUME_API_KEY`: Hume API key for premium voices
- `CARTESIA_API_KEY`: Cartesia API key for premium voices
- `DATA_DIR`: Data directory (default: ./data)
- `AUDIO_DIR`: Audio output directory (default: ./audio)
- `SCRIPTS_DIR`: Scripts directory (default: ./scripts)
- `EMBEDDINGS_DIR`: Embeddings directory (default: ./embeddings)

## Usage

### Quick Start

```bash
# Show quick start guide
npx tweedy quickstart

# Check system status
npx tweedy status
```

### Voice Management

```bash
# List available voices
npx tweedy voice list

# Import voices from a provider (elevenlabs, openai, hume, cartesia)
npx tweedy voice import --provider elevenlabs

# Add a custom voice
npx tweedy voice add --name "Alex" --provider elevenlabs --provider-id "voice-id"
```

### Speaker Management

```bash
# List speakers
npx tweedy speaker list

# Create a speaker
npx tweedy speaker add --name "Alex" --personality "Friendly and curious" --voice-id "voice-id"

# Update a speaker
npx tweedy speaker update <id> --personality "Professional and analytical"
```

### Material Management

```bash
# List materials
npx tweedy material list

# Add material from file
npx tweedy material add --file document.pdf --name "Research Paper"

# Add material from URL
npx tweedy material add --url "https://example.com/article" --name "Web Article"

# Add text material
npx tweedy material add --text "Your content here" --name "Custom Content"

# Search materials
npx tweedy material search "artificial intelligence"
```

### Script Generation

```bash
# List scripts
npx tweedy script list

# Generate a script
npx tweedy script generate --title "Tech Discussion" --speakers "speaker-id-1,speaker-id-2" --materials "material-id-1,material-id-2"

# Choose the assumed listener knowledge (general is the default)
npx tweedy script generate --title "Tech Discussion" --speakers "speaker-id-1,speaker-id-2" --audience general

# Show script details
npx tweedy script show <script-id>

# Export a script as a human-readable document
npx tweedy script export <script-id>
npx tweedy script export <script-id> --output script.txt

# Export, edit and safely apply a script without regenerating it
npx tweedy script export <script-id> --editable --output script.edit.txt
npx tweedy script import <script-id> script.edit.txt --dry-run
npx tweedy script import <script-id> script.edit.txt
```

Editable exports contain stable turn ids, speaker slugs, conversational modes,
the script id and its current revision. Message text can be changed freely;
whole blocks can be reordered or removed, and a block with `@id: new` inserts a
turn. Import validates and previews the complete change before asking for
confirmation. Use `--yes` for a non-interactive apply. A stale editable file is
rejected if the saved script changed after export.

Human edits are authoritative and do not run the director or reviewer again.
Changed turns are stored as new speech records and the script order is updated
only after every new record has been written successfully. Any audio generated
before an edit must be regenerated.

### Audio Generation

```bash
# Generate audio from script
npx tweedy audio generate <script-id> --output podcast.mp3

# Process audio file
npx tweedy audio process input.mp3 output.mp3
```

Every `audio generate` run also writes a timeline JSON next to the audio
file (e.g. `podcast.mp3` → `podcast.timeline.json`), listing each speech's
speaker, message, and `startSeconds`/`endSeconds` in the final mixed track —
useful for driving downstream time-synced assets like captions or video.

When a speech is generated with a voice provider that supports word-level timing (currently Grok only), its timeline entry also includes a `wordTimestamps` array — `{ word, startSeconds, endSeconds }` per word, already shifted to the same track-relative seconds as the entry's own `startSeconds`/`endSeconds`. Entries from providers without timing support omit this field entirely.

## Development

### Project Structure

```
src/
├── types/           # Type definitions and interfaces
├── repositories/    # Data persistence layer
├── services/        # Business logic layer
├── agents/          # AI agents (Director, Speaker)
├── providers/       # External service providers
├── processors/      # Document processors
├── rag/            # RAG system implementation
├── cli/            # CLI interface
└── utils/          # Utilities and helpers
```

### Key Interfaces

The system uses comprehensive interfaces for better abstraction and testability:

- `IVoiceRepository`, `ISpeakerRepository`, `IScriptRepository`, `IMaterialRepository`
- `IVoiceService`, `ISpeakerService`, `IScriptService`, `IMaterialService`
- `IVocalProvider`, `IDocumentProcessor`
- `ISpeakerAgent`, `IDirectorAgent`

### Adding New Providers

1. Implement the `IVocalProvider` interface
2. Add provider to `VocalProviderName` enum
3. Update `VocalProviderFactory`
4. Add environment variable configuration

### Adding New Document Types

1. Extend `BaseProcessor` class
2. Implement `process()` method
3. Add to `DocumentProcessorFactory`
4. Update supported extensions

## RAG System

The system uses LangChain for document processing and semantic search:

- **Embeddings**: OpenAI text-embedding-3-small
- **Vector Store**: MemoryVectorStore with file persistence
- **Text Splitting**: RecursiveCharacterTextSplitter
- **Search**: Similarity search with metadata filtering

## AI Agents

### Director Agent

- Creates listener-centred episode plans from prepared editorial material
- Organises the episode into conversation beats
- Produces structured turn briefs for speakers
- Manages topic coverage, editorial progress, rhythm, and timing

### Speaker Agent

- Generates natural speech from a structured turn brief
- Maintains character consistency
- Handles different speech types and editorial moves

### Material Preparer Agent

- Converts raw source material into reusable editorial cards
- Preserves supporting source excerpts for factual grounding
- Finds material useful for understanding, entertainment, and insight

### Turn Reviewer Agent

- Reviews each turn against its particular editorial purpose
- Checks clarity, engagement, grounding, progress, conversational variety, role consistency, and knowledge consistency
- Revises unsuitable turns while preserving the speaker's voice, then reviews the revision once before accepting it

### Model Routing

Tweedy assigns models programmatically according to the work being performed.
Agents pass a `ModelTask` enum value with each request; they never select a
provider, model name, or quality tier themselves. `ModelRoutingPolicy` maps
that task to an abstract tier, and `ProviderModelCatalogue` maps the tier to a
model offered by the configured provider.

| Model tier | Tasks |
| --- | --- |
| Premium | Material preparation, material summaries, episode planning, substantive speech, and turn review |
| Balanced | Direction and speaker selection |
| Economy | Coverage verification, conclusion checks, interjections, and speech effect tagging |

This routing is deterministic and does not require an additional model call.
Provider-specific model identifiers remain confined to the provider catalogue,
so the editorial agents and routing policy work unchanged with Anthropic,
DeepSeek, or a future provider. If a provider has fewer model classes, multiple
tiers can resolve to the same model.

### Structured Model Responses

Tweedy distinguishes structured data from genuine actions. Episode planning,
direction, material preparation, coverage verification, conclusion checks and
turn review use LangChain's `withStructuredOutput` API with Zod schemas. The
schemas validate model responses at runtime and also provide their TypeScript
types, avoiding parallel interfaces and hand-written faux tool definitions.

Speaker delivery modes remain genuine tools: the model chooses whether the
moment calls for substantive speech, a challenge, a short reaction or the
dedicated closing statement. Keeping these two paths separate makes intent
clear and allows LangChain to use the structured-output strategy supported by
the configured provider. `StructuredOutputMethodPolicy` currently selects
Anthropic's native JSON-schema mode and LangChain's compatible function-calling
structured-output strategy for the DeepSeek endpoint.

### Speaker Roles and Knowledge

Tweedy separates three concerns that are easy to conflate:

- `SpeakerRoleProfile` describes what a speaker is allowed to know.
- `TurnBrief` describes what the speaker should contribute now.
- `NaturalSpeechStylePolicy` describes how the contribution should sound.

The available epistemic roles are defined by the `EpistemicRole` enum:

- `Expert` can introduce and explain source material.
- `InformedHost` can introduce prepared editorial cards assigned to the turn.
- `AudienceGuide` can ask, react, challenge, reframe, and summarise material already heard aloud.

Legacy speakers remain compatible: `isExpert: true` resolves to `Expert`, while
`isExpert: false` resolves to `AudienceGuide`. New speakers can specify a role
with `tweedy speaker add --role <role>`.

For every directed turn, the generation path is:

1. `DirectorAgent` proposes a speaker, editorial move, and prepared cards.
2. `SpeakerRolePolicy` validates the proposal and deterministically repairs an invalid assignment.
3. `KnowledgeLedgerPolicy` exposes only facts available to that speaker.
4. `DialogueCadencePolicy` prevents role repair from creating consecutive expert monologues.
5. `ResponseModePolicy` selects tools from the conversational obligation and editorial move.
6. `AudienceAccessibilityPolicy` tells the speaker how much specialist knowledge listeners can be assumed to have.
7. `SpeakerAgent` applies the accessibility standard and shared natural delivery guidance, including occasional fillers, pauses, false starts, and self-corrections.
8. `TurnReviewerAgent` checks role, knowledge, and audience accessibility before accepted knowledge is added to the episode ledgers.
9. `EpisodeConclusionPolicy` prevents production from ending until the final persisted turn uses the dedicated closing-statement tool.

The knowledge ledger is stored with the script. A prepared card becomes shared
conversation knowledge only after an accepted speech introduces it. This lets
an audience guide later summarise an expert's explanation without allowing the
guide to introduce an unseen technical fact.

### Audience Accessibility and Technical Terms

Episodes default to the `General` audience profile. `Enthusiast` and
`Specialist` profiles can be selected with `script generate --audience`. For a
general audience, speakers explain a necessary specialist idea in everyday
language before naming its technical term.

A term needs explanation when it is likely unfamiliar to the selected
audience, necessary to understand the current point, and has not already been
explained in the episode. This is contextual: familiar words used in a
specialist sense may need explanation, while an incidental proper name may not.

`TerminologyLedgerPolicy` records validated first-use explanations from
accepted turns. The reviewer rejects unexplained necessary jargon, while terms
already explained can be reused without repeatedly stopping the conversation.
This changes how expertise is communicated without suppressing the fillers,
hesitations, false starts, and self-corrections that make delivery sound
natural.

## Audio Processing

- **TTS Providers**: ElevenLabs, OpenAI, Hume, Cartesia
- **Audio Processing**: FFmpeg for normalization and silence removal
- **Batch Processing**: Efficient parallel audio generation
- **Quality Enhancement**: Audio normalization and cleanup

## Error Handling

The system includes comprehensive error handling:

- Repository-level graceful file handling
- Service-level business rule enforcement
- CLI-level user-friendly error messages
- Retry logic for AI agent failures

## Performance Considerations

- Batch processing for audio generation
- Parallel document processing
- Efficient vector store operations
- Memory-conscious text splitting

## Security

- Input validation with Zod schemas
- Path traversal prevention
- API key management
- File type validation

## Testing

```bash
# Run tests (when implemented)
npm test

# Run with coverage
npm run test:coverage
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:

1. Check the documentation
2. Search existing issues
3. Create a new issue with detailed information

## Roadmap

- [ ] Database support for larger datasets
- [ ] Advanced audio effects and processing
- [ ] Real-time collaboration features
- [ ] Web interface
- [ ] Plugin system for custom processors
- [ ] Advanced AI agent behaviors
- [ ] Multi-language support
