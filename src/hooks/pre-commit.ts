import path from 'node:path';
import fs from 'node:fs/promises';
import { getRepoRoot, getStagedFiles, unstageFile, stageFile } from '../core/git.js';
import { readOrDecryptMeta, readMeta, writeMeta, encryptMeta, mergeFilesIntoMeta, metaAgePath } from '../core/meta.js';
import { resolveIdentity } from '../core/identity.js';
import { filterFilesByConfig } from '../core/glob.js';
import { encryptToRecipients } from '../core/age.js';
import { atomicWrite } from '../core/atomic.js';
import { planEncryption } from '../core/operations.js';
import type { FileEntry } from '../types.js';

export async function runPreCommit(): Promise<void> {
  const repoRoot = await getRepoRoot();
  const identity = await resolveIdentity(repoRoot);
  const meta = await readOrDecryptMeta(repoRoot, identity.identityPath);

  // Nothing configured — let the commit proceed
  if (Object.keys(meta.paths).length === 0) return;

  const staged = await getStagedFiles(repoRoot);
  const matching = filterFilesByConfig(staged, meta.paths);

  if (matching.length === 0) return;

  // Build the staging plan
  const plans = await planEncryption(repoRoot, matching, metaAgePath(repoRoot), identity.identityPath);

  // Execute the plan — track which files we've unstaged so we can restore on error
  const unstaged: string[] = [];
  const fileUpdates: Record<string, FileEntry> = {};

  try {
    for (const plan of plans) {
      const absPlaintext = path.join(repoRoot, plan.filePath);
      const absEncrypted = path.join(repoRoot, plan.encryptedPath);

      // Read plaintext from working tree
      const plaintext = await fs.readFile(absPlaintext);
      const stat = await fs.stat(absPlaintext);

      // Encrypt
      const ciphertext = await encryptToRecipients(plaintext, plan.recipients);

      // Write encrypted file atomically
      await fs.mkdir(path.dirname(absEncrypted), { recursive: true });
      await atomicWrite(absEncrypted, ciphertext);

      // Swap: remove plaintext from index, add encrypted file
      await unstageFile(repoRoot, plan.filePath);
      unstaged.push(plan.filePath);
      await stageFile(repoRoot, plan.encryptedPath);

      fileUpdates[plan.filePath] = {
        encrypted: plan.encryptedPath,
        lastModified: stat.mtimeMs,
      };
    }

    // Update and commit meta
    const currentMeta = await readMeta(repoRoot);
    const newMeta = mergeFilesIntoMeta(currentMeta, fileUpdates);
    await writeMeta(repoRoot, newMeta);
    await encryptMeta(repoRoot, newMeta);
    await stageFile(repoRoot, path.relative(repoRoot, metaAgePath(repoRoot)));

  } catch (err) {
    // Attempt to restore the index on failure
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
