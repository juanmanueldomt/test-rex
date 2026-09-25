// @vitest-environment jsdom
import { scenarioListQuerySchema } from '@testrex/contracts';
import { describe, expect, it } from 'vitest';
import { keys, scenarioListQuery } from './queries';

const parse = (raw: Record<string, unknown>) => scenarioListQuerySchema.parse(raw);

describe('scenario list query keys', () => {
  it('are identical for equivalent search params', () => {
    const a = keys.scenarioList('acme', 'CHK', parse({ status: 'ready,draft', tag: '@Smoke' }));
    const b = keys.scenarioList(
      'acme',
      'CHK',
      parse({ tag: ['smoke'], status: ['draft', 'ready'], page: '1', size: 25, sort: '-key' }),
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(scenarioListQuery('acme', 'CHK', parse({})).queryKey).toEqual(
      keys.scenarioList('acme', 'CHK', {}),
    );
  });

  it('differ when the view differs, and nest under the application', () => {
    const page1 = keys.scenarioList('acme', 'CHK', parse({}));
    const page2 = keys.scenarioList('acme', 'CHK', parse({ page: 2 }));
    expect(page1).not.toEqual(page2);
    expect(page2.slice(0, 5)).toEqual([...keys.scenarios('acme', 'CHK')]);
  });

  it('scenario keys are case-insensitive', () => {
    expect(keys.scenario('acme', 'CHK', 'chk-ts-12')).toEqual(
      keys.scenario('acme', 'CHK', 'CHK-TS-12'),
    );
  });
});
