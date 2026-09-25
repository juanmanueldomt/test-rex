// @vitest-environment jsdom
import { expectAccessible } from '@testrex/ui/testing';
import { TooltipProvider } from '@testrex/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '../lib/i18n';
import { hiddenTags, TagCell } from './scenario-ui';

function renderTags(tags: string[], onSelect = vi.fn()) {
  render(
    <TooltipProvider delayDuration={0}>
      <TagCell tags={tags} onSelect={onSelect} />
    </TooltipProvider>,
  );
  return onSelect;
}

describe('TagCell', () => {
  it('shows two tags and +3; focusing +3 lists the three hidden tags', async () => {
    const user = userEvent.setup();
    renderTags(['cart', 'mobile', 'payments', 'regression', 'smoke']);
    expect(screen.getByRole('button', { name: '@cart' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '@mobile' })).toBeInTheDocument();
    expect(screen.queryByText('@payments')).toBeNull();
    const more = screen.getByRole('button', { name: '3 more tags' });
    expect(more).toHaveTextContent('+3');

    await user.tab();
    await user.tab();
    await user.tab();
    expect(more).toHaveFocus();
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('@payments, @regression, @smoke');
    expect(tooltip).not.toHaveTextContent('more');
    await waitFor(() => expect(more.getAttribute('aria-describedby')).toBe(tooltip.id));
    await expectAccessible();
  });

  it('with 9 tags lists five hidden tags and "and 2 more"', async () => {
    const user = userEvent.setup();
    const tags = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8', 'i9'];
    expect(hiddenTags(tags)).toEqual({ listed: ['c3', 'd4', 'e5', 'f6', 'g7'], more: 2 });
    renderTags(tags);
    await user.hover(screen.getByRole('button', { name: '7 more tags' }));
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('@c3, @d4, @e5, @f6, @g7 and 2 more');
  });

  it('selecting a tag chip reports the tag (to filter the grid)', async () => {
    const user = userEvent.setup();
    const onSelect = renderTags(['smoke']);
    await user.click(screen.getByRole('button', { name: '@smoke' }));
    expect(onSelect).toHaveBeenCalledWith('smoke');
    expect(screen.queryByRole('button', { name: /more tags/ })).toBeNull();
  });
});
