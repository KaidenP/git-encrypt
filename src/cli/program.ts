import { Command } from 'commander';
import { installCommand } from './commands/install.js';
import { recipientAdd, recipientRemove, recipientList } from './commands/recipient.js';
import { pathAdd, pathRemove, pathList } from './commands/path.js';
import { encryptCommand } from './commands/encrypt.js';
import { decryptCommand } from './commands/decrypt.js';
import { GitEncryptError } from '../types.js';

function handleError(err: unknown): never {
  if (err instanceof GitEncryptError) {
    console.error(`Error: ${err.message}`);
  } else {
    console.error('Unexpected error:', err);
  }
  process.exit(1);
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('git-encrypt')
    .description('Transparent Git encryption using age')
    .version('0.1.0');

  // ── install ────────────────────────────────────────────────────────────────
  program
    .command('install [dir]')
    .description('Initialize .gitencrypt/ and install git hooks')
    .option('-f, --force', 'Overwrite existing hooks', false)
    .option('--windows-fallback', 'Use wrapper scripts instead of symlinks', false)
    .action(async (dir: string | undefined, opts: { force: boolean; windowsFallback: boolean }) => {
      await installCommand(
        { force: opts.force, windowsFallback: opts.windowsFallback },
        dir
      ).catch(handleError);
    });

  // ── recipient ──────────────────────────────────────────────────────────────
  const recipient = program
    .command('recipient')
    .description('Manage age recipients');

  recipient
    .command('add <group> <pubkey>')
    .description('Add an age public key to a group')
    .action(async (group: string, pubkey: string) => {
      await recipientAdd(group, pubkey).catch(handleError);
    });

  recipient
    .command('remove <group> <pubkey>')
    .alias('rm')
    .description('Remove an age public key from a group')
    .action(async (group: string, pubkey: string) => {
      await recipientRemove(group, pubkey).catch(handleError);
    });

  recipient
    .command('list [group]')
    .alias('ls')
    .description('List recipients (optionally filtered by group)')
    .action(async (group: string | undefined) => {
      await recipientList(group).catch(handleError);
    });

  // ── path ───────────────────────────────────────────────────────────────────
  const pathCmd = program
    .command('path')
    .description('Manage glob-to-group path mappings');

  pathCmd
    .command('add <glob>')
    .description('Add a glob pattern mapped to one or more groups')
    .option('-g, --group <group...>', 'Group(s) to assign to this glob')
    .action(async (glob: string, opts: { group?: string[] }) => {
      await pathAdd(glob, opts.group ?? []).catch(handleError);
    });

  pathCmd
    .command('remove <glob>')
    .alias('rm')
    .description('Remove a glob mapping')
    .action(async (glob: string) => {
      await pathRemove(glob).catch(handleError);
    });

  pathCmd
    .command('list')
    .alias('ls')
    .description('List all path mappings')
    .action(async () => {
      await pathList().catch(handleError);
    });

  // ── encrypt ────────────────────────────────────────────────────────────────
  program
    .command('encrypt [files...]')
    .description('Manually encrypt files matching configured globs')
    .option('-v, --verbose', 'Show each file operation', false)
    .option('-n, --dry-run', 'Show what would be encrypted without doing it', false)
    .action(async (files: string[], opts: { verbose: boolean; dryRun: boolean }) => {
      await encryptCommand(files, { verbose: opts.verbose, dryRun: opts.dryRun }).catch(
        handleError
      );
    });

  // ── decrypt ────────────────────────────────────────────────────────────────
  program
    .command('decrypt [files...]')
    .description('Manually decrypt files tracked in meta.json')
    .option('-f, --force', 'Overwrite local changes', false)
    .option('-v, --verbose', 'Show each file operation', false)
    .action(async (files: string[], opts: { force: boolean; verbose: boolean }) => {
      await decryptCommand(files, { force: opts.force, verbose: opts.verbose }).catch(
        handleError
      );
    });

  // ── hook (explicit invocation for debugging) ───────────────────────────────
  program
    .command('hook <hookname>', { hidden: true })
    .description('Invoke a hook handler directly (for debugging)')
    .allowUnknownOption()
    .action(async (hookName: string) => {
      const { dispatchHook } = await import('../hooks/dispatcher.js');
      await dispatchHook(hookName, process.argv.slice(4)).catch(handleError);
    });

  return program;
}
