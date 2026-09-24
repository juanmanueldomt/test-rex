import { pino, type DestinationStream, type Logger } from 'pino';
import { SECRET_KEYS } from './env';

export type { Logger };

export interface LoggerOptions {
  level?: string;
  name?: string;
  destination?: DestinationStream;
}

/**
 * Structured JSON logger. Secret config keys and common credential fields are redacted
 * even if they are accidentally logged.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const secretPaths = [...SECRET_KEYS].flatMap((key) => [key, `*.${key}`]);
  return pino(
    {
      name: options.name,
      level: options.level ?? 'info',
      redact: {
        paths: [
          ...secretPaths,
          'password',
          '*.password',
          'req.headers.authorization',
          'req.headers.cookie',
        ],
        censor: '[REDACTED]',
      },
    },
    options.destination,
  );
}
