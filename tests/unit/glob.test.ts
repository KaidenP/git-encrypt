import { describe, it, expect } from 'vitest';
import {
  matchesAnyGlob,
  filterFilesByConfig,
  getGroupsForFile,
  normalizePath,
} from '../../src/core/glob.js';

describe('normalizePath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizePath('secrets\\api.key')).toBe('secrets/api.key');
  });

  it('leaves forward-slash paths unchanged', () => {
    expect(normalizePath('secrets/api.key')).toBe('secrets/api.key');
  });
});

describe('matchesAnyGlob', () => {
  it('matches a file inside a glob directory', () => {
    expect(matchesAnyGlob('secrets/api.key', ['secrets/**'])).toBe(true);
  });

  it('matches a wildcard extension', () => {
    expect(matchesAnyGlob('.env', ['*.env', '.env'])).toBe(true);
  });

  it('returns false when no globs match', () => {
    expect(matchesAnyGlob('src/index.ts', ['secrets/**'])).toBe(false);
  });

  it('matches deeply nested files', () => {
    expect(matchesAnyGlob('a/b/c/secret.key', ['**/*.key'])).toBe(true);
  });

  it('returns false for empty globs list', () => {
    expect(matchesAnyGlob('secrets/api.key', [])).toBe(false);
  });
});

describe('filterFilesByConfig', () => {
  const config = {
    'secrets/**': ['devs'],
    '.env': ['ops'],
  };

  it('filters files matching any configured glob', () => {
    const files = ['secrets/db.key', 'src/index.ts', '.env'];
    const result = filterFilesByConfig(files, config);
    expect(result).toContain('secrets/db.key');
    expect(result).toContain('.env');
    expect(result).not.toContain('src/index.ts');
  });

  it('returns empty array for empty config', () => {
    expect(filterFilesByConfig(['secrets/a.key'], {})).toEqual([]);
  });
});

describe('getGroupsForFile', () => {
  const config = {
    'secrets/**': ['devs', 'ops'],
    '*.env': ['ops'],
  };

  it('returns all groups that match the file', () => {
    const groups = getGroupsForFile('secrets/api.key', config);
    expect(groups).toContain('devs');
    expect(groups).toContain('ops');
  });

  it('returns only matching groups', () => {
    const groups = getGroupsForFile('.env', config);
    expect(groups).toEqual(['ops']);
  });

  it('returns empty array for unmatched file', () => {
    expect(getGroupsForFile('src/index.ts', config)).toEqual([]);
  });

  it('deduplicates groups that appear in multiple matching globs', () => {
    const config2 = {
      'secrets/**': ['devs'],
      'secrets/*.key': ['devs'],
    };
    const groups = getGroupsForFile('secrets/api.key', config2);
    expect(groups.filter((g) => g === 'devs').length).toBe(1);
  });
});
