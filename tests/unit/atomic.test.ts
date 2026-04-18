import { describe, it, expect, afterEach } from 'vitest';
import { atomicWrite } from '../../src/core/atomic.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'git-encrypt-test-'));
}

describe('atomicWrite', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs) {
      await fs.rm(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it('writes a string to the target path', async () => {
    const dir = await tmpDir();
    dirs.push(dir);
    const destPath = path.join(dir, 'output.txt');

    await atomicWrite(destPath, 'hello world');

    const content = await fs.readFile(destPath, 'utf8');
    expect(content).toBe('hello world');
  });

  it('writes a Buffer to the target path', async () => {
    const dir = await tmpDir();
    dirs.push(dir);
    const destPath = path.join(dir, 'binary.bin');
    const data = Buffer.from([1, 2, 3, 4]);

    await atomicWrite(destPath, data);

    const content = await fs.readFile(destPath);
    expect(content).toEqual(data);
  });

  it('creates parent directories if they do not exist', async () => {
    const dir = await tmpDir();
    dirs.push(dir);
    const destPath = path.join(dir, 'nested', 'deep', 'output.txt');

    await atomicWrite(destPath, 'nested');

    const content = await fs.readFile(destPath, 'utf8');
    expect(content).toBe('nested');
  });

  it('does not leave a .tmp file after a successful write', async () => {
    const dir = await tmpDir();
    dirs.push(dir);
    const destPath = path.join(dir, 'output.txt');

    await atomicWrite(destPath, 'test');

    const tmpPath = `${destPath}.tmp`;
    await expect(fs.access(tmpPath)).rejects.toThrow();
  });

  it('overwrites an existing file', async () => {
    const dir = await tmpDir();
    dirs.push(dir);
    const destPath = path.join(dir, 'output.txt');

    await atomicWrite(destPath, 'first');
    await atomicWrite(destPath, 'second');

    const content = await fs.readFile(destPath, 'utf8');
    expect(content).toBe('second');
  });
});
