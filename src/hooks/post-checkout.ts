import { getRepoRoot } from '../core/git.js';
import { listChangedFilesInRange } from '../core/git.js';
import { readOrDecryptMeta } from '../core/meta.js';
import { resolveIdentity } from '../core/identity.js';
import { decryptEncryptedPaths } from '../core/operations.js';

export async function runPostCheckout(
  prevHead: string,
  newHead: string,
  branchFlag: string
): Promise<void> {
  // branchFlag === "0" means single-file checkout, not a branch switch
  if (branchFlag === '0') return;

  const repoRoot = await getRepoRoot();
  const identity = await resolveIdentity(repoRoot);
  const meta = await readOrDecryptMeta(repoRoot, identity.identityPath);

  if (Object.keys(meta.files).length === 0) return;

  // Determine which .age files changed between the two refs
  const changedFiles = await listChangedFilesInRange(prevHead, newHead, repoRoot);
  const changedAgeFiles = changedFiles.filter(
    (f) => f.startsWith('.gitencrypt/') && f.endsWith('.age')
  );

  if (changedAgeFiles.length === 0) return;

  await decryptEncryptedPaths(repoRoot, changedAgeFiles, identity.identityPath);
}
