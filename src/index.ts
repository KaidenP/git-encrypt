import path from 'node:path';

const KNOWN_HOOKS = ['pre-commit', 'post-checkout', 'post-merge', 'pre-push'] as const;
type HookName = typeof KNOWN_HOOKS[number];

function isHookName(name: string): name is HookName {
  return (KNOWN_HOOKS as readonly string[]).includes(name);
}

async function main(): Promise<void> {
  // Detect invocation mode:
  // 1. Invoked via symlink named like "pre-commit" (when installed as a git hook)
  // 2. Invoked as: git-encrypt hook <hookname>  (explicit, for debugging)
  // 3. Normal CLI

  const invokedName = path.basename(process.argv[1] ?? '');

  if (isHookName(invokedName)) {
    const { dispatchHook } = await import('./hooks/dispatcher.js');
    await dispatchHook(invokedName, process.argv.slice(2));
    return;
  }

  if (process.argv[2] === 'hook' && isHookName(process.argv[3] ?? '')) {
    const { dispatchHook } = await import('./hooks/dispatcher.js');
    await dispatchHook(process.argv[3] as HookName, process.argv.slice(4));
    return;
  }

  // Normal CLI mode
  const { buildProgram } = await import('./cli/program.js');
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
