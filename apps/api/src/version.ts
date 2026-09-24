import type { VersionResponse } from '@testrex/contracts';

// Replaced at build time by tsup (see tsup.config.ts); read at runtime in development.
export const appVersion: VersionResponse = {
  version: process.env.APP_VERSION ?? '0.0.0-dev',
  commit: process.env.GIT_COMMIT ?? 'unknown',
};
