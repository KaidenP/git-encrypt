import { describe, it, expect, afterEach } from 'vitest';
import {
  readMeta,
  writeMeta,
  emptyMeta,
  mergeFilesIntoMeta,
  getRecipientsForFile,
  findPlaintextPath,
  addPath,
  removePath,
  addRecipient,
  removeRecipient,
  collectAllRecipients,
} from '../../src/core/meta.js';
import { MetaValidationError } from '../../src/types.js';
import type { MetaJson } from '../../src/types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'git-encrypt-meta-'));
}

// Minimal valid meta for testing
function makeMeta(overrides: Partial<MetaJson> = {}): MetaJson {
  return {
    version: 1,
    paths: {},
    recipients: {},
    files: {},
    ...overrides,
  };
}

describe('emptyMeta', () => {
  it('returns a valid empty MetaJson', () => {
    const m = emptyMeta();
    expect(m.version).toBe(1);
    expect(m.paths).toEqual({});
    expect(m.recipients).toEqual({});
    expect(m.files).toEqual({});
  });
});

describe('readMeta', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('returns empty meta when file does not exist', async () => {
    const dir = await tmpDir();
    dirs.push(dir);
    // Create .gitencrypt dir but no meta.json
    await fs.mkdir(path.join(dir, '.gitencrypt'), { recursive: true });
    const meta = await readMeta(dir);
    expect(meta).toEqual(emptyMeta());
  });

  it('reads and parses a valid meta.json', async () => {
    const dir = await tmpDir();
    dirs.push(dir);
    const expected = makeMeta({
      paths: { 'secrets/**': ['devs'] },
      recipients: { devs: ['age1abc'] },
    });
    await writeMeta(dir, expected);
    const meta = await readMeta(dir);
    expect(meta).toEqual(expected);
  });
});

describe('writeMeta + readMeta round-trip', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('round-trips a complete MetaJson', async () => {
    const dir = await tmpDir();
    dirs.push(dir);
    const meta: MetaJson = {
      version: 1,
      paths: { 'secrets/**': ['devs', 'ops'] },
      recipients: { devs: ['age1abc', 'age1def'], ops: ['age1xyz'] },
      files: {
        'secrets/api.key': {
          encrypted: '.gitencrypt/abc123.age',
          lastModified: 1234567890000,
        },
      },
    };
    await writeMeta(dir, meta);
    const result = await readMeta(dir);
    expect(result).toEqual(meta);
  });
});

describe('mergeFilesIntoMeta', () => {
  it('adds new file entries without overwriting existing ones', () => {
    const meta = makeMeta({
      files: {
        'secrets/a.key': { encrypted: '.gitencrypt/aaa.age', lastModified: 100 },
      },
    });
    const result = mergeFilesIntoMeta(meta, {
      'secrets/b.key': { encrypted: '.gitencrypt/bbb.age', lastModified: 200 },
    });
    expect(result.files['secrets/a.key']).toBeDefined();
    expect(result.files['secrets/b.key']).toBeDefined();
  });

  it('overwrites an existing entry for the same path', () => {
    const meta = makeMeta({
      files: {
        'secrets/a.key': { encrypted: '.gitencrypt/old.age', lastModified: 100 },
      },
    });
    const result = mergeFilesIntoMeta(meta, {
      'secrets/a.key': { encrypted: '.gitencrypt/new.age', lastModified: 200 },
    });
    expect(result.files['secrets/a.key']?.encrypted).toBe('.gitencrypt/new.age');
  });

  it('does not mutate the original meta', () => {
    const meta = makeMeta();
    const original = JSON.stringify(meta);
    mergeFilesIntoMeta(meta, {
      'x': { encrypted: '.gitencrypt/x.age', lastModified: 0 },
    });
    expect(JSON.stringify(meta)).toBe(original);
  });
});

describe('getRecipientsForFile', () => {
  const meta = makeMeta({
    paths: { 'secrets/**': ['devs', 'ops'], '*.env': ['ops'] },
    recipients: {
      devs: ['age1devkey1', 'age1devkey2'],
      ops: ['age1opskey1'],
    },
  });

  it('returns union of all matching group keys', () => {
    const keys = getRecipientsForFile(meta, 'secrets/api.key');
    expect(keys).toContain('age1devkey1');
    expect(keys).toContain('age1devkey2');
    expect(keys).toContain('age1opskey1');
  });

  it('returns only ops keys for .env file', () => {
    const keys = getRecipientsForFile(meta, '.env');
    expect(keys).toEqual(['age1opskey1']);
  });

  it('returns empty array for unmanaged files', () => {
    expect(getRecipientsForFile(meta, 'src/index.ts')).toEqual([]);
  });

  it('deduplicates keys that appear in multiple groups', () => {
    const m = makeMeta({
      paths: { 'a/**': ['g1'], 'a/b/**': ['g2'] },
      recipients: { g1: ['age1shared'], g2: ['age1shared'] },
    });
    const keys = getRecipientsForFile(m, 'a/b/file.txt');
    expect(keys.filter((k) => k === 'age1shared').length).toBe(1);
  });
});

describe('findPlaintextPath', () => {
  const meta = makeMeta({
    files: {
      'secrets/api.key': { encrypted: '.gitencrypt/abc.age', lastModified: 0 },
    },
  });

  it('finds the plaintext path by encrypted path', () => {
    expect(findPlaintextPath(meta, '.gitencrypt/abc.age')).toBe('secrets/api.key');
  });

  it('returns null for unknown encrypted path', () => {
    expect(findPlaintextPath(meta, '.gitencrypt/unknown.age')).toBeNull();
  });
});

describe('addPath / removePath', () => {
  it('adds a new glob mapping', () => {
    const m = makeMeta();
    const result = addPath(m, 'secrets/**', ['devs']);
    expect(result.paths['secrets/**']).toEqual(['devs']);
  });

  it('merges groups when glob already exists', () => {
    const m = makeMeta({ paths: { 'secrets/**': ['devs'] } });
    const result = addPath(m, 'secrets/**', ['ops']);
    expect(result.paths['secrets/**']).toContain('devs');
    expect(result.paths['secrets/**']).toContain('ops');
  });

  it('removes a glob mapping', () => {
    const m = makeMeta({ paths: { 'secrets/**': ['devs'], '*.env': ['ops'] } });
    const result = removePath(m, 'secrets/**');
    expect(result.paths['secrets/**']).toBeUndefined();
    expect(result.paths['*.env']).toBeDefined();
  });
});

describe('addRecipient / removeRecipient', () => {
  it('adds a recipient to a group', () => {
    const m = makeMeta();
    const result = addRecipient(m, 'devs', 'age1abc');
    expect(result.recipients['devs']).toContain('age1abc');
  });

  it('does not duplicate an existing recipient', () => {
    const m = makeMeta({ recipients: { devs: ['age1abc'] } });
    const result = addRecipient(m, 'devs', 'age1abc');
    expect(result.recipients['devs']?.filter((k) => k === 'age1abc').length).toBe(1);
    expect(result).toBe(m); // same reference returned
  });

  it('removes a recipient from a group', () => {
    const m = makeMeta({ recipients: { devs: ['age1abc', 'age1def'] } });
    const result = removeRecipient(m, 'devs', 'age1abc');
    expect(result.recipients['devs']).not.toContain('age1abc');
    expect(result.recipients['devs']).toContain('age1def');
  });
});

describe('collectAllRecipients', () => {
  it('collects unique keys from all groups used in paths', () => {
    const m = makeMeta({
      paths: { 'a/**': ['devs'], 'b/**': ['ops'] },
      recipients: {
        devs: ['age1dev1', 'age1dev2'],
        ops: ['age1ops1'],
        unused: ['age1unused'],
      },
    });
    const keys = collectAllRecipients(m);
    expect(keys).toContain('age1dev1');
    expect(keys).toContain('age1dev2');
    expect(keys).toContain('age1ops1');
    expect(keys).not.toContain('age1unused');
  });

  it('returns empty array when no paths defined', () => {
    expect(collectAllRecipients(makeMeta())).toEqual([]);
  });
});
