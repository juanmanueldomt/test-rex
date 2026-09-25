import type { Logger } from '@testrex/config';
import type { StorageAdapter } from '@testrex/storage';
import type { CheckState } from '../server';

export interface StorageHealth {
  state: CheckState;
  /** Why the storage is failing (e.g. the directory is not writable, the bucket is missing). */
  error?: string;
}

/**
 * Readiness check for attachment storage. A successful probe is reused for `okTtlMs` so that
 * frequent readiness polls do not write an object each time; failures are re-checked on every
 * poll and logged when the reason changes.
 */
export function storageHealthCheck(
  storage: StorageAdapter,
  logger: Logger,
  okTtlMs = 30_000,
): () => Promise<StorageHealth> {
  let lastOk = 0;
  let lastError: string | undefined;
  let running: Promise<StorageHealth> | undefined;
  return () => {
    if (Date.now() - lastOk < okTtlMs) return Promise.resolve({ state: 'ok' });
    running ??= storage
      .check()
      .then(
        (): StorageHealth => {
          if (lastError) logger.info({ driver: storage.driver }, 'attachment storage recovered');
          lastOk = Date.now();
          lastError = undefined;
          return { state: 'ok' };
        },
        (error: unknown): StorageHealth => {
          const message = error instanceof Error ? error.message : String(error);
          if (message !== lastError) {
            logger.error({ driver: storage.driver, err: error }, `attachment storage: ${message}`);
          }
          lastError = message;
          return { state: 'failing', error: message };
        },
      )
      .finally(() => {
        running = undefined;
      });
    return running;
  };
}
