import path from 'node:path';
import { getRepoRoot, stageFile } from '../../core/git.js';
import {
  readMeta,
  writeMeta,
  encryptMeta,
  addPath,
  removePath,
  collectAllRecipients,
  metaAgePath,
} from '../../core/meta.js';
import { GitEncryptError } from '../../types.js';

export async function pathAdd(glob: string, groups: string[]): Promise<void> {
  if (groups.length === 0) {
    groups = ['default']
    // throw new GitEncryptError(
    //   'Specify at least one group with -g <group>. E.g. git-encrypt path add "secrets/**" -g default'
    // );
  }

  const repoRoot = await getRepoRoot();
  const meta = await readMeta(repoRoot);

  // Warn about groups that don't yet have recipients
  for (const g of groups) {
    const keys = meta.recipients[g] ?? [];
    if (keys.length === 0) {
      console.warn(
        `Warning: group "${g}" has no recipients. Add one with: git-encrypt recipient add ${g} <pubkey>`
      );
    }
  }

  const newMeta = addPath(meta, glob, groups);
  await writeMeta(repoRoot, newMeta);

  const recipients = collectAllRecipients(newMeta);
  if (recipients.length > 0) {
    await encryptMeta(repoRoot, newMeta);
    try {
      await stageFile(repoRoot, path.relative(repoRoot, metaAgePath(repoRoot)));
    } catch {
      // Ignore staging errors before first commit
    }
  }

  console.log(`Files matching "${glob}" will be encrypted on next commit.`);
  console.log(`  Groups: ${groups.join(', ')}`);
}

export async function pathRemove(glob: string): Promise<void> {
  const repoRoot = await getRepoRoot();
  const meta = await readMeta(repoRoot);

  if (!(glob in meta.paths)) {
    throw new GitEncryptError(`Glob not found in configuration: "${glob}"`);
  }

  const newMeta = removePath(meta, glob);
  await writeMeta(repoRoot, newMeta);

  const recipients = collectAllRecipients(newMeta);
  if (recipients.length > 0) {
    await encryptMeta(repoRoot, newMeta);
    try {
      await stageFile(repoRoot, path.relative(repoRoot, metaAgePath(repoRoot)));
    } catch {
      // Ignore staging errors
    }
  }

  console.log(`Removed path configuration: "${glob}"`);
}

export async function pathList(): Promise<void> {
  const repoRoot = await getRepoRoot();
  const meta = await readMeta(repoRoot);

  const entries = Object.entries(meta.paths);
  if (entries.length === 0) {
    console.log('No paths configured. Use `git-encrypt path add`.');
    return;
  }

  console.log('Configured paths:');
  for (const [glob, groups] of entries) {
    console.log(`  ${glob}  →  ${groups.join(', ')}`);
  }
}
