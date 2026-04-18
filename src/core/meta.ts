import fs from 'node:fs/promises';
import path from 'node:path';
import type { MetaJson, FileEntry, PathConfig } from '../types.js';
import { MetaValidationError } from '../types.js';
import { atomicWrite } from './atomic.js';
import { encryptToRecipients, decryptWithIdentity } from './age.js';
import { getGroupsForFile } from './glob.js';

const GITENCRYPT_DIR = '.gitencrypt';
const META_FILE = 'meta.json';
const META_AGE_FILE = 'meta.json.age';

export function metaDir(repoRoot: string): string {
  return path.join(repoRoot, GITENCRYPT_DIR);
}

export function metaJsonPath(repoRoot: string): string {
  return path.join(repoRoot, GITENCRYPT_DIR, META_FILE);
}

export function metaAgePath(repoRoot: string): string {
  return path.join(repoRoot, GITENCRYPT_DIR, META_AGE_FILE);
}

/** Returns an empty, valid MetaJson */
export function emptyMeta(): MetaJson {
  return { version: 1, paths: {}, recipients: {}, files: {} };
}

/** Validate that a parsed object conforms to MetaJson */
function validateMeta(obj: unknown): MetaJson {
  if (!obj || typeof obj !== 'object') {
    throw new MetaValidationError('meta.json is not an object');
  }
  const m = obj as Record<string, unknown>;
  if (m['version'] !== 1) {
    throw new MetaValidationError(`Unsupported meta.json version: ${m['version']}`);
  }
  if (typeof m['paths'] !== 'object' || m['paths'] === null) {
    throw new MetaValidationError('meta.json missing "paths" object');
  }
  if (typeof m['recipients'] !== 'object' || m['recipients'] === null) {
    throw new MetaValidationError('meta.json missing "recipients" object');
  }
  if (typeof m['files'] !== 'object' || m['files'] === null) {
    throw new MetaValidationError('meta.json missing "files" object');
  }
  return m as unknown as MetaJson;
}

/**
 * Read and parse meta.json from the repo.
 * Returns an empty MetaJson if the file does not exist.
 */
export async function readMeta(repoRoot: string): Promise<MetaJson> {
  const metaPath = metaJsonPath(repoRoot);
  try {
    const raw = await fs.readFile(metaPath, 'utf8');
    return validateMeta(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyMeta();
    }
    throw err;
  }
}

/**
 * Write meta.json to the repo (plaintext, gitignored).
 */
export async function writeMeta(repoRoot: string, meta: MetaJson): Promise<void> {
  const metaPath = metaJsonPath(repoRoot);
  await atomicWrite(metaPath, JSON.stringify(meta, null, 2) + '\n');
}

/**
 * Collect all unique age public keys referenced by groups used in meta.paths.
 */
export function collectAllRecipients(meta: MetaJson): string[] {
  const usedGroups = new Set(Object.values(meta.paths).flat());
  const keys = new Set<string>();
  for (const group of usedGroups) {
    const groupKeys = meta.recipients[group] ?? [];
    for (const k of groupKeys) keys.add(k);
  }
  return [...keys];
}

/**
 * Encrypt the current meta.json state and write to meta.json.age.
 * Uses the union of all recipients referenced in meta.paths.
 */
export async function encryptMeta(
  repoRoot: string,
  meta: MetaJson,
  recipients?: string[]
): Promise<void> {
  const keys = recipients ?? collectAllRecipients(meta);
  if (keys.length === 0) {
    // No recipients yet — write an unencrypted placeholder
    // (install command may call this before any recipients are added)
    return;
  }

  const plaintext = Buffer.from(JSON.stringify(meta, null, 2) + '\n');
  const ciphertext = await encryptToRecipients(plaintext, keys);
  await atomicWrite(metaAgePath(repoRoot), ciphertext);
}

/**
 * Decrypt meta.json.age using the given identity file and return the parsed MetaJson.
 */
export async function decryptMeta(
  repoRoot: string,
  identityPath: string
): Promise<MetaJson> {
  const agePath = metaAgePath(repoRoot);
  const ciphertext = await fs.readFile(agePath);
  const plaintext = await decryptWithIdentity(ciphertext, identityPath);
  return validateMeta(JSON.parse(plaintext.toString('utf8')));
}

/**
 * Merge FileEntry updates into meta without overwriting unrelated keys.
 */
export function mergeFilesIntoMeta(
  meta: MetaJson,
  updates: Record<string, FileEntry>
): MetaJson {
  return {
    ...meta,
    files: { ...meta.files, ...updates },
  };
}

/**
 * Returns all unique age public keys that should be used to encrypt a given file,
 * by checking which globs in meta.paths match the file and collecting all their groups' keys.
 */
export function getRecipientsForFile(meta: MetaJson, filePath: string): string[] {
  const groups = getGroupsForFile(filePath, meta.paths);
  const keys = new Set<string>();
  for (const group of groups) {
    const groupKeys = meta.recipients[group] ?? [];
    for (const k of groupKeys) keys.add(k);
  }
  return [...keys];
}

/**
 * Find the plaintext path for a given encrypted path by reverse lookup in meta.files.
 * Returns null if not found.
 */
export function findPlaintextPath(
  meta: MetaJson,
  encryptedPath: string
): string | null {
  // Normalize the search value to use forward slashes
  const normalized = encryptedPath.replace(/\\/g, '/');
  for (const [filePath, entry] of Object.entries(meta.files)) {
    if (entry.encrypted.replace(/\\/g, '/') === normalized) {
      return filePath;
    }
  }
  return null;
}

/**
 * Attempt to read meta.json; if not found, fall back to decrypting meta.json.age.
 */
export async function readOrDecryptMeta(
  repoRoot: string,
  identityPath: string
): Promise<MetaJson> {
  const metaPath = metaJsonPath(repoRoot);
  try {
    await fs.access(metaPath);
    return await readMeta(repoRoot);
  } catch {
    // Fall back to decrypting
    try {
      const meta = await decryptMeta(repoRoot, identityPath);
      // Cache it locally for future hook calls this session
      await writeMeta(repoRoot, meta);
      return meta;
    } catch {
      return emptyMeta();
    }
  }
}

/**
 * Helper used by `path add`: add a glob → groups mapping.
 * Merges groups if the glob already exists.
 */
export function addPath(
  meta: MetaJson,
  glob: string,
  groups: string[]
): MetaJson {
  const existing = meta.paths[glob] ?? [];
  const merged = [...new Set([...existing, ...groups])];
  return { ...meta, paths: { ...meta.paths, [glob]: merged } };
}

/**
 * Helper used by `path remove`: delete a glob mapping.
 */
export function removePath(meta: MetaJson, glob: string): MetaJson {
  const { [glob]: _removed, ...rest } = meta.paths;
  return { ...meta, paths: rest };
}

/**
 * Helper used by `recipient add`.
 */
export function addRecipient(
  meta: MetaJson,
  group: string,
  pubkey: string
): MetaJson {
  const existing = meta.recipients[group] ?? [];
  if (existing.includes(pubkey)) return meta;
  return {
    ...meta,
    recipients: { ...meta.recipients, [group]: [...existing, pubkey] },
  };
}

/**
 * Helper used by `recipient remove`.
 */
export function removeRecipient(
  meta: MetaJson,
  group: string,
  pubkey: string
): MetaJson {
  const existing = meta.recipients[group] ?? [];
  return {
    ...meta,
    recipients: {
      ...meta.recipients,
      [group]: existing.filter((k) => k !== pubkey),
    },
  };
}
