import readline from 'node:readline/promises';
import { getRepoRoot } from '../core/git.js';
import { readOrDecryptMeta } from '../core/meta.js';
import { resolveIdentity } from '../core/identity.js';
import { filterFilesByConfig } from '../core/glob.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function getDiffFiles(
  localSha: string,
  remoteSha: string,
  repoRoot: string
): Promise<string[]> {
  // If remote SHA is the null hash (no remote tracking branch), compare to empty tree
  const from =
    remoteSha === '0000000000000000000000000000000000000000'
      ? '4b825dc642cb6eb9a060e54bf8d69288fbee4904' // git empty tree hash
      : remoteSha;

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--name-only', from, localSha],
      { cwd: repoRoot, encoding: 'utf8' }
    );
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export async function runPrePush(
  _remoteName: string,
  _remoteUrl: string
): Promise<void> {
  const repoRoot = await getRepoRoot();
  const identity = await resolveIdentity(repoRoot);
  const meta = await readOrDecryptMeta(repoRoot, identity.identityPath);

  if (Object.keys(meta.paths).length === 0) return;

  // Read push refs from stdin (git provides them as:
  // <local-ref> <local-sha1> <remote-ref> <remote-sha1>)
  const rl = readline.createInterface({ input: process.stdin });
  const violations: string[] = [];

  for await (const line of rl) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;

    const [, localSha, , remoteSha] = parts as [string, string, string, string];

    // Skip deletions (localSha is zeros)
    if (localSha === '0000000000000000000000000000000000000000') continue;

    const changedFiles = await getDiffFiles(localSha, remoteSha!, repoRoot);
    const plaintext = filterFilesByConfig(changedFiles, meta.paths);

    for (const f of plaintext) {
      // If the file is tracked as encrypted, that's fine — it means the
      // plaintext is managed but only the .age version is staged. But if
      // the plaintext file path itself appears in the diff, that's a leak.
      violations.push(f);
    }
  }

  if (violations.length > 0) {
    process.stderr.write(
      `git-encrypt: Refusing push. The following plaintext files would be pushed:\n`
    );
    for (const f of violations) {
      process.stderr.write(`  ${f}\n`);
    }
    process.stderr.write(
      `Run 'git-encrypt encrypt' and re-commit before pushing.\n`
    );
    process.exit(1);
  }
}
