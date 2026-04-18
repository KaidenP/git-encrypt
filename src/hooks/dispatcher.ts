export async function dispatchHook(
  hookName: string,
  args: string[]
): Promise<void> {
  switch (hookName) {
    case 'pre-commit': {
      const { runPreCommit } = await import('./pre-commit.js');
      await runPreCommit();
      break;
    }
    case 'post-checkout': {
      const { runPostCheckout } = await import('./post-checkout.js');
      // args: <prev-HEAD> <new-HEAD> <branch-flag>
      await runPostCheckout(args[0] ?? '', args[1] ?? '', args[2] ?? '1');
      break;
    }
    case 'post-merge': {
      const { runPostMerge } = await import('./post-merge.js');
      // args: <squash-flag>
      await runPostMerge(args[0] ?? '0');
      break;
    }
    case 'pre-push': {
      const { runPrePush } = await import('./pre-push.js');
      // args: <remote-name> <remote-url>
      await runPrePush(args[0] ?? '', args[1] ?? '');
      break;
    }
    default:
      // Unknown hook — exit cleanly (don't block git)
      process.stderr.write(`git-encrypt: unknown hook "${hookName}", skipping\n`);
  }
}
