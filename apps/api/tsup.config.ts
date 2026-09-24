import { defineConfig } from 'tsup';

// Bundle all dependencies so the container image only needs Node and dist/.
export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  noExternal: [/.*/],
  external: ['pg-native'],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  env: {
    APP_VERSION: process.env.APP_VERSION ?? '0.0.0-dev',
    GIT_COMMIT: process.env.GIT_COMMIT ?? 'unknown',
  },
});
