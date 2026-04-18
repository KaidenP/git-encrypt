import fs from 'node:fs/promises';
import path from 'node:path';
import initAge from 'age-encryption';
import type { EncryptResult, DecryptResult } from '../types.js';
import { DecryptionError } from '../types.js';
import { atomicWrite } from './atomic.js';

// Lazily initialize the WASM module once and reuse the instance
let ageLib: Awaited<ReturnType<typeof initAge>> | null = null;

async function getAge(): Promise<Awaited<ReturnType<typeof initAge>>> {
  if (!ageLib) {
    ageLib = await initAge();
  }
  return ageLib;
}

/**
 * Encrypt a plaintext buffer to one or more age X25519 recipients.
 * Returns the encrypted payload (armored binary).
 */
export async function encryptToRecipients(
  plaintext: Buffer,
  recipients: string[]
): Promise<Buffer> {
  if (recipients.length === 0) {
    throw new Error('Cannot encrypt: no recipients provided');
  }

  const age = await getAge();
  const encrypter = new age.Encrypter();
  for (const recipient of recipients) {
    encrypter.addRecipient(recipient);
  }

  const ciphertext = encrypter.encrypt(new Uint8Array(plaintext));
  return Buffer.from(ciphertext);
}

/**
 * Decrypt an age-encrypted buffer using an identity file (private key).
 * The identity file contains a line like: AGE-SECRET-KEY-1...
 */
export async function decryptWithIdentity(
  ciphertext: Buffer,
  identityPath: string
): Promise<Buffer> {
  const age = await getAge();

  let identityContent: string;
  try {
    identityContent = await fs.readFile(identityPath, 'utf8');
  } catch {
    throw new DecryptionError(`Cannot read identity file: ${identityPath}`);
  }

  // Extract the secret key line (may have comment lines starting with #)
  const secretKey = identityContent
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('AGE-SECRET-KEY-'));

  if (!secretKey) {
    throw new DecryptionError(
      `No valid age secret key found in identity file: ${identityPath}`
    );
  }

  const decrypter = new age.Decrypter();
  decrypter.addIdentity(secretKey);

  try {
    const plaintext = decrypter.decrypt(new Uint8Array(ciphertext));
    return Buffer.from(plaintext);
  } catch (err) {
    throw new DecryptionError(
      `Decryption failed (wrong key or corrupted file): ${(err as Error).message}`
    );
  }
}

/**
 * Encrypt a file on disk to destPath using the given age recipients.
 */
export async function encryptFile(
  srcPath: string,
  destPath: string,
  recipients: string[]
): Promise<EncryptResult> {
  const plaintext = await fs.readFile(srcPath);
  const ciphertext = await encryptToRecipients(plaintext, recipients);

  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await atomicWrite(destPath, ciphertext);

  const hash = path.basename(destPath, '.age');
  return {
    sourcePath: srcPath,
    encryptedPath: destPath,
    hash,
    bytesWritten: ciphertext.length,
  };
}

/**
 * Decrypt a file on disk from srcPath to destPath using the given identity file.
 */
export async function decryptFile(
  srcPath: string,
  destPath: string,
  identityPath: string
): Promise<DecryptResult> {
  const ciphertext = await fs.readFile(srcPath);
  const plaintext = await decryptWithIdentity(ciphertext, identityPath);

  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await atomicWrite(destPath, plaintext);

  return {
    encryptedPath: srcPath,
    destPath,
    bytesWritten: plaintext.length,
  };
}

/**
 * Generate a new age identity (private key line) and derive its public key.
 * Returns [identityLine, publicKey].
 */
export async function generateIdentity(): Promise<[string, string]> {
  const age = await getAge();
  const identity = age.generateIdentity();
  const publicKey = age.identityToRecipient(identity);
  return [identity, publicKey];
}

/**
 * Derive the public key from an age identity file.
 */
export async function publicKeyFromIdentityFile(
  identityPath: string
): Promise<string> {
  const age = await getAge();
  const content = await fs.readFile(identityPath, 'utf8');

  const secretKey = content
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('AGE-SECRET-KEY-'));

  if (!secretKey) {
    throw new Error(`No valid age secret key found in: ${identityPath}`);
  }

  return age.identityToRecipient(secretKey);
}
