import { describe, expect, it } from 'vitest';
import { appKeySchema, orgSlugSchema, slugify, suggestAppKey, withSuffix } from './identifiers';

describe('slugify', () => {
  it.each([
    ['Acme QA', 'acme-qa'],
    ['  Beta   Labs!! ', 'beta-labs'],
    ['Pruebas Técnicas Ñandú', 'pruebas-tecnicas-nandu'],
    ['QA', 'qa-org'],
    ['!!!', 'org'],
  ])('%s → %s', (name, slug) => {
    expect(slugify(name)).toBe(slug);
    expect(orgSlugSchema.safeParse(slugify(name)).success).toBe(true);
  });

  it('keeps slugs within 40 characters without trailing hyphens', () => {
    const slug = slugify('a very long organization name that goes on and on and on');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('orgSlugSchema', () => {
  it.each(['ab', 'Acme', 'acme_qa', '-acme', 'acme-', 'a'.repeat(41)])('rejects %s', (slug) => {
    expect(orgSlugSchema.safeParse(slug).success).toBe(false);
  });
});

describe('suggestAppKey', () => {
  it.each([
    ['Checkout Web', 'CW'],
    ['Checkout', 'CHE'],
    ['Mobile API Gateway Admin Portal', 'MAGA'],
    // Words that are only digits are dropped so the key starts with a letter.
    ['2024 Release', 'REL'],
    ['X', 'XAP'],
  ])('%s → %s', (name, expected) => {
    const key = suggestAppKey(name);
    expect(key).toBe(expected);
    expect(appKeySchema.safeParse(key).success).toBe(true);
  });
});

describe('appKeySchema', () => {
  it.each(['C', 'chk', '1CHK', 'CHK-1', 'ABCDEFGHIJK'])('rejects %s', (key) => {
    expect(appKeySchema.safeParse(key).success).toBe(false);
  });
  it.each(['CW', 'CHK', 'A1', 'ABCDEFGHIJ'])('accepts %s', (key) => {
    expect(appKeySchema.safeParse(key).success).toBe(true);
  });
});

describe('withSuffix', () => {
  it('appends a number within the length limit', () => {
    expect(withSuffix('acme-qa', 2, 40, '-')).toBe('acme-qa-2');
    expect(withSuffix('ABCDEFGHIJ', 2, 10)).toBe('ABCDEFGHI2');
  });
});
