import crypto from 'node:crypto';

/**
 * Generate a unique filename hash for an encrypted file.
 * sha256(filePath + ":" + randomBytes(16).hex) → 64-char hex string.
 * Two calls with the same path intentionally produce different hashes.
 */
export function generateFileHash(filePath: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  return crypto
    .createHash('sha256')
    .update(`${filePath}:${salt}`)
    .digest('hex');
}
