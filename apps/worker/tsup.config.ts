import { defineConfig } from 'tsup';

// Bundle all dependencies (except Playwright) so the image only needs Node, dist/ and Playwright.
export default defineConfig({
  entry: { main: 'src/main.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  // Playwright ships browser-specific assets and is installed next to the bundle in the image.
  noExternal: [/^(?!playwright-core(\/|$))/],
  external: ['pg-native', 'playwright-core'],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  env: {
    APP_VERSION: process.env.APP_VERSION ?? '0.0.0-dev',
    GIT_COMMIT: process.env.GIT_COMMIT ?? 'unknown',
  },
});
