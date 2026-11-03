import type { TestrexAuth } from '@testrex/auth';
import type { ApiConfig, Logger } from '@testrex/config';
import type { Database } from '@testrex/db';
import type { StorageAdapter } from '@testrex/storage';
import type { JobQueue } from './jobs';
import type { ProviderFactory } from './llm/providers';
import type { Mailer } from './mailer';
import type { QuotaService } from './quota';

/** Everything route handlers need; built once at startup (see start.ts). */
export interface ApiServices {
  config: ApiConfig;
  logger: Logger;
  db: Database;
  auth: TestrexAuth;
  mailer: Mailer;
  quota: QuotaService;
  /** Attachment files (local directory or S3-compatible bucket). */
  storage: StorageAdapter;
  /** Sends runs and recordings to the worker. */
  jobs: JobQueue;
  /** Builds the organization's LLM provider client. */
  llm: ProviderFactory;
  now: () => Date;
}
