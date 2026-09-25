// @vitest-environment jsdom
import { expectAccessible } from '@testrex/ui/testing';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../lib/i18n';
import { diffRows, TextDiff } from './diff';

const BEFORE = '## Steps\n\n- open the cart\n- apply coupon SAVE10\n- pay';
const AFTER = '## Steps\n\n- open the cart\n- apply coupon SAVE20\n- pay\n- check the receipt';

describe('diffRows', () => {
  it('keeps unchanged lines and marks changed words inside replaced lines', () => {
    const rows = diffRows(BEFORE, AFTER);
    expect(rows.filter((r) => r.kind === 'same').map((r) => (r as { text: string }).text)).toEqual([
      '## Steps',
      '',
      '- open the cart',
    ]);
    const removed = rows.find((r) => r.kind === 'removed');
    expect(removed).toMatchObject({
      parts: expect.arrayContaining([{ text: 'SAVE10', changed: true }]),
    });
    const added = rows.filter((r) => r.kind === 'added');
    expect(JSON.stringify(added)).toContain('SAVE20');
    expect(JSON.stringify(added)).toContain('check the receipt');
  });

  it('returns only unchanged rows for identical text', () => {
    expect(diffRows('a\nb', 'a\nb').every((row) => row.kind === 'same')).toBe(true);
  });
});

describe('TextDiff', () => {
  it('marks additions and removals with +/− gutters and ins/del, independent of color', async () => {
    const { container } = render(<TextDiff before={BEFORE} after={AFTER} label="Description" />);
    const region = screen.getByRole('region', { name: 'Description' });
    const gutters = [...container.querySelectorAll('[data-diff] > span:first-child')].map(
      (element) => element.textContent,
    );
    expect(gutters).toContain('+');
    expect(gutters).toContain('−');
    expect(region.querySelector('del')?.textContent).toBe('SAVE10');
    expect([...region.querySelectorAll('ins')].map((e) => e.textContent)).toEqual(
      expect.arrayContaining(['SAVE20', '- check the receipt']),
    );
    // Screen readers hear "Added"/"Removed" rather than a color.
    expect(region.textContent).toContain('Added:');
    expect(region.textContent).toContain('Removed:');
    await expectAccessible();
  });
});
