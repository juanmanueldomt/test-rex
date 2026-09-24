import {
  apiEnvSchema,
  ConfigError,
  createLogger,
  loadConfig,
  type ApiConfig,
} from '@testrex/config';
import { migrate, MigrationError, resolveMigrationsDir } from '@testrex/db';
import { startApi } from './start';

const USAGE = `Usage: testrex <command>

Commands:
  serve     Start the API and web server (default)
  migrate   Apply pending database migrations and exit
`;

function readConfig(): ApiConfig {
  try {
    return loadConfig(apiEnvSchema);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

async function serve(): Promise<void> {
  const config = readConfig();
  const logger = createLogger({ level: config.LOG_LEVEL, name: 'api' });
  const api = await startApi({ config, logger });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await api.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

async function runMigrations(): Promise<void> {
  const config = readConfig();
  const logger = createLogger({ level: config.LOG_LEVEL, name: 'migrate' });
  try {
    const { applied } = await migrate({
      connectionString: config.DATABASE_MIGRATION_URL ?? config.DATABASE_URL,
      migrationsDir: resolveMigrationsDir(import.meta.dirname),
      onApplied: (tag) => logger.info({ migration: tag }, 'applied migration'),
    });
    logger.info({ count: applied.length }, 'database schema is up to date');
  } catch (error) {
    const migration = error instanceof MigrationError ? error.migration : 'unknown';
    logger.error({ err: error, migration }, `database migration failed: ${migration}`);
    process.exitCode = 1;
  }
}

const command = process.argv[2] ?? 'serve';
switch (command) {
  case 'serve':
    await serve();
    break;
  case 'migrate':
    await runMigrations();
    break;
  case '--help':
  case '-h':
  case 'help':
    process.stdout.write(USAGE);
    break;
  default:
    process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
    process.exit(1);
}
