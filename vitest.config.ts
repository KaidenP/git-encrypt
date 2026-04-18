import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Force vitest to use the CJS entry for libsodium (ESM entry is incomplete —
      // dist/modules-sumo-esm/libsodium-sumo.mjs is missing from the npm package)
      'libsodium-wrappers-sumo': path.resolve(
        __dirname,
        'tests/__shims__/libsodium-shim.cjs'
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    server: {
      deps: {
        // Force vite to bundle these so our alias is applied instead of
        // Node's native ESM resolution (which picks the broken ESM entry)
        inline: ['age-encryption', 'libsodium-wrappers-sumo'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
    testTimeout: 30000,
  },
});
