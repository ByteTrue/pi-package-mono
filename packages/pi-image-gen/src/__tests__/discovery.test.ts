import { describe, expect, it, vi } from 'vitest';
import { discoverRemoteModels, isLikelyImageModel } from '../discovery.js';

describe('discovery', () => {
  it('identifies likely image models correctly', () => {
    expect(isLikelyImageModel('gpt-image-2')).toBe(true);
    expect(isLikelyImageModel('black-forest-labs/flux.2-flex')).toBe(true);
    expect(isLikelyImageModel('dall-e-3')).toBe(true);
    expect(isLikelyImageModel('seedream-5-pro')).toBe(true);
    expect(isLikelyImageModel('gemini-2.5-flash-image')).toBe(true);
    expect(isLikelyImageModel('qwen-image-2.0')).toBe(true);
    expect(isLikelyImageModel('gpt-4o')).toBe(false);
    expect(isLikelyImageModel('claude-3-5-sonnet')).toBe(false);
  });

  it('discovers models from an OpenAI-compatible endpoint and sorts image models first', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-4o' },
          { id: 'gpt-image-2' },
          { id: 'text-embedding-3-small' },
          { id: 'dall-e-3' },
        ],
      }),
    });

    const models = await discoverRemoteModels({
      api: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
      }),
    );
    expect(models).toEqual(['gpt-image-2', 'dall-e-3', 'gpt-4o', 'text-embedding-3-small']);
  });

  it('discovers models from Gemini endpoint and strips prefix', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/gemini-1.5-pro' },
          { name: 'models/gemini-2.5-flash-image' },
        ],
      }),
    });

    const models = await discoverRemoteModels({
      api: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'AIzaTest',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models?key=AIzaTest',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-goog-api-key': 'AIzaTest' }),
      }),
    );
    expect(models).toEqual(['gemini-2.5-flash-image', 'gemini-1.5-pro']);
  });

  it('fails softly on network errors or 401', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('connection refused'));

    const models = await discoverRemoteModels({
      api: 'openai',
      baseUrl: 'http://localhost:9999/v1',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(models).toEqual([]);
  });
});
