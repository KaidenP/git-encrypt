import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  encryptToRecipients,
  decryptWithIdentity,
  encryptFile,
  decryptFile,
  generateIdentity,
  publicKeyFromIdentityFile,
} from '../../src/core/age.js';
import { DecryptionError } from '../../src/types.js';
import { atomicWrite } from '../../src/core/atomic.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let tmpdir: string;
let identityPath: string;
let publicKey: string;

beforeAll(async () => {
  tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-encrypt-age-'));

  // Generate a fresh key pair for tests
  const [secretKey, pubKey] = await generateIdentity();
  publicKey = pubKey;

  identityPath = path.join(tmpdir, 'test.identity');
  const content = [
    '# Test identity',
    `# Public key: ${pubKey}`,
    secretKey,
    '',
  ].join('\n');
  await atomicWrite(identityPath, content);
});

afterAll(async () => {
  await fs.rm(tmpdir, { recursive: true, force: true });
});

describe('generateIdentity', () => {
  it('returns a secret key and public key', async () => {
    const [secretKey, pubKey] = await generateIdentity();
    expect(secretKey).toMatch(/^AGE-SECRET-KEY-/);
    expect(pubKey).toMatch(/^age1/);
  });

  it('generates unique key pairs each call', async () => {
    const [sk1] = await generateIdentity();
    const [sk2] = await generateIdentity();
    expect(sk1).not.toBe(sk2);
  });
});

describe('publicKeyFromIdentityFile', () => {
  it('derives the public key from an identity file', async () => {
    const derived = await publicKeyFromIdentityFile(identityPath);
    expect(derived).toBe(publicKey);
  });

  it('throws for a file without a valid secret key', async () => {
    const badPath = path.join(tmpdir, 'bad.identity');
    await atomicWrite(badPath, '# just a comment\n');
    await expect(publicKeyFromIdentityFile(badPath)).rejects.toThrow();
  });
});

describe('encryptToRecipients + decryptWithIdentity (round-trip)', () => {
  it('encrypts and decrypts a buffer', async () => {
    const plaintext = Buffer.from('Hello, git-encrypt!');
    const ciphertext = await encryptToRecipients(plaintext, [publicKey]);
    expect(ciphertext).not.toEqual(plaintext);

    const decrypted = await decryptWithIdentity(ciphertext, identityPath);
    expect(decrypted.toString()).toBe('Hello, git-encrypt!');
  });

  it('encrypts binary data faithfully', async () => {
    const data = Buffer.from([0, 1, 2, 3, 255, 254, 253]);
    const ciphertext = await encryptToRecipients(data, [publicKey]);
    const decrypted = await decryptWithIdentity(ciphertext, identityPath);
    expect(decrypted).toEqual(data);
  });

  it('throws DecryptionError with wrong identity', async () => {
    const plaintext = Buffer.from('secret data');
    const ciphertext = await encryptToRecipients(plaintext, [publicKey]);

    // Generate a different key pair
    const [otherSecret] = await generateIdentity();
    const wrongIdentityPath = path.join(tmpdir, 'wrong.identity');
    await atomicWrite(wrongIdentityPath, `${otherSecret}\n`);

    await expect(
      decryptWithIdentity(ciphertext, wrongIdentityPath)
    ).rejects.toBeInstanceOf(DecryptionError);
  });

  it('throws if no recipients are provided', async () => {
    await expect(
      encryptToRecipients(Buffer.from('data'), [])
    ).rejects.toThrow('no recipients');
  });

  it('throws DecryptionError when identity file is missing', async () => {
    const ciphertext = await encryptToRecipients(Buffer.from('data'), [publicKey]);
    await expect(
      decryptWithIdentity(ciphertext, '/nonexistent/identity')
    ).rejects.toBeInstanceOf(DecryptionError);
  });
});

describe('encryptFile + decryptFile (file round-trip)', () => {
  it('encrypts a file and decrypts it back', async () => {
    const srcPath = path.join(tmpdir, 'plaintext.txt');
    const encPath = path.join(tmpdir, 'encrypted.age');
    const outPath = path.join(tmpdir, 'decrypted.txt');

    await fs.writeFile(srcPath, 'file content here');

    const encResult = await encryptFile(srcPath, encPath, [publicKey]);
    expect(encResult.bytesWritten).toBeGreaterThan(0);
    expect(encResult.sourcePath).toBe(srcPath);

    const decResult = await decryptFile(encPath, outPath, identityPath);
    expect(decResult.bytesWritten).toBe('file content here'.length);

    const content = await fs.readFile(outPath, 'utf8');
    expect(content).toBe('file content here');
  });
});
