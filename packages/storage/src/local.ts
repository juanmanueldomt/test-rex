import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  assertValidKey,
  PROBE_PREFIX,
  StorageNotFoundError,
  type PutOptions,
  type StorageAdapter,
} from './adapter';

/**
 * Directories are group-writable (setgid) so a second process sharing the volume under
 * another user but the same group (the worker purging uploads) can delete files.
 */
const DIR_MODE = 0o2775;

/** Stores objects as files under a directory (self-hosted default, a Docker volume). */
export class LocalStorage implements StorageAdapter {
  readonly driver = 'local' as const;
  readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  private pathOf(key: string): string {
    assertValidKey(key);
    const path = resolve(this.root, ...key.split('/'));
    if (!path.startsWith(this.root + sep)) throw new Error(`Invalid storage key: ${key}`);
    return path;
  }

  /** Creates missing directories below the root with {@link DIR_MODE} (umask-independent). */
  private async ensureDir(dir: string): Promise<void> {
    const created = await mkdir(dir, { recursive: true });
    if (!created) return;
    for (let current = dir; current.length >= created.length; current = dirname(current)) {
      await chmod(current, DIR_MODE).catch(() => {});
      if (current === created) break;
    }
  }

  async put(key: string, body: Readable, _options: PutOptions): Promise<void> {
    const path = this.pathOf(key);
    await this.ensureDir(dirname(path));
    // Write to a temporary name and rename, so readers never see a partial file.
    const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await pipeline(body, createWriteStream(temporary, { mode: 0o664 }));
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async get(key: string): Promise<Readable> {
    const path = this.pathOf(key);
    try {
      const info = await stat(path);
      if (!info.isFile()) throw new StorageNotFoundError(key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new StorageNotFoundError(key);
      throw error;
    }
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  async check(): Promise<void> {
    const probe = join(this.root, PROBE_PREFIX, randomBytes(8).toString('hex'));
    const content = `testrex-probe-${Date.now()}`;
    try {
      await this.ensureDir(dirname(probe));
      await writeFile(probe, content);
      if ((await readFile(probe, 'utf8')) !== content) throw new Error('probe read mismatch');
      await rm(probe, { force: true });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Storage directory ${this.root} is not writable: ${reason}`, {
        cause: error,
      });
    }
  }
}
