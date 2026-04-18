// ─── meta.json structure ─────────────────────────────────────────────────────

export interface FileEntry {
  /** Relative path to the encrypted file, e.g. ".gitencrypt/<hash>.age" */
  encrypted: string;
  /** mtime of the plaintext file at time of encryption (Unix ms) */
  lastModified: number;
}

/** glob → group names */
export type PathConfig = Record<string, string[]>;

/** group name → age public keys ("age1...") */
export type RecipientsMap = Record<string, string[]>;

export interface MetaJson {
  version: 1;
  paths: PathConfig;
  recipients: RecipientsMap;
  /** plaintext relative path → FileEntry */
  files: Record<string, FileEntry>;
}

// ─── age operation results ────────────────────────────────────────────────────

export interface EncryptResult {
  sourcePath: string;
  encryptedPath: string;
  hash: string;
  bytesWritten: number;
}

export interface DecryptResult {
  encryptedPath: string;
  destPath: string;
  bytesWritten: number;
}

// ─── age identity resolution ──────────────────────────────────────────────────

export type IdentitySource =
  | 'git-config'     // from git config user.ageKeyPath
  | 'env'            // from AGE_IDENTITY env var
  | 'default-file'   // from ~/.age_identity (existing)
  | 'generated';     // freshly generated and saved

export interface IdentityResolution {
  identityPath: string;
  publicKey: string;
  source: IdentitySource;
}

// ─── hook context ─────────────────────────────────────────────────────────────

export interface HookContext {
  repoRoot: string;
  meta: MetaJson;
  identity: IdentityResolution;
  gitDir: string;
}

// ─── CLI context ──────────────────────────────────────────────────────────────

export interface CLIContext {
  repoRoot: string;
  meta: MetaJson;
  identity: IdentityResolution;
  verbose: boolean;
  dryRun: boolean;
}

// ─── pre-commit staging plan ──────────────────────────────────────────────────

export interface StagingPlan {
  /** Relative plaintext path (e.g. "secrets/api.key") */
  filePath: string;
  /** Relative encrypted path (e.g. ".gitencrypt/<hash>.age") */
  encryptedPath: string;
  hash: string;
  /** Collected age public keys from all matching groups */
  recipients: string[];
}

// ─── install options ──────────────────────────────────────────────────────────

export interface InstallOptions {
  force: boolean;
  windowsFallback: boolean;
}

// ─── errors ───────────────────────────────────────────────────────────────────

export class GitEncryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitEncryptError';
  }
}

export class DecryptionError extends GitEncryptError {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptionError';
  }
}

export class MetaValidationError extends GitEncryptError {
  constructor(message: string) {
    super(message);
    this.name = 'MetaValidationError';
  }
}

export class NoRecipientsError extends GitEncryptError {
  filePath: string;
  constructor(filePath: string) {
    super(`No recipients configured for file: ${filePath}`);
    this.name = 'NoRecipientsError';
    this.filePath = filePath;
  }
}
