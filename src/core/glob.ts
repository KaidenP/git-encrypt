import { Minimatch } from 'minimatch';
import path from 'node:path';
import type { PathConfig } from '../types.js';

// Cache compiled Minimatch instances to avoid re-parsing on repeated calls
const patternCache = new Map<string, Minimatch>();

function getPattern(glob: string): Minimatch {
  let mm = patternCache.get(glob);
  if (!mm) {
    mm = new Minimatch(glob, { matchBase: true, dot: true });
    patternCache.set(glob, mm);
  }
  return mm;
}

/** Normalize a file path to POSIX style for consistent cross-platform matching */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/** Returns true if filePath matches any of the given globs */
export function matchesAnyGlob(filePath: string, globs: string[]): boolean {
  const normalized = normalizePath(filePath);
  return globs.some((glob) => getPattern(glob).match(normalized));
}

/**
 * Returns files from the input list that match any glob key in pathConfig.
 */
export function filterFilesByConfig(
  files: string[],
  pathConfig: PathConfig
): string[] {
  const globs = Object.keys(pathConfig);
  if (globs.length === 0) return [];
  return files.filter((f) => matchesAnyGlob(f, globs));
}

/**
 * Returns the group names assigned to a file by checking all globs.
 * A file can match multiple globs; all associated groups are returned (deduplicated).
 */
export function getGroupsForFile(
  filePath: string,
  pathConfig: PathConfig
): string[] {
  const normalized = normalizePath(filePath);
  const groups = new Set<string>();
  for (const [glob, assignedGroups] of Object.entries(pathConfig)) {
    if (getPattern(glob).match(normalized)) {
      for (const g of assignedGroups) groups.add(g);
    }
  }
  return [...groups];
}
