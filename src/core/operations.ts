import fs from 'node:fs/promises';
import path from 'node:path';
import { stageFile, unstageFile } from './git.js';
import {
  readMeta,
  readOrDecryptMeta,
  writeMeta,
  encryptMeta,
  getRecipientsForFile,
  mergeFilesIntoMeta,
  metaAgePath,
  findPlaintextPath,
} from './meta.js';
import { encryptToRecipients, encryptFile, decryptFile } from './age.js';
import { generateFileHash } from './hash.js';
import { filterFilesByConfig, matchesAnyGlob } from './glob.js';
import type { StagingPlan, FileEntry } from '../types.js';
import { NoRecipientsError } from '../types.js';

/** Walk all files under the repo root that match any configured glob */
export async function expandGlobs(repoRoot: string, globs: string[]): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(repoRoot, full);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === '.gitencrypt') continue;
        await walk(full);
      } else if (entry.isFile()) {
        if (matchesAnyGlob(rel, globs)) {
          results.push(rel);
        }
      }
    }
  }

  await walk(repoRoot);
  return results;
}

/**
 * Plan encryption for a list of files.
 * Returns a staging plan with all files to encrypt, or throws on error.
 */
export async function planEncryption(
  repoRoot: string,
  filePaths: string[],
  metaFilePath: string,
  identityPath: string
): Promise<StagingPlan[]> {
  const identity = { identityPath };
  const meta = await readOrDecryptMeta(repoRoot, identityPath);

  const plans: StagingPlan[] = [];
  for (const filePath of filePaths) {
    const recipients = getRecipientsForFile(meta, filePath);
    if (recipients.length === 0) {
      throw new NoRecipientsError(filePath);
    }

    // Always generate a new encrypted path
    const hash = generateFileHash(filePath);
    const encryptedPath = `.gitencrypt/${hash}.age`;

    plans.push({ filePath, encryptedPath, hash, recipients });
  }
  return plans;
}

/**
 * Execute an encryption plan (write files, stage changes, update metadata).
 * Returns tracking of what was encrypted for logging/output.
 */
export async function executeEncryptionPlan(
  repoRoot: string,
  plans: StagingPlan[],
  options: { dryRun?: boolean } = {}
): Promise<{
  encrypted: Array<{ filePath: string; encryptedPath: string }>;
  unstaged: string[];
}> {
  const encrypted: Array<{ filePath: string; encryptedPath: string }> = [];
  const unstaged: string[] = [];
  const fileUpdates: Record<string, FileEntry> = {};
  const meta = await readMeta(repoRoot);

  try {
    for (const plan of plans) {
      const absPlaintext = path.join(repoRoot, plan.filePath);
      const absEncrypted = path.join(repoRoot, plan.encryptedPath);

      if (!options.dryRun) {
        // Delete old encrypted file if it exists and is different from the new one
        const oldEncryptedPath = meta.files[plan.filePath]?.encrypted;
        if (oldEncryptedPath && oldEncryptedPath !== plan.encryptedPath) {
          const absOldEncrypted = path.join(repoRoot, oldEncryptedPath);
          try {
            await fs.unlink(absOldEncrypted);
          } catch {
            // File might not exist, ignore
          }
        }

        // Read plaintext from working tree
        const plaintext = await fs.readFile(absPlaintext);
        const stat = await fs.stat(absPlaintext);

        // Encrypt
        const ciphertext = await encryptToRecipients(plaintext, plan.recipients);

        // Write encrypted file atomically
        await fs.mkdir(path.dirname(absEncrypted), { recursive: true });
        const tmpPath = `${absEncrypted}.tmp`;
        await fs.writeFile(tmpPath, ciphertext);
        await fs.rename(tmpPath, absEncrypted);

        fileUpdates[plan.filePath] = {
          encrypted: plan.encryptedPath,
          lastModified: stat.mtimeMs,
        };
      }

      encrypted.push({
        filePath: plan.filePath,
        encryptedPath: plan.encryptedPath,
      });
    }

    if (!options.dryRun && Object.keys(fileUpdates).length > 0) {
      const newMeta = mergeFilesIntoMeta(meta, fileUpdates);
      await writeMeta(repoRoot, newMeta);
      await encryptMeta(repoRoot, newMeta);
      await stageFile(repoRoot, path.relative(repoRoot, metaAgePath(repoRoot)));
    }

    return { encrypted, unstaged };
  } catch (err) {
    // Attempt to restore the index on failure (for pre-commit hook context)
    for (const filePath of unstaged) {
      try {
        await stageFile(repoRoot, filePath);
      } catch {
        // Ignore restore errors — we're already in an error state
      }
    }
    throw err;
  }
}

/**
 * Decrypt a single file. Handles conflict detection and mtime restoration.
 */
export async function decryptSingleFile(
  repoRoot: string,
  plaintextPath: string,
  encryptedPath: string,
  identityPath: string,
  lastModified: number,
  options: { force?: boolean; verbose?: boolean } = {}
): Promise<{
  decrypted: boolean;
  reason?: string;
}> {
  const absPlaintext = path.join(repoRoot, plaintextPath);
  const absEncrypted = path.join(repoRoot, encryptedPath);

  // Check if encrypted file exists
  try {
    await fs.access(absEncrypted);
  } catch {
    return { decrypted: false, reason: `encrypted file not found: ${encryptedPath}` };
  }

  // Conflict check: if plaintext exists and is newer, skip unless --force
  if (!options.force) {
    try {
      const stat = await fs.stat(absPlaintext);
      if (stat.mtimeMs > lastModified) {
        return {
          decrypted: false,
          reason: `${plaintextPath} has local modifications (use -f to overwrite)`,
        };
      }
    } catch {
      // Plaintext doesn't exist — safe to decrypt
    }
  }

  await decryptFile(absEncrypted, absPlaintext, identityPath);

  // Restore mtime
  try {
    const ts = lastModified / 1000;
    await fs.utimes(absPlaintext, ts, ts);
  } catch {
    // Non-fatal
  }

  return { decrypted: true };
}

/**
 * Decrypt all files listed in metadata.
 * Returns counts of decrypted and skipped files.
 */
export async function decryptTrackedFiles(
  repoRoot: string,
  identityPath: string,
  fileFilter?: (filePath: string) => boolean,
  options: { force?: boolean; verbose?: boolean } = {}
): Promise<{ decrypted: number; skipped: number }> {
  const meta = await readOrDecryptMeta(repoRoot, identityPath);

  let decrypted = 0;
  let skipped = 0;

  for (const [filePath, entry] of Object.entries(meta.files)) {
    if (fileFilter && !fileFilter(filePath)) continue;

    const result = await decryptSingleFile(
      repoRoot,
      filePath,
      entry.encrypted,
      identityPath,
      entry.lastModified,
      options
    );

    if (result.decrypted) {
      decrypted++;
      if (options.verbose) {
        console.log(`  decrypted: ${entry.encrypted} → ${filePath}`);
      } else {
        console.log(`  decrypted: ${filePath}`);
      }
    } else {
      skipped++;
      if (result.reason) {
        console.warn(`  skip: ${result.reason}`);
      }
    }
  }

  return { decrypted, skipped };
}

/**
 * Decrypt files that appear in encrypted paths (used by hooks).
 * Returns counts of decrypted and skipped files.
 */
export async function decryptEncryptedPaths(
  repoRoot: string,
  encryptedPaths: string[],
  identityPath: string,
  options: { force?: boolean } = {}
): Promise<{ decrypted: number; skipped: number }> {
  const meta = await readOrDecryptMeta(repoRoot, identityPath);

  let decrypted = 0;
  let skipped = 0;

  for (const encryptedRelPath of encryptedPaths) {
    const plaintextPath = findPlaintextPath(meta, encryptedRelPath);
    if (!plaintextPath) continue; // Orphan encrypted file

    const result = await decryptSingleFile(
      repoRoot,
      plaintextPath,
      encryptedRelPath,
      identityPath,
      meta.files[plaintextPath]?.lastModified ?? 0,
      options
    );

    if (result.decrypted) {
      decrypted++;
    } else {
      skipped++;
      if (result.reason) {
        process.stderr.write(`git-encrypt: skipping ${plaintextPath} — ${result.reason}\n`);
      }
    }
  }

  return { decrypted, skipped };
}
