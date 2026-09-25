import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachmentStorageKey, StorageNotFoundError } from './adapter';
import { LocalStorage } from './local';

let dir: string;
let storage: LocalStorage;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'testrex-storage-'));
  storage = new LocalStorage(join(dir, 'root'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function text(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}

const KEY = attachmentStorageKey(
  '0199a3c4-0000-7000-8000-00000000000a',
  '0199a3c4-0000-7000-8000-00000000000b',
);

describe('LocalStorage', () => {
  it('puts, gets and deletes objects', async () => {
    await storage.put(KEY, Readable.from(['hello ', 'world']), { contentType: 'text/plain' });
    expect(await text(await storage.get(KEY))).toBe('hello world');
    await storage.put(KEY, Readable.from(['replaced']), { contentType: 'text/plain' });
    expect(await text(await storage.get(KEY))).toBe('replaced');
    await storage.delete(KEY);
    await expect(storage.get(KEY)).rejects.toBeInstanceOf(StorageNotFoundError);
    // Deleting a missing object is not an error.
    await expect(storage.delete(KEY)).resolves.toBeUndefined();
  });

  it('leaves no temporary file behind when the source stream fails', async () => {
    const failing = new Readable({
      read() {
        this.push('partial');
        this.destroy(new Error('client went away'));
      },
    });
    await expect(storage.put(KEY, failing, { contentType: 'text/plain' })).rejects.toThrow(
      'client went away',
    );
    await expect(storage.get(KEY)).rejects.toBeInstanceOf(StorageNotFoundError);
    const attachmentsDir = join(
      storage.root,
      'org',
      '0199a3c4-0000-7000-8000-00000000000a',
      'attachments',
    );
    expect(readdirSync(attachmentsDir)).toEqual([]);
  });

  it.each(['../escape', 'org/../../escape', '/absolute', 'a\\b', '', 'a//b', './a'])(
    'rejects the unsafe key %j',
    async (key) => {
      await expect(storage.get(key)).rejects.toThrow(/Invalid storage key/);
      await expect(
        storage.put(key, Readable.from(['x']), { contentType: 'text/plain' }),
      ).rejects.toThrow(/Invalid storage key/);
    },
  );

  it('check() succeeds on a writable directory and leaves no probe behind', async () => {
    await expect(storage.check()).resolves.toBeUndefined();
    expect(readdirSync(join(storage.root, 'probe'))).toEqual([]);
  });

  it('check() names the directory when it is not writable', async () => {
    const file = join(dir, 'not-a-directory');
    writeFileSync(file, 'x');
    const broken = new LocalStorage(file);
    await expect(broken.check()).rejects.toThrow(
      /Storage directory .*not-a-directory is not writable/,
    );
  });
});
