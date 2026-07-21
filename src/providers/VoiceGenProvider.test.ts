import { describe, expect, it, vi, beforeEach } from 'vitest';
import axios from 'axios';
import * as fs from 'fs-extra';
import { VoiceGenProvider } from './VoiceGenProvider';
import { VocalProviderName } from '../types';
import { AiModelFactory } from './AiModelFactory';

vi.mock('axios');
vi.mock('fs-extra', () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./AiModelFactory', () => ({
  AiModelFactory: { getModel: vi.fn() },
}));

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
});
