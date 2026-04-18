import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024, // 10 MB
  });
  return stdout.trim();
}

/** Returns the absolute path to the repository root */
export async function getRepoRoot(cwd?: string): Promise<string> {
  return git(['rev-parse', '--show-toplevel'], cwd);
}

/** Returns the absolute path to the .git directory */
export async function getGitDir(cwd?: string): Promise<string> {
  const raw = await git(['rev-parse', '--git-dir'], cwd);
  // If relative, resolve against cwd
  if (!raw.startsWith('/')) {
    const root = await getRepoRoot(cwd);
    return `${root}/${raw}`;
  }
  return raw;
}

/** Returns staged file paths (relative to repo root), or [] if nothing staged */
export async function getStagedFiles(repoRoot: string): Promise<string[]> {
  const output = await git(
    ['diff', '--cached', '--name-only', '--diff-filter=ACM'],
    repoRoot
  ).catch(() => '');
  return output ? output.split('\n').filter(Boolean) : [];
}

/**
 * Unstage a file from the index without touching the working tree.
 * Equivalent to: git rm --cached <file>
 */
export async function unstageFile(
  repoRoot: string,
  filePath: string
): Promise<void> {
  await git(['rm', '--cached', '--', filePath], repoRoot);
}

/** Stage a file (git add) */
export async function stageFile(
  repoRoot: string,
  filePath: string
): Promise<void> {
  await git(['add', '--', filePath], repoRoot);
}

/** Get a git config value. Returns null if not set. */
export async function getGitConfig(key: string, cwd?: string): Promise<string | null> {
  try {
    return await git(['config', '--get', key], cwd);
  } catch {
    return null;
  }
}

/** Set a git config value (local repo config) */
export async function setGitConfig(
  key: string,
  value: string,
  cwd?: string
): Promise<void> {
  await git(['config', key, value], cwd);
}

/**
 * Returns files that changed between two refs (name-only).
 * E.g. listChangedFilesInRange('HEAD@{1}', 'HEAD', repoRoot)
 */
export async function listChangedFilesInRange(
  from: string,
  to: string,
  repoRoot: string
): Promise<string[]> {
  // Handle case where one ref is the null hash (initial commit checkout)
  if (from === '0000000000000000000000000000000000000000') {
    const output = await git(
      ['ls-tree', '--name-only', '-r', to],
      repoRoot
    ).catch(() => '');
    return output ? output.split('\n').filter(Boolean) : [];
  }

  const output = await git(
    ['diff', '--name-only', from, to],
    repoRoot
  ).catch(() => '');
  return output ? output.split('\n').filter(Boolean) : [];
}

/** Resolve a ref to a full commit SHA. Returns null if the ref doesn't exist. */
export async function resolveRef(
  ref: string,
  repoRoot: string
): Promise<string | null> {
  try {
    return await git(['rev-parse', '--verify', ref], repoRoot);
  } catch {
    return null;
  }
}

/** Check if a file exists in the current index (staged) */
export async function fileExistsInIndex(
  repoRoot: string,
  filePath: string
): Promise<boolean> {
  try {
    await git(['ls-files', '--error-unmatch', '--', filePath], repoRoot);
    return true;
  } catch {
    return false;
  }
}
