#!/usr/bin/env node
import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '../dist');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Plugin to fix libsodium-wrappers-sumo's relative import issue and convert requires to imports
const libsodiumPlugin = {
  name: 'libsodium-fix',
  setup(build) {
    build.onResolve(
      { filter: /^\.\/libsodium-sumo\.mjs$/ },
      (args) => {
        if (args.importer.includes('libsodium-wrappers-sumo')) {
          return {
            path: path.resolve('./node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs')
          };
        }
      }
    );
  }
};

// Build the bundle - use CJS format and externalize problematic packages
(async () => {
  await esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    outfile: path.join(distDir, 'git-encrypt.cjs'),
    format: 'cjs',
    plugins: [libsodiumPlugin],
    // Externalize packages with native bindings or top-level await
    external: ['fsevents', 'libsodium-wrappers-sumo', 'libsodium-sumo'],
    loader: {
      '.node': 'copy'
    },
    sourcemap: false,
    banner: {
      js: '#!/usr/bin/env node\n'
    }
  });

  // Create a shell wrapper as the main executable
  const mainExe = path.join(distDir, 'git-encrypt');
  const shellWrapper = `#!/bin/sh
exec node "$(dirname "$0")/git-encrypt.cjs" "$@"
`;
  fs.writeFileSync(mainExe, shellWrapper);
  fs.chmodSync(mainExe, 0o755);

  console.log(`✅ Standalone executable created: ${mainExe}`);
})();
