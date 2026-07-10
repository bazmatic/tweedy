import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      audio: { speech: { create: mockCreate } },
    };
  }),
}));

vi.mock('fs-extra', () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import * as fs from 'fs-extra';
import { KokoroProvider } from './KokoroProvider';
import { VocalProviderName } from '../types';
import type { Speaker, Speech, Voice } from '../types';

function buildVoice(overrides: Partial<Voice> = {}): Voice {
  return {
    id: 'af_heart',
    name: 'af_heart',
    description: 'af_heart',
    provider: VocalProviderName.Kokoro,
    providerId: 'af_heart',
    settings: {},
    ...overrides,
  };
}

function buildSpeech(voice: Voice): Speech {
  const speaker: Speaker = {
    id: 'speaker-1',
    slug: 'test-speaker',
    name: 'Test Speaker',
    personality: 'curious',
    voice,
    voiceStyle: 'neutral',
    isExpert: false,
  };
  return {
    id: 'speech-1',
    speaker,
    message: 'Hello from Kokoro',
    instructions: '',
    voice,
    voiceStyle: 'neutral',
    timestamp: new Date(),
  };
}

describe('KokoroProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.KOKORO_BASE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('constructs successfully with no environment variables set', () => {
    expect(() => new KokoroProvider()).not.toThrow();
  });

  it('writes synthesized audio to the configured output path', async () => {
    mockCreate.mockResolvedValue({
      arrayBuffer: async () => new TextEncoder().encode('fake-audio-bytes').buffer,
    });

    const provider = new KokoroProvider();
    const voice = buildVoice();
    const outputPath = await provider.tts({
      speech: buildSpeech(voice),
      voice,
      outputFileName: 'output.mp3',
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'kokoro',
        voice: 'af_heart',
        input: 'Hello from Kokoro',
        response_format: 'mp3',
      })
    );
    expect(fs.writeFile).toHaveBeenCalledWith(outputPath, expect.any(Buffer));
    expect(outputPath.endsWith('output.mp3')).toBe(true);
  });

  it('spreads providerOptions into the request body', async () => {
    mockCreate.mockResolvedValue({
      arrayBuffer: async () => new TextEncoder().encode('fake-audio-bytes').buffer,
    });

    const provider = new KokoroProvider();
    const voice = buildVoice({ settings: { providerOptions: { speed: 1.2 } } });
    await provider.tts({
      speech: buildSpeech(voice),
      voice,
      outputFileName: 'output.mp3',
    });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ speed: 1.2 }));
  });

  it('maps the server voice list into the shared Voice shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ voices: ['af_heart', 'am_michael'] }),
      })
    );

    const provider = new KokoroProvider();
    const voices = await provider.getVoices();

    expect(voices).toEqual([
      {
        id: 'af_heart',
        name: 'af_heart',
        description: 'af_heart',
        provider: VocalProviderName.Kokoro,
        providerId: 'af_heart',
        settings: {},
      },
      {
        id: 'am_michael',
        name: 'am_michael',
        description: 'am_michael',
        provider: VocalProviderName.Kokoro,
        providerId: 'am_michael',
        settings: {},
      },
    ]);
  });

  it('throws when the voices endpoint responds with an error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      })
    );

    const provider = new KokoroProvider();
    await expect(provider.getVoices()).rejects.toThrow('503');
  });
});
