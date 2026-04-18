import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { generateAndSaveIdentity } from '../../../src/core/identity.js';

const execFile = promisify(execFileCb);

export interface TestRepo {
  dir: string;
  identityPath: string;
  publicKey: string;
  /** Run a git command in this repo */
  git(...args: string[]): Promise<string>;
  /** Write a file relative to repo root */
  writeFile(relPath: string, content: string): Promise<void>;
  /** Read a file relative to repo root */
  readFile(relPath: string): Promise<string>;
  /** Check if a file exists */
  fileExists(relPath: string): Promise<boolean>;
  /** Clean up the temp directory */
  cleanup(): Promise<void>;
}

/**
 * Create a temporary git repository for integration testing.
 * Sets up a user identity and an age key pair.
 */
export async function createTempRepo(): Promise<TestRepo> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-encrypt-integ-'));

  const git = async (...args: string[]): Promise<string> => {
    const { stdout } = await execFile('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        // Prevent git from reading user's global config for clean isolation
        GIT_CONFIG_NOSYSTEM: '1',
        HOME: dir,
      },
    });
    return stdout.trim();
  };

  // Initialize git repo
  await git('init');
  await git('config', 'user.name', 'Test User');
  await git('config', 'user.email', 'test@example.com');

  // Generate age identity in the temp dir
  const identityPath = path.join(dir, '.age_identity');
  const { publicKey } = await generateAndSaveIdentity(identityPath);

  // Point git config at this identity
  await git('config', 'user.ageKeyPath', identityPath);

  const repo: TestRepo = {
    dir,
    identityPath,
    publicKey,

    git,

    async writeFile(relPath: string, content: string): Promise<void> {
      const absPath = path.join(dir, relPath);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, content, 'utf8');
    },

    async readFile(relPath: string): Promise<string> {
      return fs.readFile(path.join(dir, relPath), 'utf8');
    },

    async fileExists(relPath: string): Promise<boolean> {
      try {
        await fs.access(path.join(dir, relPath));
        return true;
      } catch {
        return false;
      }
    },

    async cleanup(): Promise<void> {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };

  return repo;
}
