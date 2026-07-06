# Example Walkthrough: Generating a Sample Podcast

This is a record of the exact steps used to generate a sample podcast episode from a
piece of source material, using the `tweedy` CLI end to end.

## Prerequisites

- Dependencies installed and project built (`pnpm install && pnpm run build`)
- `.env` populated with valid API keys (see `env.example`)

## 1. Import voices from a provider

```
tweedy voice import --provider elevenlabs
```

Pulls the available voices from ElevenLabs into local storage.

```
tweedy voice list
```

Lists imported voices with their IDs — pick two for your speakers.

## 2. Create speakers

Speakers are personas that will "talk" in the podcast, each tied to a voice.

```
tweedy speaker add --name "Paul" --personality "Warm, curious host who asks probing questions" --voice-id <voice-id-1>
tweedy speaker add --name "Sarah" --personality "Confident, analytical co-host who challenges assumptions" --voice-id <voice-id-2>
```

```
tweedy speaker list
```

Note the speaker IDs printed — you'll need them for script generation.

## 3. Add source material

The material is the content your speakers will discuss. Tweedy processes it into
the RAG system so speeches can be grounded in it.

```
tweedy material add --file article.md --name "My Article"
```

```
tweedy material list
```

Note the material ID.

## 4. Generate a script

The `DirectorAgent`/`SpeakerAgent` pair uses an LLM to plan a discussion and write
speeches for each speaker, grounded in the given material.

```
tweedy script generate \
  --title "Penguin Migration Discussion" \
  --speakers "<speaker-id-1>,<speaker-id-2>" \
  --materials "<material-id>"
```

This prints the generated script's ID — note it for the audio step.

```
tweedy script list
tweedy script show <script-id>
```

Use these to review the generated dialogue before rendering audio.

## 5. Generate audio

Renders each speech to voice audio via the TTS provider, then concatenates them
into a single MP3.

```
tweedy audio generate <script-id>
```

Output is written to `./audio/podcast-<script-id>.mp3` (configurable via
`AUDIO_DIR` in `.env`).

## Useful commands along the way

- `tweedy status` — check config/env health
- `tweedy <command> --help` — see all options for a command
- `tweedy quickstart` — the CLI's built-in quick start guide

## Notes from this run

The source material used (`article.md`) was a deliberately absurd, fictional
article ("The Great Penguin Migration to the Center of Tuesday"). The generated
script correctly picked up on this — rather than presenting the nonsense as fact,
the two hosts questioned the material's credibility mid-episode, which is a good
sign the RAG grounding and script generation are behaving sensibly rather than
hallucinating confidently on bad input.
