import { describe, expect, it } from 'vitest';
import { withDefaultPath } from '../url.js';

describe('withDefaultPath', () => {
  it('appends the default path when the URL has no path segment', () => {
    expect(withDefaultPath('https://api.example.com', '/v1')).toBe('https://api.example.com/v1');
    expect(withDefaultPath('https://api.example.com/', '/v1')).toBe('https://api.example.com/v1');
    expect(withDefaultPath('https://api.example.com/', 'v1')).toBe('https://api.example.com/v1');
  });

  it('leaves the URL alone when the user has already supplied a path', () => {
    expect(withDefaultPath('https://api.example.com/v1', '/v1')).toBe('https://api.example.com/v1');
    expect(withDefaultPath('http://localhost:8080/openai/v1', '/v1')).toBe(
      'http://localhost:8080/openai/v1',
    );
    expect(withDefaultPath('https://api.example.com/api/v1/', '/api/v1')).toBe(
      'https://api.example.com/api/v1',
    );
  });

  it('falls back to trimmed input on unparseable URLs', () => {
    expect(withDefaultPath('not-a-url', '/v1')).toBe('not-a-url');
  });

  it('handles ports correctly', () => {
    expect(withDefaultPath('http://localhost:8080', '/v1')).toBe('http://localhost:8080/v1');
    expect(withDefaultPath('http://localhost:8080/', '/v1')).toBe('http://localhost:8080/v1');
  });
});
