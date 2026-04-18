import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempRepo } from './helpers/repo.js';
import { installCommand } from '../../src/cli/commands/install.js';

describe('install command', () => {
  const repos: Awaited<ReturnType<typeof createTempRepo>>[] = [];

  afterEach(async () => {
    for (const repo of repos) await repo.cleanup();
    repos.length = 0;
  });

  it('creates .gitencrypt/ directory', async () => {
    const repo = await createTempRepo();
    repos.push(repo);

    await installCommand({ force: false, windowsFallback: false }, repo.dir);

    expect(await repo.fileExists('.gitencrypt')).toBe(true);
  });

  it('writes .gitencrypt/.gitignore containing meta.json', async () => {
    const repo = await createTempRepo();
    repos.push(repo);

    await installCommand({ force: false, windowsFallback: false }, repo.dir);

    const gitignore = await repo.readFile('.gitencrypt/.gitignore');
    expect(gitignore).toContain('meta.json');
  });

  it('initializes a valid meta.json', async () => {
    const repo = await createTempRepo();
    repos.push(repo);

    await installCommand({ force: false, windowsFallback: false }, repo.dir);

    const raw = await repo.readFile('.gitencrypt/meta.json');
    const meta = JSON.parse(raw);
    expect(meta.version).toBe(1);
    expect(meta.paths).toEqual({});
    expect(meta.recipients).toEqual({ default: [repo.publicKey] });
    expect(meta.files).toEqual({});
  });

  it('installs all four hooks', async () => {
    const repo = await createTempRepo();
    repos.push(repo);

    await installCommand({ force: false, windowsFallback: true }, repo.dir);

    for (const hookName of ['pre-commit', 'post-checkout', 'post-merge', 'pre-push']) {
      const hookPath = path.join(repo.dir, '.git', 'hooks', hookName);
      const stat = await fs.lstat(hookPath);
      expect(stat).toBeTruthy();
    }
  });

  it('does not overwrite existing hooks without --force', async () => {
    const repo = await createTempRepo();
    repos.push(repo);

    // Pre-install a hook
    const hookPath = path.join(repo.dir, '.git', 'hooks', 'pre-commit');
    await fs.writeFile(hookPath, '#!/bin/sh\necho "existing"');

    await installCommand({ force: false, windowsFallback: true }, repo.dir);

    const content = await fs.readFile(hookPath, 'utf8');
    expect(content).toContain('existing');
  });

  it('overwrites existing hooks with --force', async () => {
    const repo = await createTempRepo();
    repos.push(repo);

    const hookPath = path.join(repo.dir, '.git', 'hooks', 'pre-commit');
    await fs.writeFile(hookPath, '#!/bin/sh\necho "existing"');

    await installCommand({ force: true, windowsFallback: true }, repo.dir);

    const content = await fs.readFile(hookPath, 'utf8');
    // The wrapper script invokes the binary with "hook pre-commit"
    expect(content).toContain('hook pre-commit');
  });

  it('is idempotent — running install twice is safe', async () => {
    const repo = await createTempRepo();
    repos.push(repo);

    await installCommand({ force: false, windowsFallback: true }, repo.dir);
    await installCommand({ force: false, windowsFallback: true }, repo.dir);

    expect(await repo.fileExists('.gitencrypt/meta.json')).toBe(true);
  });
});
