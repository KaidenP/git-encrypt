import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateIdentity, publicKeyFromIdentityFile } from './age.js';
import { getGitConfig, setGitConfig } from './git.js';
import { atomicWrite } from './atomic.js';
import type { IdentityResolution } from '../types.js';

/** Default path for the age identity file */
export function defaultIdentityPath(): string {
  return path.join(os.homedir(), '.age_identity');
}

/**
 * Check if a file exists and is readable.
 */
async function fileReadable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the age identity to use, in priority order:
 * 1. git config user.ageKeyPath
 * 2. AGE_IDENTITY env var
 * 3. ~/.age_identity (if it exists)
 * 4. Generate a new key, save it, configure git
 */
export async function resolveIdentity(
  repoRoot?: string
): Promise<IdentityResolution> {
  // 1. git config user.ageKeyPath
  const gitConfigPath = await getGitConfig('user.ageKeyPath', repoRoot);
  if (gitConfigPath && (await fileReadable(gitConfigPath))) {
    const publicKey = await publicKeyFromIdentityFile(gitConfigPath);
    return { identityPath: gitConfigPath, publicKey, source: 'git-config' };
  }

  // 2. AGE_IDENTITY env var
  const envPath = process.env['AGE_IDENTITY'];
  if (envPath && (await fileReadable(envPath))) {
    const publicKey = await publicKeyFromIdentityFile(envPath);
    return { identityPath: envPath, publicKey, source: 'env' };
  }

  // 3. ~/.age_identity
  const defaultPath = defaultIdentityPath();
  if (await fileReadable(defaultPath)) {
    const publicKey = await publicKeyFromIdentityFile(defaultPath);
    return { identityPath: defaultPath, publicKey, source: 'default-file' };
  }

  // 4. Generate a new key
  return generateAndSaveIdentity(defaultPath, repoRoot);
}

/**
 * Generate a new age identity, save it to destPath, and configure git.
 */
export async function generateAndSaveIdentity(
  destPath: string,
  repoRoot?: string
): Promise<IdentityResolution> {
  const [secretKey, publicKey] = await generateIdentity();

  const content = [
    '# Created by git-encrypt',
    `# Public key: ${publicKey}`,
    secretKey,
    '',
  ].join('\n');

  await atomicWrite(destPath, content);

  // Make the identity file readable only by the owner
  try {
    await fs.chmod(destPath, 0o600);
  } catch {
    // Ignore chmod failures on Windows
  }

  // Configure git to point to this identity
  try {
    await setGitConfig('user.ageKeyPath', destPath, repoRoot);
  } catch {
    // Non-fatal: git config set may fail if not in a repo context
  }

  return { identityPath: destPath, publicKey, source: 'generated' };
}
