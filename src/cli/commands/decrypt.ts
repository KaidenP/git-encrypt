import path from 'node:path';
import { getRepoRoot } from '../../core/git.js';
import { readOrDecryptMeta } from '../../core/meta.js';
import { resolveIdentity } from '../../core/identity.js';
import { decryptTrackedFiles } from '../../core/operations.js';
import { GitEncryptError } from '../../types.js';

export async function decryptCommand(
  fileArgs: string[],
  options: { force?: boolean; verbose?: boolean } = {}
): Promise<void> {
  const repoRoot = await getRepoRoot();
  const identity = await resolveIdentity(repoRoot);
  const meta = await readOrDecryptMeta(repoRoot, identity.identityPath);

  const allFiles = Object.keys(meta.files);
  if (allFiles.length === 0) {
    console.log('No encrypted files tracked in meta.json.');
    return;
  }

  // Validate requested files exist in meta
  if (fileArgs.length > 0) {
    const normalized = fileArgs.map((f) => path.relative(repoRoot, path.resolve(f)));
    const notFound = normalized.filter((f) => !allFiles.includes(f));
    if (notFound.length > 0) {
      throw new GitEncryptError(
        `These files are not tracked in meta.json:\n  ${notFound.join('\n  ')}`
      );
    }

    // Create a filter for the requested files
    const fileSet = new Set(normalized);
    const { decrypted, skipped } = await decryptTrackedFiles(
      repoRoot,
      identity.identityPath,
      (filePath) => fileSet.has(filePath),
      options
    );

    console.log(`\nDone: ${decrypted} decrypted, ${skipped} skipped.`);
  } else {
    const { decrypted, skipped } = await decryptTrackedFiles(
      repoRoot,
      identity.identityPath,
      undefined,
      options
    );

    console.log(`\nDone: ${decrypted} decrypted, ${skipped} skipped.`);
  }
}
