import { describe, expect, it } from 'vitest';
import { classifyHttpError, describeNetworkError } from '../errors.js';
import type { ResolvedProvider } from '../types.js';

const builtIn: ResolvedProvider = {
  id: 'openai',
  api: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  name: 'OpenAI',
  builtIn: true,
};

const custom: ResolvedProvider = {
  id: 'amaster',
  api: 'openai',
  baseUrl: 'https://credits.amaster.ai/',
  apiKey: 'sk-test',
  name: 'amaster',
  builtIn: false,
};

function fakeRes(status: number): Response {
  return new Response('', { status });
}

describe('classifyHttpError', () => {
  it('401 → key locator for built-in points at the env var', () => {
    const msg = classifyHttpError(fakeRes(401), 'unauthorized', builtIn);
    expect(msg).toMatch(/OPENAI_API_KEY/);
    expect(msg).toMatch(/Do not retry/);
  });

  it('401 → key locator for custom points at customProviders settings path', () => {
    const msg = classifyHttpError(fakeRes(401), 'unauthorized', custom);
    expect(msg).toMatch(/customProviders\.amaster\.apiKey/);
  });

  it('429 mentions rate limiting', () => {
    const msg = classifyHttpError(fakeRes(429), '', builtIn);
    expect(msg).toMatch(/rate-limited/i);
  });

  it('5xx flagged as transient', () => {
    const msg = classifyHttpError(fakeRes(503), '', builtIn);
    expect(msg).toMatch(/transient/);
  });

  it('400 hints at parameter / model id mismatch', () => {
    const msg = classifyHttpError(fakeRes(400), '', builtIn);
    expect(msg).toMatch(/bad parameter|unsupported model/i);
  });
});

describe('describeNetworkError', () => {
  it('classifies timeout', () => {
    const msg = describeNetworkError(new Error('connect ETIMEDOUT'), builtIn);
    expect(msg).toMatch(/timed out/i);
  });

  it('classifies DNS failure', () => {
    const msg = describeNetworkError(new Error('getaddrinfo ENOTFOUND foo'), builtIn);
    expect(msg).toMatch(/Cannot reach/);
  });

  it('classifies abort', () => {
    const msg = describeNetworkError(new DOMException('aborted', 'AbortError'), builtIn);
    expect(msg).toMatch(/cancelled/i);
  });
});
