// Organization slugs and application keys: validation and suggestions shared by API and web.
import { z } from 'zod';

export const ORG_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const APP_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;
export const ORG_SLUG_MAX = 40;
export const APP_KEY_MAX = 10;

export const orgSlugSchema = z
  .string()
  .min(3, 'slug.tooShort')
  .max(ORG_SLUG_MAX, 'slug.tooLong')
  .regex(ORG_SLUG_PATTERN, 'slug.invalid');

export const appKeySchema = z.string().regex(APP_KEY_PATTERN, 'key.invalid');

function asciiFold(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

/** "Acme QA" → "acme-qa". Pads very short names so the result is a valid slug. */
export function slugify(name: string): string {
  const base = asciiFold(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, ORG_SLUG_MAX)
    .replace(/-+$/g, '');
  if (base.length >= 3) return base;
  return base ? `${base}-org` : 'org';
}

/** "Checkout Web" → "CW"; "Checkout" → "CHE". */
export function suggestAppKey(name: string): string {
  const words = asciiFold(name)
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .map((word) => word.replace(/^[0-9]+/, ''))
    .filter(Boolean);
  let key =
    words.length >= 2
      ? words
          .slice(0, 4)
          .map((word) => word[0])
          .join('')
      : (words[0] ?? '').slice(0, 3);
  if (key.length < 2) key = `${key}APP`.slice(0, 3);
  return key.slice(0, APP_KEY_MAX);
}

/** Appends a number (respecting the length limit) to derive an alternative candidate. */
export function withSuffix(
  candidate: string,
  n: number,
  maxLength: number,
  separator = '',
): string {
  const suffix = `${separator}${n}`;
  return candidate.slice(0, maxLength - suffix.length).replace(/-+$/g, '') + suffix;
}
