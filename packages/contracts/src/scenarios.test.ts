import { describe, expect, it } from 'vitest';
import {
  compactScenarioListQuery,
  createScenarioSchema,
  foldForSearch,
  formatScenarioKey,
  formatTag,
  isValidTag,
  moduleInputSchema,
  normalizeTag,
  parseScenarioKey,
  parseScenarioListQueryLenient,
  requirementLinkInputSchema,
  scenarioListQuerySchema,
  scenarioListQueryString,
  tagSchema,
  updateScenarioSchema,
  commentInputSchema,
} from './scenarios';

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe('tags', () => {
  it.each([
    ['@Payments', 'payments'],
    ['  SMOKE ', 'smoke'],
    ['cart', 'cart'],
    ['v2.checkout_flow-1', 'v2.checkout_flow-1'],
    ['Pagos-Públicos', 'pagos-públicos'],
  ])('%s → %s', (raw, tag) => {
    expect(normalizeTag(raw)).toBe(tag);
    expect(tagSchema.parse(raw)).toBe(tag);
  });

  it.each(['smoke test', '-smoke', '.x', '@', '', 'a'.repeat(41), 'smoke!', '@@smoke'])(
    'rejects %j',
    (raw) => {
      expect(tagSchema.safeParse(raw).success).toBe(false);
    },
  );

  it('explains the allowed characters for an invalid tag', () => {
    expect(messages(tagSchema.safeParse('smoke test'))).toEqual(['tag.invalid']);
  });

  it('accepts exactly 40 characters and displays tags with @', () => {
    expect(isValidTag('a'.repeat(40))).toBe(true);
    expect(formatTag('smoke')).toBe('@smoke');
  });
});

describe('foldForSearch', () => {
  it('lowercases and strips diacritics', () => {
    expect(foldForSearch('Pagó con CUPÓN en Ñandú')).toBe('pago con cupon en nandu');
    expect(foldForSearch('Crème Brûlée')).toBe('creme brulee');
  });
});

describe('scenario keys', () => {
  it('formats keys', () => {
    expect(formatScenarioKey('CHK', 12)).toBe('CHK-TS-12');
  });

  it.each([
    ['CHK-TS-12', 12],
    ['chk-ts-12', 12],
    ['12', 12],
    [' 7 ', 7],
  ])('parses %s', (text, number) => {
    expect(parseScenarioKey(text, 'CHK')).toBe(number);
  });

  it.each(['CHK-TC-12', 'PAY-TS-12', 'CHK-TS-', 'CHK-TS-0', '0', 'twelve', '12a', '-12', ''])(
    'rejects %j for application CHK',
    (text) => {
      expect(parseScenarioKey(text, 'CHK')).toBeNull();
    },
  );

  it('accepts any valid application key when none is given', () => {
    expect(parseScenarioKey('PAY-TS-3')).toBe(3);
    expect(parseScenarioKey('P-TS-3')).toBeNull();
  });
});

describe('createScenarioSchema', () => {
  it('applies defaults', () => {
    expect(createScenarioSchema.parse({ title: '  Guest checkout  ' })).toEqual({
      title: 'Guest checkout',
      status: 'draft',
      priority: 'medium',
      moduleId: null,
      tags: [],
      versionFrom: null,
      versionTo: null,
      description: '',
      stepsToReach: '',
    });
  });

  it('requires a title of at most 200 characters', () => {
    expect(messages(createScenarioSchema.safeParse({ title: '   ' }))).toEqual(['title.required']);
    expect(messages(createScenarioSchema.safeParse({ title: 'x'.repeat(201) }))).toEqual([
      'title.tooLong',
    ]);
  });

  it('normalizes and de-duplicates tags, allowing at most 20', () => {
    expect(
      createScenarioSchema.parse({ title: 't', tags: ['@Smoke', 'smoke', 'SMOKE', 'cart'] }).tags,
    ).toEqual(['smoke', 'cart']);
    const tags = Array.from({ length: 21 }, (_, i) => `t${i}`);
    expect(messages(createScenarioSchema.safeParse({ title: 't', tags }))).toEqual([
      'tags.tooMany',
    ]);
  });

  it('validates the version range', () => {
    expect(
      createScenarioSchema.parse({ title: 't', versionFrom: '2.4', versionTo: '3.10' }),
    ).toMatchObject({ versionFrom: '2.4', versionTo: '3.10' });
    const inverted = createScenarioSchema.safeParse({
      title: 't',
      versionFrom: '3.2',
      versionTo: '3.1',
    });
    expect(inverted.error?.issues).toMatchObject([
      { path: ['versionTo'], message: 'version.inverted' },
    ]);
    expect(messages(createScenarioSchema.safeParse({ title: 't', versionTo: 'v3.x' }))).toEqual([
      'version.invalid',
    ]);
    expect(createScenarioSchema.parse({ title: 't', versionFrom: '' }).versionFrom).toBeNull();
  });

  it('limits rich text to 100,000 characters', () => {
    expect(
      createScenarioSchema.safeParse({ title: 't', description: 'x'.repeat(100_000) }).success,
    ).toBe(true);
    expect(
      messages(createScenarioSchema.safeParse({ title: 't', stepsToReach: 'x'.repeat(100_001) })),
    ).toEqual(['richText.tooLong']);
  });
});

describe('updateScenarioSchema', () => {
  it('requires the base revision and keeps only the fields sent', () => {
    expect(updateScenarioSchema.safeParse({ status: 'ready' }).success).toBe(false);
    expect(updateScenarioSchema.parse({ baseRevision: 3, status: 'ready' })).toEqual({
      baseRevision: 3,
      status: 'ready',
    });
  });
});

describe('other inputs', () => {
  it('module names are 1–60 characters', () => {
    expect(moduleInputSchema.parse({ name: ' Checkout ' })).toEqual({ name: 'Checkout' });
    expect(moduleInputSchema.safeParse({ name: '' }).success).toBe(false);
    expect(moduleInputSchema.safeParse({ name: 'x'.repeat(61) }).success).toBe(false);
  });

  it('comments are 1–10,000 characters', () => {
    expect(commentInputSchema.safeParse({ body: '  ' }).success).toBe(false);
    expect(commentInputSchema.safeParse({ body: 'x'.repeat(10_001) }).success).toBe(false);
  });

  it('requirement links need an http(s) URL and an optional label up to 200 characters', () => {
    expect(
      requirementLinkInputSchema.parse({ url: 'https://acme.atlassian.net/browse/SHOP-481' }),
    ).toEqual({ url: 'https://acme.atlassian.net/browse/SHOP-481', label: null });
    expect(messages(requirementLinkInputSchema.safeParse({ url: 'javascript:alert(1)' }))).toEqual([
      'url.httpOnly',
    ]);
    expect(requirementLinkInputSchema.safeParse({ url: 'ftp://x.test/a' }).success).toBe(false);
    expect(
      requirementLinkInputSchema.safeParse({ url: 'https://x.test', label: 'x'.repeat(201) })
        .success,
    ).toBe(false);
  });
});

describe('scenarioListQuerySchema', () => {
  it('applies defaults', () => {
    expect(scenarioListQuerySchema.parse({})).toEqual({
      deleted: false,
      sort: '-key',
      page: 1,
      size: 25,
    });
  });

  it('splits comma-separated multi-values and removes duplicates', () => {
    const query = scenarioListQuerySchema.parse({
      status: 'ready,draft,ready',
      priority: ['high', 'low'],
      module: 'none,0199a3c4-0000-7000-8000-000000000001',
      tag: '@Smoke,cart',
      page: '3',
      size: '50',
      deleted: 'true',
      sort: 'priority',
    });
    expect(query).toMatchObject({
      status: ['ready', 'draft'],
      priority: ['high', 'low'],
      module: ['none', '0199a3c4-0000-7000-8000-000000000001'],
      tag: ['smoke', 'cart'],
      page: 3,
      size: 50,
      deleted: true,
      sort: 'priority',
    });
  });

  it.each([
    { status: 'open' },
    { size: '30' },
    { page: '0' },
    { sort: 'secret_column' },
    { version: '3.x' },
    { author: 'not-a-uuid' },
    { q: 'x'.repeat(201) },
  ])('rejects %j', (query) => {
    expect(scenarioListQuerySchema.safeParse(query).success).toBe(false);
  });

  it('keeps numeric search text as text', () => {
    expect(scenarioListQuerySchema.parse({ q: 12 }).q).toBe('12');
  });

  it('lenient parsing drops only the invalid parameters', () => {
    expect(parseScenarioListQueryLenient({ status: 'open', tag: 'smoke', size: 7 })).toEqual({
      tag: ['smoke'],
      deleted: false,
      sort: '-key',
      page: 1,
      size: 25,
    });
  });
});

describe('compactScenarioListQuery', () => {
  it('omits defaults and orders multi-values so equivalent queries are identical', () => {
    const a = compactScenarioListQuery(
      scenarioListQuerySchema.parse({ status: 'ready,draft', page: 1, size: 25, sort: '-key' }),
    );
    const b = compactScenarioListQuery(
      scenarioListQuerySchema.parse({ status: ['draft', 'ready'] }),
    );
    expect(a).toEqual({ status: 'draft,ready' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('builds the API query string', () => {
    expect(
      scenarioListQueryString(
        scenarioListQuerySchema.parse({ tag: 'smoke', sort: 'priority', page: 2 }),
      ),
    ).toBe('page=2&sort=priority&tag=smoke');
  });
});
