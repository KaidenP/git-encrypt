import { getRepoRoot, listChangedFilesInRange } from '../core/git.js';
import { readOrDecryptMeta } from '../core/meta.js';
import { resolveIdentity } from '../core/identity.js';
import { decryptEncryptedPaths } from '../core/operations.js';

export async function runPostMerge(_squashFlag: string): Promise<void> {
  const repoRoot = await getRepoRoot();
  const identity = await resolveIdentity(repoRoot);
  const meta = await readOrDecryptMeta(repoRoot, identity.identityPath);

  if (Object.keys(meta.files).length === 0) return;

  // Find encrypted files that changed as a result of the merge
  const changedFiles = await listChangedFilesInRange('HEAD@{1}', 'HEAD', repoRoot);
  const changedAgeFiles = changedFiles.filter(
    (f) => f.startsWith('.gitencrypt/') && f.endsWith('.age')
  );

  if (changedAgeFiles.length === 0) return;

  await decryptEncryptedPaths(repoRoot, changedAgeFiles, identity.identityPath);
}
