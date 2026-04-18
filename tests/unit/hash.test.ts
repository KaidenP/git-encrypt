import { describe, it, expect } from 'vitest';
import { generateFileHash } from '../../src/core/hash.js';

describe('generateFileHash', () => {
  it('returns a 64-char hex string', () => {
    const hash = generateFileHash('secrets/api.key');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different hashes for the same path (random salt)', () => {
    const h1 = generateFileHash('secrets/api.key');
    const h2 = generateFileHash('secrets/api.key');
    expect(h1).not.toBe(h2);
  });

  it('produces different hashes for different paths', () => {
    const h1 = generateFileHash('secrets/a.key');
    const h2 = generateFileHash('secrets/b.key');
    expect(h1).not.toBe(h2);
  });
});
