import { describe, expect, it, vi, beforeEach } from 'vitest';
import axios from 'axios';
import * as fs from 'fs-extra';
import { VoiceGenProvider } from './VoiceGenProvider';
import { VocalProviderName } from '../types';
import { AiModelFactory } from './AiModelFactory';
import { TranscriptionProviderFactory } from './TranscriptionProviderFactory';
import { MAX_VERIFY_ATTEMPTS } from './voicegen-sequence-length';

vi.mock('axios');
vi.mock('fs-extra', () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./AiModelFactory', () => ({
  AiModelFactory: { getModel: vi.fn() },
}));

const mockTranscribe = vi.fn();
vi.mock('./TranscriptionProviderFactory', () => ({
  TranscriptionProviderFactory: { getProvider: vi.fn(() => ({ transcribe: mockTranscribe })) },
}));

function wordsOf(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    word: `w${i}`,
    startSeconds: i,
    endSeconds: i + 1,
  }));
}

function makeParams(message: string) {
  return {
    voice: {
      id: 'v1',
      name: 'Voice',
      description: 'Voice',
      provider: VocalProviderName.VoiceGen,
      providerId: 'voice-1',
      settings: { providerOptions: { speed: 1.0 } },
    },
    speech: { id: 's1', message },
    outputFileName: 'out.wav',
  } as any;
}

describe('VoiceGenProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (axios.post as any).mockResolvedValue({ data: Buffer.from('audio') });
    // Default: transcript "completely" covers any short test message, so
    // pre-existing tests that don't care about verification see one clean
    // synth call rather than a retry.
    mockTranscribe.mockResolvedValue({ words: wordsOf(1000) });
  });

  it('sends the LLM-tagged text when tagging succeeds and preserves wording', async () => {
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ content: 'Solo line, (laughs) with a beat.' }),
    });

    const provider = new VoiceGenProvider();
    await provider.tts(makeParams('Solo line, with a beat.'));

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/tts'),
      expect.objectContaining({ text: 'Solo line, (laughs) with a beat.' }),
      expect.any(Object)
    );
  });

  it('falls back to the plain text when the LLM changes the wording', async () => {
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ content: 'Solo lines, (laughs) with a beat.' }),
    });

    const provider = new VoiceGenProvider();
    await provider.tts(makeParams('Solo line, with a beat.'));

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/tts'),
      expect.objectContaining({ text: 'Solo line, with a beat.' }),
      expect.any(Object)
    );
  });

  it('falls back to the plain text when the tagging model throws', async () => {
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi.fn().mockRejectedValue(new Error('model unavailable')),
    });

    const provider = new VoiceGenProvider();
    await provider.tts(makeParams('Solo line.'));

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/tts'),
      expect.objectContaining({ text: 'Solo line.' }),
      expect.any(Object)
    );
  });

  it('falls back to the plain text when the LLM returns an empty response', async () => {
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ content: '' }),
    });

    const provider = new VoiceGenProvider();
    await provider.tts(makeParams('Solo line.'));

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/tts'),
      expect.objectContaining({ text: 'Solo line.' }),
      expect.any(Object)
    );
  });

  it('estimates a sequence_length from text when no explicit override is given', async () => {
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ content: '' }),
    });

    const provider = new VoiceGenProvider();
    await provider.tts(makeParams('Solo line.'));

    const [, body] = (axios.post as any).mock.calls[0];
    expect(typeof body.params.sequence_length).toBe('number');
    expect(body.params.sequence_length).toBeGreaterThan(0);
  });

  it('retries with a larger sequence_length when the transcript looks truncated, then accepts once complete', async () => {
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ content: '' }),
    });
    mockTranscribe
      .mockResolvedValueOnce({ words: wordsOf(1) }) // looks truncated
      .mockResolvedValueOnce({ words: wordsOf(1000) }); // complete

    const provider = new VoiceGenProvider();
    const result = await provider.tts(makeParams('This line has several words in it.'));

    expect(axios.post).toHaveBeenCalledTimes(2);
    const firstSequenceLength = (axios.post as any).mock.calls[0][1].params.sequence_length;
    const secondSequenceLength = (axios.post as any).mock.calls[1][1].params.sequence_length;
    expect(secondSequenceLength).toBeGreaterThan(firstSequenceLength);
    expect(result.outputPath).toBeDefined();
  });

  it('gives up after MAX_VERIFY_ATTEMPTS and still returns the last attempt', async () => {
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ content: '' }),
    });
    mockTranscribe.mockResolvedValue({ words: wordsOf(1) }); // always looks truncated

    const provider = new VoiceGenProvider();
    const result = await provider.tts(makeParams('This line has several words in it.'));

    expect(axios.post).toHaveBeenCalledTimes(MAX_VERIFY_ATTEMPTS);
    expect(result.outputPath).toBeDefined();
  });

  it('skips estimation and verification when an explicit providerOptions.sequence_length is given', async () => {
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ content: '' }),
    });

    const provider = new VoiceGenProvider();
    const params = makeParams('Solo line.');
    params.voice.settings.providerOptions.sequence_length = 999;

    await provider.tts(params);

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(mockTranscribe).not.toHaveBeenCalled();
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/tts'),
      expect.objectContaining({ params: expect.objectContaining({ sequence_length: 999 }) }),
      expect.any(Object)
    );
  });

  it('accepts the audio as-is when verification itself fails', async () => {
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ content: '' }),
    });
    mockTranscribe.mockRejectedValue(new Error('Whisper unavailable'));

    const provider = new VoiceGenProvider();
    const result = await provider.tts(makeParams('Solo line.'));

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(result.outputPath).toBeDefined();
  });
});
