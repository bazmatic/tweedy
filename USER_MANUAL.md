# Tweedy User Manual

**Version 1.0.0**

A comprehensive guide to using the Tweedy AI-powered podcast generation CLI tool.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Installation](#installation)
3. [Getting Started](#getting-started)
4. [Core Concepts](#core-concepts)
5. [Command Reference](#command-reference)
6. [Workflows](#workflows)
7. [Advanced Features](#advanced-features)
8. [Troubleshooting](#troubleshooting)
9. [Best Practices](#best-practices)
10. [FAQ](#faq)

---

## Introduction

### What is Tweedy?

Tweedy is a command-line application that generates AI-powered podcasts from various content sources. It uses advanced AI technology to:

- Convert written content into natural-sounding conversations
- Generate scripts with multiple speakers
- Produce high-quality audio using text-to-speech technology
- Leverage semantic search to find relevant content (RAG - Retrieval-Augmented Generation)

### Key Features

- **Multiple Input Sources**: Import content from PDFs, text files, markdown, HTML, and web pages
- **AI Conversation Generation**: Create natural, engaging dialogue between speakers
- **Voice Customization**: Choose from multiple TTS providers (ElevenLabs, OpenAI)
- **Semantic Search**: Automatically find relevant content for your podcast topics
- **Audio Processing**: Professional-quality audio with normalization and cleanup
- **Flexible Workflow**: Complete control over every step of podcast creation

---

## Installation

### Prerequisites

- **Node.js**: Version 18.0.0 or higher
- **pnpm**: Package manager used by this project ([install guide](https://pnpm.io/installation))
- **FFmpeg**: Required for audio processing

#### Installing FFmpeg

**macOS:**

```bash
brew install ffmpeg
```

**Linux (Ubuntu/Debian):**

```bash
sudo apt update
sudo apt install ffmpeg
```

**Windows:**
Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH.

### Install Tweedy

1. **Clone the repository:**

```bash
git clone <repository-url>
cd tweedy
```

2. **Install dependencies:**

```bash
pnpm install
```

3. **Build the project:**

```bash
pnpm build
```

4. **Make the `tweedy` command available globally (optional but recommended):**

```bash
pnpm link --global
```

This symlinks the CLI into your global pnpm bin directory, so you can run `tweedy` directly instead of `node dist/index.js`. Because it's a symlink, it always reflects the latest build — just re-run `pnpm build` after making changes. (Without this step, replace `tweedy` with `node dist/index.js` in the commands below.)

5. **Set up environment variables:**

```bash
cp env.example .env
```

Edit `.env` with your API keys:

```env
OPENAI_API_KEY=your_openai_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here
ELEVENLABS_API_KEY=your_elevenlabs_key_here  # Optional
```

### Obtaining API Keys

- **OpenAI**: Visit [platform.openai.com](https://platform.openai.com) and create an account
- **Anthropic**: Visit [console.anthropic.com](https://console.anthropic.com) and sign up
- **ElevenLabs**: Visit [elevenlabs.io](https://elevenlabs.io) (optional, for premium voices)

---

## Getting Started

### Quick Start Guide

Run the built-in quick start guide:

```bash
tweedy quickstart
```

This displays a step-by-step guide for creating your first podcast.

### Check System Status

Verify your installation and configuration:

```bash
tweedy status
```

This shows:

- Configuration settings
- Environment variable status
- Available providers

### Your First Podcast (5-Minute Tutorial)

**Step 1: Import Voices**

```bash
tweedy voice import --provider elevenlabs
```

This imports all available voices from ElevenLabs into your system.

**Step 2: List Available Voices**

```bash
tweedy voice list
```

Note the voice IDs you want to use.

**Step 3: Create a Speaker**

```bash
tweedy speaker add \
  --name "Alex" \
  --personality "Friendly tech enthusiast who loves explaining complex topics simply" \
  --voice-id "voice-id-from-step-2" \
  --expert
```

**Step 4: Add Content Material**

```bash
tweedy material add \
  --file "research-paper.pdf" \
  --name "AI Research Paper"
```

**Step 5: Generate a Script**

```bash
tweedy script generate \
  --title "Understanding AI" \
  --description "A discussion about recent AI developments" \
  --speakers "speaker-id-from-step-3" \
  --materials "material-id-from-step-4" \
  --max-turns 10
```

**Step 6: Generate Audio**

```bash
tweedy audio generate script-id --output my-first-podcast.mp3
```

Congratulations! You've created your first AI-generated podcast.

---

## Core Concepts

### Voices

A **Voice** is a text-to-speech profile from a TTS provider. It defines:

- The sound/tone of the voice
- Which provider it comes from (ElevenLabs, OpenAI, Hume)
- Provider-specific settings (stability, similarity, style)

### Speakers

A **Speaker** is a podcast character with:

- A **personality** (how they behave and speak)
- A **voice** (how they sound)
- A **voice style** (instructions for delivery)
- An **expert status** (expert or general audience)

Speakers are the "actors" in your podcast.

### Materials

**Materials** are content sources for your podcast:

- PDF documents
- Text files
- Markdown files
- Web pages
- Manual text input

Materials are processed and indexed for semantic search, allowing the AI to find relevant information during script generation.

### Scripts

A **Script** is a generated podcast conversation containing:

- Title and description
- List of speakers
- Generated speeches (dialogue)
- Associated materials
- Metadata (creation date, duration, etc.)

### Speeches

**Speeches** are individual dialogue turns in a script:

- The speaker who says it
- The message content
- Voice instructions
- Timestamp

---

## Command Reference

### Global Options

Available for all commands:

```bash
--verbose, -v     Enable verbose logging
--debug          Enable debug logging
```

### Voice Commands

#### `voice list`

List all available voices in your system.

```bash
tweedy voice list
```

**Example Output:**

```
Available Voices:
  Sarah (elevenlabs) - Warm, professional female voice
  Mike (openai) - Deep, authoritative male voice
  Emma (elevenlabs) - Bright, energetic female voice
```

#### `voice add`

Manually add a voice.

```bash
tweedy voice add \
  --name "Sarah" \
  --description "Professional narrator" \
  --provider elevenlabs \
  --provider-id "21m00Tcm4TlvDq8ikWAM"
```

**Options:**

- `-n, --name <name>`: Voice name (required)
- `-d, --description <description>`: Voice description
- `-p, --provider <provider>`: Provider (elevenlabs, openai)
- `--provider-id <id>`: Provider's voice ID (required)

#### `voice import`

Import all voices from a provider.

```bash
tweedy voice import --provider elevenlabs
```

**Options:**

- `-p, --provider <provider>`: Provider to import from

**Tips:**

- Run this after setting up API keys
- Imports all available voices automatically
- Existing voices are skipped

#### `voice delete`

Delete a voice.

```bash
tweedy voice delete voice-id
```

---

### Speaker Commands

#### `speaker list`

List all speakers.

```bash
tweedy speaker list
```

**Example Output:**

```
Available Speakers:
  Alex (Sarah) - Friendly tech enthusiast
    Expert: Yes
    Voice Style: Conversational and engaging

  Jordan (Mike) - Curious learner with great questions
    Expert: No
    Voice Style: Natural and inquisitive
```

#### `speaker add`

Create a new speaker.

```bash
tweedy speaker add \
  --name "Alex" \
  --personality "Tech expert who loves explaining complex topics" \
  --voice-id "voice-id" \
  --voice-style "Speak with enthusiasm and clarity" \
  --expert
```

**Options:**

- `-n, --name <name>`: Speaker name (required)
- `-p, --personality <personality>`: Personality description (required)
- `-v, --voice-id <voiceId>`: Voice to use (required)
- `-s, --voice-style <style>`: Delivery instructions
- `-e, --expert`: Mark as expert speaker

**Tips:**

- **Expert speakers** receive detailed direction and focus on accuracy
- **Non-expert speakers** ask questions and provide audience perspective
- Mix experts and non-experts for engaging conversations

#### `speaker update`

Update an existing speaker.

```bash
tweedy speaker update speaker-id \
  --personality "Updated personality" \
  --expert
```

**Options:**

- `-n, --name <name>`: New name
- `-p, --personality <personality>`: New personality
- `-v, --voice-id <voiceId>`: New voice
- `-s, --voice-style <style>`: New voice style
- `-e, --expert`: Mark as expert
- `--no-expert`: Remove expert status

#### `speaker delete`

Delete a speaker.

```bash
tweedy speaker delete speaker-id
```

---

### Material Commands

#### `material list`

List all materials.

```bash
tweedy material list
```

**With filters:**

```bash
tweedy material list --source "research" --type document
```

**Options:**

- `-s, --source <source>`: Filter by source
- `-t, --type <type>`: Filter by type (document, web, manual)

#### `material add`

Add material from various sources.

**From file:**

```bash
tweedy material add \
  --file "research-paper.pdf" \
  --name "AI Research 2024"
```

**From URL:**

```bash
tweedy material add \
  --url "https://example.com/article" \
  --name "Web Article"
```

**From text:**

```bash
tweedy material add \
  --text "Your content here..." \
  --name "Custom Content"
```

**Options:**

- `-f, --file <path>`: Add from file
- `-u, --url <url>`: Add from URL
- `-t, --text <text>`: Add text content
- `-n, --name <name>`: Material name (required)

**Supported File Types:**

- PDF (`.pdf`)
- Text (`.txt`)
- Markdown (`.md`)
- HTML (`.html`, `.htm`)

#### `material search`

Search materials using semantic search.

```bash
tweedy material search "machine learning algorithms" --limit 5
```

**Options:**

- `-l, --limit <number>`: Limit results (default: 10)

**Tips:**

- Searches by meaning, not exact words
- Useful for finding relevant content before script generation
- Results are ranked by relevance

#### `material delete`

Delete a material.

```bash
tweedy material delete material-id
```

---

### Script Commands

#### `script list`

List all generated scripts.

```bash
tweedy script list
```

**Example Output:**

```
Available Scripts:
  Understanding AI
    Description: A discussion about AI developments
    Speakers: Alex, Jordan
    Speeches: 10
    Materials: 2
    Created: 1/15/2024
```

#### `script generate`

Generate a new podcast script.

```bash
tweedy script generate \
  --title "Tech Talk" \
  --description "Discussion about emerging technologies" \
  --speakers "speaker-id-1,speaker-id-2" \
  --materials "material-id-1,material-id-2" \
  --max-turns 15 \
  --max-duration 600 \
  --allocation sequential
```

**Options:**

- `-t, --title <title>`: Script title (required)
- `-d, --description <description>`: Script description
- `-s, --speakers <speakers>`: Comma-separated speaker IDs (required)
- `-m, --materials <materials>`: Comma-separated material IDs
- `--max-turns <turns>`: Maximum conversation turns (default: 10)
- `--max-duration <duration>`: Max duration in seconds (default: 600)
- `--allocation <allocation>`: Speaker allocation (sequential, random, managed)

**Speaker Allocation Strategies:**

- `sequential`: Speakers take turns in order
- `random`: Random speaker selection
- `managed`: AI decides who speaks next (experimental)

**Tips:**

- More turns = longer podcast
- Include diverse materials for richer content
- Mix expert and non-expert speakers
- Generation can take 2-5 minutes depending on length

#### `script show`

Show detailed script content.

```bash
tweedy script show script-id
```

Displays:

- Script metadata
- All speeches with speaker names
- Associated materials

#### `script export --editable` and `script import`

Export an editable script, change it in any text editor, preview the result and
apply it without regenerating the episode:

```bash
tweedy script export script-id --editable --output episode.edit.txt
tweedy script import script-id episode.edit.txt --dry-run
tweedy script import script-id episode.edit.txt
```

Each turn block contains an `@id`, `@speaker`, optional `@mode`, and its spoken
message followed by `@end`. Edit the message freely, reorder or remove complete
blocks, or add a block using `@id: new`. Keep the `@end` marker; use `\@end` if
the spoken message needs a literal line containing `@end`. Existing turns
cannot be reassigned to another speaker; new turns may use any speaker already
attached to the script.

Import shows the numbers of added, removed, edited and unchanged turns before
writing. It asks for confirmation unless `--yes` is supplied. The file includes
the script revision from export, so an older file cannot silently overwrite
newer script changes. Human edits are applied directly without another AI or
editorial-policy pass. Regenerate any existing audio after applying edits.

#### `script delete`

Delete a script.

```bash
tweedy script delete script-id
```

---

### Audio Commands

#### `audio generate`

Generate audio from a script.

```bash
tweedy audio generate script-id \
  --output podcast.mp3 \
  --provider elevenlabs
```

**Options:**

- `-o, --output <path>`: Output file path
- `-p, --provider <provider>`: Voice provider (elevenlabs, openai)

**Process:**

1. Generates TTS for each speech
2. Processes audio (removes silence, normalizes)
3. Concatenates all speeches
4. Applies final normalization
5. Saves as MP3

**Tips:**

- Generation time depends on script length
- Speeches are processed in batches for efficiency
- Final audio is broadcast-quality

#### `audio process`

Process an existing audio file.

```bash
tweedy audio process input.mp3 output.mp3
```

Applies:

- Silence removal
- Audio normalization
- Volume leveling

---

## Workflows

### Workflow 1: Single-Speaker Podcast from Documents

**Use Case**: Create an audiobook or narrated article.

```bash
# 1. Import voices
tweedy voice import --provider openai

# 2. List voices and note an ID
tweedy voice list

# 3. Create a narrator speaker
tweedy speaker add \
  --name "Narrator" \
  --personality "Professional narrator with clear enunciation" \
  --voice-id "voice-id" \
  --expert

# 4. Add your document
tweedy material add --file book-chapter.pdf --name "Chapter 1"

# 5. Generate script
tweedy script generate \
  --title "Chapter 1 Narration" \
  --speakers "speaker-id" \
  --materials "material-id" \
  --max-turns 20

# 6. Generate audio
tweedy audio generate script-id --output chapter1.mp3
```

### Workflow 2: Interview-Style Podcast

**Use Case**: Two-person conversation about a topic.

```bash
# 1. Create expert speaker
tweedy speaker add \
  --name "Dr. Smith" \
  --personality "AI researcher, enthusiastic about technology" \
  --voice-id "expert-voice-id" \
  --expert

# 2. Create interviewer speaker
tweedy speaker add \
  --name "Jamie" \
  --personality "Curious journalist, asks insightful questions" \
  --voice-id "interviewer-voice-id"

# 3. Add research materials
tweedy material add --file research1.pdf --name "Study 1"
tweedy material add --file research2.pdf --name "Study 2"

# 4. Generate conversation
tweedy script generate \
  --title "AI Research Discussion" \
  --description "Interview about recent AI developments" \
  --speakers "expert-id,interviewer-id" \
  --materials "material-1-id,material-2-id" \
  --max-turns 20 \
  --allocation sequential

# 5. Generate audio
tweedy audio generate script-id --output interview.mp3
```

### Workflow 3: Multi-Topic Podcast Series

**Use Case**: Create multiple episodes from different materials.

```bash
# 1. Set up speakers once
tweedy speaker add --name "Host" ... # (host speaker)
tweedy speaker add --name "Expert" ... # (expert speaker)

# 2. For each episode:

# Episode 1
tweedy material add --file topic1.pdf --name "Topic 1"
tweedy script generate --title "Episode 1" --speakers "..." --materials "..."
tweedy audio generate script-id --output episode1.mp3

# Episode 2
tweedy material add --file topic2.pdf --name "Topic 2"
tweedy script generate --title "Episode 2" --speakers "..." --materials "..."
tweedy audio generate script-id --output episode2.mp3
```

### Workflow 4: Web Content to Podcast

**Use Case**: Convert web articles into audio.

```bash
# 1. Add materials from URLs
tweedy material add \
  --url "https://example.com/article1" \
  --name "Article 1"

tweedy material add \
  --url "https://example.com/article2" \
  --name "Article 2"

# 2. Search materials to verify content
tweedy material search "key topic"

# 3. Generate script with your speakers
tweedy script generate \
  --title "Weekly News Roundup" \
  --speakers "speaker-id-1,speaker-id-2" \
  --materials "material-id-1,material-id-2" \
  --max-turns 15

# 4. Generate audio
tweedy audio generate script-id --output news-roundup.mp3
```

---

## Advanced Features

### Semantic Search (RAG)

Tweedy uses Retrieval-Augmented Generation to intelligently find relevant content.

**How it works:**

1. Materials are processed and split into chunks
2. Each chunk is converted to embeddings (numerical representations)
3. During script generation, AI searches for relevant chunks
4. Only relevant content is used in the conversation

**Benefits:**

- Handles large documents efficiently
- Finds relevant information automatically
- Maintains conversation focus
- Reduces token usage

**Testing Semantic Search:**

```bash
# Add material
tweedy material add --file large-document.pdf --name "Research"

# Search to see what AI will find
tweedy material search "neural networks" --limit 5

# Results show most relevant sections
```

### Custom Voice Settings

When manually adding voices, customize their behavior:

```bash
tweedy voice add \
  --name "CustomVoice" \
  --provider elevenlabs \
  --provider-id "voice-id"

# Then in the voice JSON file, add settings:
# "settings": {
#   "stability": 0.7,
#   "similarityBoost": 0.8,
#   "style": 0.5
# }
```

**Settings (ElevenLabs):**

- `stability` (0-1): Lower = more expressive, Higher = more stable
- `similarityBoost` (0-1): How closely to match original voice
- `style` (0-1): Style exaggeration

### Batch Processing

Process multiple documents at once:

```bash
# Create a script to batch add materials
for file in documents/*.pdf; do
  tweedy material add --file "$file" --name "$(basename "$file" .pdf)"
done
```

### Audio Post-Processing

For additional control, process audio separately:

```bash
# Generate raw audio
tweedy audio generate script-id --output raw.mp3

# Apply custom processing
tweedy audio process raw.mp3 processed.mp3

# Or use external tools
ffmpeg -i processed.mp3 -af "highpass=f=200,lowpass=f=3000" final.mp3
```

---

## Troubleshooting

### Common Issues

#### "Missing environment variables"

**Problem:** API keys not configured.

**Solution:**

1. Check `.env` file exists
2. Verify keys are set correctly
3. Restart terminal after editing `.env`
4. Run `tweedy status` to verify

#### "Voice with id X not found"

**Problem:** Referenced voice doesn't exist.

**Solution:**

```bash
# List available voices
tweedy voice list

# If none exist, import some
tweedy voice import --provider elevenlabs

# Use correct voice ID when creating speakers
```

#### "Failed to process PDF"

**Problem:** PDF is encrypted or corrupted.

**Solution:**

- Ensure PDF is not password-protected
- Try converting PDF to text first
- Use `--text` option to add content manually

#### "FFmpeg not found"

**Problem:** FFmpeg not installed or not in PATH.

**Solution:**

```bash
# macOS
brew install ffmpeg

# Check installation
ffmpeg -version
```

#### "Audio generation failed"

**Problem:** TTS provider issues or rate limits.

**Solution:**

- Check API key is valid
- Verify sufficient credits
- Try different provider: `--provider openai`
- Wait a few minutes and retry

#### "Script generation takes too long"

**Problem:** Large materials or many turns.

**Solution:**

- Reduce `--max-turns`
- Split large documents into smaller materials
- Use semantic search to preview what content will be used

### Debug Mode

Enable debug logging for detailed information:

```bash
tweedy --debug script generate ...
```

This shows:

- API calls
- Processing steps
- Error details
- Timing information

### Getting Help

```bash
# Global help
tweedy --help

# Command-specific help
tweedy voice --help
tweedy speaker add --help
```

---

## Best Practices

### Creating Engaging Podcasts

1. **Mix Speaker Types**

   - Combine expert and non-expert speakers
   - Expert provides information, non-expert asks questions

2. **Provide Quality Materials**

   - Use well-structured documents
   - Ensure materials are topically relevant
   - Include diverse perspectives

3. **Optimize Script Length**

   - 10-15 turns = 5-10 minute podcast
   - 20-30 turns = 15-20 minute podcast
   - Test different lengths for your content

4. **Craft Good Personalities**
   - Be specific: "Enthusiastic teacher" not just "nice"
   - Include communication style
   - Define expertise level clearly

### Performance Optimization

1. **Material Management**

   - Remove unused materials periodically
   - Keep materials focused and relevant
   - Use search to verify material quality

2. **Batch Operations**

   - Generate multiple scripts before audio production
   - Process audio in off-peak hours
   - Use sequential commands for automation

3. **Resource Usage**
   - Monitor API usage and costs
   - Use OpenAI for cost-effective TTS
   - Use ElevenLabs for premium quality

### Content Organization

```
project/
├── materials/          # Source documents
│   ├── research/
│   └── articles/
├── scripts/           # Generated scripts (auto-created)
└── podcasts/         # Final audio files
    ├── episode1.mp3
    └── episode2.mp3
```

### Maintenance

**Regular Tasks:**

```bash
# Check system status
tweedy status

# Review and clean old scripts
tweedy script list
tweedy script delete old-script-id

# Update materials
tweedy material list
tweedy material delete outdated-id
```

---

## FAQ

### General Questions

**Q: How much does it cost to use Tweedy?**

A: Tweedy itself is free, but you pay for:

- OpenAI API usage (embeddings + TTS): ~$0.10-0.50 per podcast
- Anthropic Claude API: ~$0.50-2.00 per script
- ElevenLabs (optional): Varies by plan

**Q: Can I use Tweedy commercially?**

A: Check the license file. Also verify TTS provider terms for commercial use.

**Q: What languages are supported?**

A: Currently English only. TTS providers support multiple languages, but AI agents are optimized for English.

**Q: Can I edit generated scripts?**

A: Scripts are JSON files in the `scripts/` directory. You can manually edit them, but regenerating is recommended.

### Technical Questions

**Q: Where is my data stored?**

A: All data is stored locally in JSON files:

- `data/voices/` - Voice definitions
- `data/speakers/` - Speaker definitions
- `data/materials/` - Material metadata
- `scripts/` - Generated scripts
- `audio/` - Audio files

**Q: Can I use my own TTS system?**

A: Yes, implement the `IVocalProvider` interface and add to `VocalProviderFactory`.

**Q: How accurate is semantic search?**

A: OpenAI embeddings provide excellent semantic matching. Results are typically highly relevant to the query.

**Q: Can I run Tweedy on a server?**

A: Yes, it's a CLI tool that works in any environment with Node.js and FFmpeg.

### Usage Questions

**Q: How many speakers can I use?**

A: No hard limit, but 2-3 speakers work best for natural conversation flow.

**Q: What's the maximum podcast length?**

A: No limit, but generation time increases with length. Typical range is 5-30 minutes.

**Q: Can I specify what speakers talk about?**

A: The Director AI agent handles this automatically based on your materials and speaker personalities. For more control, provide detailed personalities and focused materials.

**Q: How do I improve audio quality?**

A:

- Use ElevenLabs voices
- Provide clear voice style instructions
- Use the audio processing command
- Choose appropriate stability settings

**Q: Can I preview scripts before generating audio?**

A: Yes! Use `tweedy script show script-id` to review before audio generation.

---

## Appendix

### File Locations

```
tweedy/
├── data/              # Data directory
│   ├── voices/        # Voice JSON files
│   ├── speakers/      # Speaker JSON files
│   └── materials/     # Material JSON files
├── scripts/           # Generated script JSON files
├── audio/            # Generated audio files
│   └── speeches/     # Individual speech audio
├── embeddings/       # Vector store data
└── .env             # Configuration
```

### Environment Variables Reference

```env
# Required
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Optional
ELEVENLABS_API_KEY=...

# Configuration (optional)
DATA_DIR=./data
AUDIO_DIR=./audio
SCRIPTS_DIR=./scripts
EMBEDDINGS_DIR=./embeddings
DEFAULT_VOICE_PROVIDER=elevenlabs
DEFAULT_EMBEDDING_MODEL=text-embedding-3-small
DEFAULT_CHUNK_SIZE=1000
DEFAULT_CHUNK_OVERLAP=200
```

### API Provider Comparison

| Provider   | Quality    | Speed  | Cost | Best For             |
| ---------- | ---------- | ------ | ---- | -------------------- |
| ElevenLabs | ⭐⭐⭐⭐⭐ | Medium | $$$  | Premium quality      |
| OpenAI     | ⭐⭐⭐⭐   | Fast   | $    | Cost-effective       |
| Hume       | ⭐⭐⭐⭐   | Medium | $$   | Emotional expression |

### Command Cheat Sheet

```bash
# Status & Help
tweedy status
tweedy quickstart
tweedy --help

# Voices
tweedy voice list
tweedy voice import --provider elevenlabs
tweedy voice add -n "Name" --provider-id "id"

# Speakers
tweedy speaker list
tweedy speaker add -n "Name" -p "Personality" -v "voice-id"

# Materials
tweedy material list
tweedy material add -f "file.pdf" -n "Name"
tweedy material search "query"

# Scripts
tweedy script list
tweedy script generate -t "Title" -s "id1,id2" -m "id1"
tweedy script show script-id

# Audio
tweedy audio generate script-id -o output.mp3
tweedy audio process input.mp3 output.mp3
```

---

## Support & Resources

### Getting Help

- **Documentation**: This manual and README.md
- **Command Help**: Use `--help` with any command
- **Debug Mode**: Add `--debug` flag for detailed logs

### Community & Development

- **Issues**: Report bugs via issue tracker
- **Feature Requests**: Submit via issue tracker
- **Contributing**: See CONTRIBUTING.md (if available)

### Version History

- **1.0.0**: Initial release with core features

---

**Happy podcasting with Tweedy!** 🎙️

_For technical documentation, see README.md_  
_For development details, see the architecture documentation_
