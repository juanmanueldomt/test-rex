import {
  ConfigError,
  createLogger,
  loadConfig,
  workerEnvSchema,
  type WorkerConfig,
} from '@testrex/config';
import { startWorker } from './worker';

function readConfig(): WorkerConfig {
  try {
    return loadConfig(workerEnvSchema);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

const config = readConfig();
const logger = createLogger({ level: config.LOG_LEVEL, name: 'worker' });
const worker = await startWorker({ config, logger });

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutting down');
  await worker.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
