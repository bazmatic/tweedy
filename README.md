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

## Installation

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

# Show script details
npx tweedy script show <script-id>
```

### Audio Generation

```bash
# Generate audio from script
npx tweedy audio generate <script-id> --output podcast.mp3

# Process audio file
npx tweedy audio process input.mp3 output.mp3
```

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

- Creates podcast plans based on materials
- Provides direction to speakers
- Manages conversation flow and timing

### Speaker Agent

- Generates natural speech based on direction
- Maintains character consistency
- Handles different speech types (speak, interject, question)

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

