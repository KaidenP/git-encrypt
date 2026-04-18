import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempRepo } from './helpers/repo.js';
import {
  writeMeta,
  readMeta,
  addPath,
  addRecipient,
  emptyMeta,
} from '../../src/core/meta.js';
import { runPreCommit } from '../../src/hooks/pre-commit.js';

async function setupRepo() {
  const repo = await createTempRepo();

  // Initialize meta with a path and recipient
  let meta = emptyMeta();
  meta = addRecipient(meta, 'devs', repo.publicKey);
  meta = addPath(meta, 'secrets/**', ['devs']);
  await fs.mkdir(path.join(repo.dir, '.gitencrypt'), { recursive: true });
  await writeMeta(repo.dir, meta);

  return repo;
}

describe('pre-commit hook', () => {
  const repos: Awaited<ReturnType<typeof createTempRepo>>[] = [];

  afterEach(async () => {
    for (const repo of repos) await repo.cleanup();
    repos.length = 0;
  });

  it('encrypts a staged plaintext file and unstages it', async () => {
    const repo = await setupRepo();
    repos.push(repo);

    // Make an initial commit first so the repo has HEAD
    await repo.writeFile('README.md', 'test repo');
    await repo.git('add', 'README.md');
    await repo.git('commit', '-m', 'init', '--no-verify');

    // Create and stage a new secret file (after initial commit)
    await repo.writeFile('secrets/api.key', 'super-secret-value');
    await repo.git('add', 'secrets/api.key');

    // Override process.cwd to the repo dir for git commands
    const origCwd = process.cwd();
    process.chdir(repo.dir);
    try {
      await runPreCommit();
    } finally {
      process.chdir(origCwd);
    }

    // Verify plaintext is NOT in the index
    const stagedOutput = await repo.git('diff', '--cached', '--name-only');
    expect(stagedOutput).not.toContain('secrets/api.key');

    // Verify an .age file IS staged
    expect(stagedOutput).toContain('.age');

    // Verify the working tree file is still there (plaintext untouched)
    const content = await repo.readFile('secrets/api.key');
    expect(content).toBe('super-secret-value');
  });

  it('updates meta.json with the encrypted file entry', async () => {
    const repo = await setupRepo();
    repos.push(repo);

    await repo.writeFile('README.md', 'init');
    await repo.git('add', 'README.md');
    await repo.git('commit', '-m', 'init', '--no-verify');
    await repo.writeFile('secrets/db.password', 'db-pass-123');
    await repo.git('add', 'secrets/db.password');

    const origCwd = process.cwd();
    process.chdir(repo.dir);
    try {
      await runPreCommit();
    } finally {
      process.chdir(origCwd);
    }

    const meta = await readMeta(repo.dir);
    expect(meta.files['secrets/db.password']).toBeDefined();
    expect(meta.files['secrets/db.password']?.encrypted).toMatch(/^\.gitencrypt\/.+\.age$/);
  });

  it('does nothing when no managed files are staged', async () => {
    const repo = await setupRepo();
    repos.push(repo);

    await repo.writeFile('README.md', 'not a secret');
    await repo.writeFile('src/code.ts', 'export {};');
    await repo.git('add', 'README.md', 'src/code.ts');

    const origCwd = process.cwd();
    process.chdir(repo.dir);
    try {
      await runPreCommit();
    } finally {
      process.chdir(origCwd);
    }

    // Nothing should have changed — both files still staged
    const staged = await repo.git('diff', '--cached', '--name-only');
    expect(staged).toContain('README.md');
    expect(staged).toContain('src/code.ts');
  });
});
