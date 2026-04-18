import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Atomically write data to destPath by writing to a tmp file first,
 * then renaming. On POSIX, rename is atomic; on Windows it's best-effort.
 */
export async function atomicWrite(
  destPath: string,
  data: Buffer | string
): Promise<void> {
  const dir = path.dirname(destPath);
  await fs.mkdir(dir, { recursive: true });

  const tmpPath = `${destPath}.tmp`;
  await fs.writeFile(tmpPath, data);

  try {
    await fs.rename(tmpPath, destPath);
  } catch (err) {
    // Clean up the tmp file if rename fails
    await fs.unlink(tmpPath).catch(() => undefined);
    throw err;
  }
}
