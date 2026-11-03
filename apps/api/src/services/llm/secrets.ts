// API keys of LLM providers are encrypted at rest with AES-256-GCM. The key is derived from
// APP_SECRET with HKDF, so rotating APP_SECRET makes stored keys unreadable (they must be saved
// again) and nothing else needs to be configured.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';

function keyFrom(appSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', appSecret, 'testrex', 'llm-api-key', 32));
}

export function encryptSecret(appSecret: string, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(appSecret), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), encrypted]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64')))
    .join(':');
}

/** Throws when the value was not produced with this APP_SECRET (or was tampered with). */
export function decryptSecret(appSecret: string, stored: string): string {
  const [version, iv, tag, encrypted] = stored.split(':');
  if (version !== VERSION || !iv || !tag || encrypted === undefined) {
    throw new Error('Unsupported secret format');
  }
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(appSecret), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
