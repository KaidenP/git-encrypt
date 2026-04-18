import path from 'node:path';
import { getRepoRoot, stageFile } from '../../core/git.js';
import { readMeta, metaAgePath } from '../../core/meta.js';
import { resolveIdentity } from '../../core/identity.js';
import { filterFilesByConfig } from '../../core/glob.js';
import { expandGlobs, planEncryption } from '../../core/operations.js';

export async function encryptCommand(
  fileArgs: string[],
  options: { verbose?: boolean; dryRun?: boolean } = {}
): Promise<void> {
  const repoRoot = await getRepoRoot();
  const meta = await readMeta(repoRoot);
  const identity = await resolveIdentity(repoRoot);

  const globs = Object.keys(meta.paths);
  if (globs.length === 0) {
    console.log('No paths configured. Use `git-encrypt path add` first.');
    return;
  }

  // Resolve which files to encrypt
  let targetFiles: string[];
  if (fileArgs.length > 0) {
    // Normalize provided paths to be relative to repoRoot
    targetFiles = fileArgs.map((f) => path.relative(repoRoot, path.resolve(f)));
    // Filter to only those matching a configured glob
    const matched = filterFilesByConfig(targetFiles, meta.paths);
    const unmatched = targetFiles.filter((f) => !matched.includes(f));
    if (unmatched.length > 0) {
      console.warn(`Warning: these files don't match any configured glob:\n  ${unmatched.join('\n  ')}`);
    }
    targetFiles = matched;
  } else {
    // Expand all globs across the working tree
    targetFiles = await expandGlobs(repoRoot, globs);
  }

  if (targetFiles.length === 0) {
    console.log('No files to encrypt.');
    return;
  }

  // Plan and execute encryption
  const plans = await planEncryption(repoRoot, targetFiles, metaAgePath(repoRoot), identity.identityPath);

  for (const plan of plans) {
    if (options.verbose || options.dryRun) {
      const prefix = options.dryRun ? '[dry-run] ' : '';
      console.log(`  ${prefix}${plan.filePath} → ${plan.encryptedPath}`);
    } else {
      console.log(`  encrypted: ${plan.filePath}`);
    }
  }

  if (!options.dryRun) {
    const { encryptFile } = await import('../../core/age.js');

    for (const plan of plans) {
      const absPath = path.join(repoRoot, plan.filePath);
      const encryptedAbsPath = path.join(repoRoot, plan.encryptedPath);
      await encryptFile(absPath, encryptedAbsPath, plan.recipients);
    }

    const { writeMeta, encryptMeta, mergeFilesIntoMeta } = await import('../../core/meta.js');
    const currentMeta = await readMeta(repoRoot);
    const fileUpdates: Record<string, { encrypted: string; lastModified: number }> = {};

    for (const plan of plans) {
      const absPath = path.join(repoRoot, plan.filePath);
      const stat = await (await import('node:fs/promises')).stat(absPath);
      fileUpdates[plan.filePath] = {
        encrypted: plan.encryptedPath,
        lastModified: stat.mtimeMs,
      };
    }

    const newMeta = mergeFilesIntoMeta(currentMeta, fileUpdates);
    await writeMeta(repoRoot, newMeta);
    await encryptMeta(repoRoot, newMeta);

    // Stage the encrypted files and updated meta
    for (const plan of plans) {
      try {
        await stageFile(repoRoot, plan.encryptedPath);
      } catch {
        // May not be in a git repo context during testing
      }
    }
    try {
      await stageFile(repoRoot, path.relative(repoRoot, metaAgePath(repoRoot)));
    } catch {
      // Ignore staging errors
    }
  }
}
