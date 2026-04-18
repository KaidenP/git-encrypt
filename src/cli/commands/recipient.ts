import { getRepoRoot } from '../../core/git.js';
import {
  readMeta,
  writeMeta,
  encryptMeta,
  addRecipient,
  removeRecipient,
  collectAllRecipients,
} from '../../core/meta.js';
import { stageFile } from '../../core/git.js';
import { GitEncryptError } from '../../types.js';
import { metaAgePath } from '../../core/meta.js';
import path from 'node:path';

const AGE_PUBKEY_RE = /^age1[a-z0-9]{58}$/;

function validatePubkey(pubkey: string): void {
  if (!AGE_PUBKEY_RE.test(pubkey)) {
    throw new GitEncryptError(
      `Invalid age public key: "${pubkey}". Expected format: age1<58 alphanumeric chars>`
    );
  }
}

export async function recipientAdd(
  group: string,
  pubkey: string
): Promise<void> {
  validatePubkey(pubkey);
  const repoRoot = await getRepoRoot();
  const meta = await readMeta(repoRoot);

  const newMeta = addRecipient(meta, group, pubkey);

  if (newMeta === meta) {
    console.log(`Recipient already present in group "${group}": ${pubkey}`);
    return;
  }

  await writeMeta(repoRoot, newMeta);
  const recipients = collectAllRecipients(newMeta);
  if (recipients.length > 0) {
    await encryptMeta(repoRoot, newMeta);
    // Stage the updated encrypted meta
    try {
      await stageFile(repoRoot, path.relative(repoRoot, metaAgePath(repoRoot)));
    } catch {
      // Ignore staging errors (e.g., no initial commit yet)
    }
  }

  console.log(`Added recipient to group "${group}": ${pubkey}`);
}

export async function recipientRemove(
  group: string,
  pubkey: string
): Promise<void> {
  const repoRoot = await getRepoRoot();
  const meta = await readMeta(repoRoot);

  const existing = meta.recipients[group] ?? [];
  if (!existing.includes(pubkey)) {
    throw new GitEncryptError(
      `Recipient not found in group "${group}": ${pubkey}`
    );
  }

  const newMeta = removeRecipient(meta, group, pubkey);
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

  console.log(`Removed recipient from group "${group}": ${pubkey}`);
  console.warn(
    '\nWarning: existing encrypted files still use the old recipient set.\n' +
    'Run `git-encrypt encrypt` to re-encrypt with the updated recipients.'
  );
}

export async function recipientList(group?: string): Promise<void> {
  const repoRoot = await getRepoRoot();
  const meta = await readMeta(repoRoot);

  if (group) {
    const keys = meta.recipients[group] ?? [];
    if (keys.length === 0) {
      console.log(`No recipients in group "${group}".`);
    } else {
      console.log(`Group "${group}":`);
      for (const k of keys) console.log(`  ${k}`);
    }
    return;
  }

  const groups = Object.keys(meta.recipients);
  if (groups.length === 0) {
    console.log('No recipients configured. Use `git-encrypt recipient add`.');
    return;
  }

  for (const g of groups) {
    const keys = meta.recipients[g] ?? [];
    console.log(`${g}:`);
    for (const k of keys) console.log(`  ${k}`);
  }
}
