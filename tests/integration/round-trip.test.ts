import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempRepo } from './helpers/repo.js';
import {
  writeMeta,
  readMeta,
  encryptMeta,
  addPath,
  addRecipient,
  emptyMeta,
  collectAllRecipients,
} from '../../src/core/meta.js';
import { runPreCommit } from '../../src/hooks/pre-commit.js';
import { runPostCheckout } from '../../src/hooks/post-checkout.js';
import { decryptFile } from '../../src/core/age.js';

describe('encrypt → commit → checkout → decrypt round-trip', () => {
  const repos: Awaited<ReturnType<typeof createTempRepo>>[] = [];

  afterEach(async () => {
    for (const repo of repos) await repo.cleanup();
    repos.length = 0;
  });

  it('encrypts on commit and decrypts on checkout', async () => {
    const repo = await createTempRepo();
    repos.push(repo);

    const SECRET_CONTENT = 'my-super-secret-value-12345';

    // ── Setup: install meta config ──────────────────────────────────────────
    let meta = emptyMeta();
    meta = addRecipient(meta, 'devs', repo.publicKey);
    meta = addPath(meta, 'secrets/**', ['devs']);
    await fs.mkdir(path.join(repo.dir, '.gitencrypt'), { recursive: true });
    await writeMeta(repo.dir, meta);
    await encryptMeta(repo.dir, meta, collectAllRecipients(meta));

    // ── Initial commit (no secrets yet) ────────────────────────────────────
    await repo.writeFile('README.md', 'test repo');
    await repo.git('add', 'README.md', '.gitencrypt/meta.json.age');
    await repo.git('commit', '-m', 'init', '--no-verify');
    const initHead = await repo.git('rev-parse', 'HEAD');

    // ── Stage a secret file and run pre-commit ──────────────────────────────
    await repo.writeFile('secrets/api.key', SECRET_CONTENT);
    await repo.git('add', 'secrets/api.key');

    const origCwd = process.cwd();
    process.chdir(repo.dir);
    try {
      await runPreCommit();
    } finally {
      process.chdir(origCwd);
    }

    // The pre-commit hook should have staged the .age file instead
    const staged = await repo.git('diff', '--cached', '--name-only');
    expect(staged).not.toContain('secrets/api.key');
    const ageFileLine = staged.split('\n').find((l) => l.endsWith('.age'));
    expect(ageFileLine).toBeDefined();

    // Commit the encrypted file
    await repo.git('commit', '-m', 'add secret', '--no-verify');
    const secretHead = await repo.git('rev-parse', 'HEAD');

    // ── Simulate checkout back to init commit ───────────────────────────────
    await repo.git('checkout', initHead);

    // ── Simulate checkout back to secret commit (post-checkout fires) ───────
    process.chdir(repo.dir);
    try {
      await runPostCheckout(initHead, secretHead, '1');
    } finally {
      process.chdir(origCwd);
    }

    // ── Verify: decrypted plaintext matches original ────────────────────────
    const decryptedContent = await repo.readFile('secrets/api.key');
    expect(decryptedContent).toBe(SECRET_CONTENT);
  });

  it('does not overwrite a newer working-tree file during post-checkout', async () => {
    const repo = await createTempRepo();
    repos.push(repo);

    // Setup
    let meta = emptyMeta();
    meta = addRecipient(meta, 'devs', repo.publicKey);
    meta = addPath(meta, 'secrets/**', ['devs']);
    await fs.mkdir(path.join(repo.dir, '.gitencrypt'), { recursive: true });
    await writeMeta(repo.dir, meta);
    await encryptMeta(repo.dir, meta, collectAllRecipients(meta));

    // Initial commit
    await repo.writeFile('README.md', 'init');
    await repo.git('add', 'README.md', '.gitencrypt/meta.json.age');
    await repo.git('commit', '-m', 'init', '--no-verify');
    const initHead = await repo.git('rev-parse', 'HEAD');

    // Commit a secret
    await repo.writeFile('secrets/token.txt', 'original-secret');
    await repo.git('add', 'secrets/token.txt');

    const origCwd = process.cwd();
    process.chdir(repo.dir);
    try {
      await runPreCommit();
    } finally {
      process.chdir(origCwd);
    }
    await repo.git('commit', '-m', 'add secret', '--no-verify');
    const secretHead = await repo.git('rev-parse', 'HEAD');

    // Write a newer local version of the file
    const localContent = 'local-modified-content';
    await repo.writeFile('secrets/token.txt', localContent);

    // Wait a tiny bit to ensure mtime differs
    await new Promise((r) => setTimeout(r, 10));

    // Set the mtime of the local file to be very recent (newer than lastModified)
    const futureTs = Date.now() / 1000 + 1000;
    await fs.utimes(path.join(repo.dir, 'secrets/token.txt'), futureTs, futureTs);

    // Run post-checkout
    process.chdir(repo.dir);
    try {
      await runPostCheckout(initHead, secretHead, '1');
    } finally {
      process.chdir(origCwd);
    }

    // Local file should NOT have been overwritten
    const content = await repo.readFile('secrets/token.txt');
    expect(content).toBe(localContent);
  });
});
