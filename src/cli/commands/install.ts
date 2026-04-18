import fs from 'node:fs/promises';
import path from 'node:path';
import { getRepoRoot, getGitDir } from '../../core/git.js';
import { readMeta, writeMeta, metaDir, metaJsonPath } from '../../core/meta.js';
import { resolveIdentity } from '../../core/identity.js';
import { GitEncryptError } from '../../types.js';
import type { InstallOptions } from '../../types.js';

const HOOK_NAMES = ['pre-commit', 'post-checkout', 'post-merge', 'pre-push'] as const;

/** Write a shell wrapper script (Windows fallback) */
async function writeWrapperScript(
  hookPath: string,
  binaryAbsPath: string,
  hookName: string
): Promise<void> {
  const script = [
    '#!/bin/sh',
    `exec node "${binaryAbsPath}" hook ${hookName} "$@"`,
    '',
  ].join('\n');
  await fs.writeFile(hookPath, script, { mode: 0o755 });
}

/** Install a single hook as a symlink (POSIX) or wrapper script (Windows) */
async function installHook(
  hookPath: string,
  binaryAbsPath: string,
  hookName: string,
  options: InstallOptions
): Promise<'installed' | 'skipped' | 'replaced'> {
  let exists = false;
  try {
    await fs.lstat(hookPath);
    exists = true;
  } catch {
    // Hook doesn't exist yet
  }

  if (exists) {
    if (!options.force) {
      return 'skipped';
    }
    await fs.unlink(hookPath);
  }

  if (process.platform === 'win32' || options.windowsFallback) {
    await writeWrapperScript(hookPath, binaryAbsPath, hookName);
  } else {
    await fs.symlink(binaryAbsPath, hookPath);
    // Ensure the target is executable (symlink itself inherits target perms)
    try {
      await fs.chmod(binaryAbsPath, 0o755);
    } catch {
      // Best-effort; may fail if binary doesn't exist yet during development
    }
  }

  return exists ? 'replaced' : 'installed';
}

export async function installCommand(
  options: InstallOptions,
  targetDir?: string
): Promise<void> {
  let repoRoot: string;
  try {
    repoRoot = await getRepoRoot(targetDir);
  } catch {
    throw new GitEncryptError(
      'Not inside a git repository. Run `git init` first.'
    );
  }

  const gitDir = await getGitDir(targetDir);
  const hooksDir = path.join(gitDir, 'hooks');
  const encryptDir = metaDir(repoRoot);

  // Determine the path to the binary. During development use tsx; in production
  // use the built dist/index.js. We need the absolute path for symlinks/wrappers.
  // process.argv[1] is the entrypoint — use it directly.
  const binaryAbsPath = path.resolve(process.argv[1] ?? 'dist/index.js');

  // 1. Create .gitencrypt/ directory
  await fs.mkdir(encryptDir, { recursive: true });

  // 2. Write .gitencrypt/.gitignore
  const gitignorePath = path.join(encryptDir, '.gitignore');
  await fs.writeFile(gitignorePath, 'meta.json\n', { flag: 'w' });

  // 3. Resolve identity (generates one if none exists)
  console.log('Resolving age identity:');
  const identity = await resolveIdentity(repoRoot);
  const sourceLabel: Record<string, string> = {
    'git-config': 'from git config user.ageKeyPath',
    'env': 'from AGE_IDENTITY env var',
    'default-file': 'found at ~/.age_identity',
    'generated': 'generated and saved',
  };
  console.log(`  ${sourceLabel[identity.source]}: ${identity.identityPath}`);
  console.log(`  Public key: ${identity.publicKey}`);

  if (identity.source === 'generated') {
    console.log('\n  Share your public key with collaborators:');
    console.log(`    git-encrypt recipient add <group> ${identity.publicKey}`);
  }

  // 4. Initialize meta.json if not present
  const metaPath = metaJsonPath(repoRoot);
  try {
    await fs.access(metaPath);
    console.log('\n  meta.json already exists — skipping initialization.');
  } catch {
    const emptyMeta = {
      version: 1 as const,
      paths: {},
      recipients: { default: [identity.publicKey] },
      files: {},
    };
    await writeMeta(repoRoot, emptyMeta);
    console.log('  Initialized .gitencrypt/meta.json with default group');
  }

  // 5. Install hooks
  console.log('\nInstalling hooks:');
  for (const hookName of HOOK_NAMES) {
    const hookPath = path.join(hooksDir, hookName);
    const result = await installHook(hookPath, binaryAbsPath, hookName, options);

    const symbol = result === 'skipped' ? '⚠' : '✓';
    const note = result === 'skipped'
      ? '(already exists, use -f to replace)'
      : result === 'replaced'
      ? '(replaced existing)'
      : '';
    console.log(`  ${symbol} ${hookName} ${note}`);
  }

  console.log('\ngit-encrypt installed successfully.');
}
