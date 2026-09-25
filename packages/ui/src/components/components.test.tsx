// @vitest-environment jsdom
import '../testing/dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectAccessible } from '../testing/dom';
import { Button } from './button';
import { Combobox, type ComboboxOption } from './combobox';
import { Pagination, pageItems, SortableHead, type SortDirection } from './data';
import { Popover, PopoverContent, PopoverTrigger, Tooltip, TooltipProvider } from './popovers';
import { Table, TableBody, TableCell, TableHeader, TableRow } from './table';

describe('Tooltip', () => {
  function Example() {
    return (
      <TooltipProvider delayDuration={0}>
        <p>
          Tags{' '}
          <Tooltip content="@payments, @regression">
            <button type="button">+2</button>
          </Tooltip>
        </p>
      </TooltipProvider>
    );
  }

  it('opens on keyboard focus, is announced, and closes with Escape', async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.tab();
    const trigger = screen.getByRole('button', { name: '+2' });
    expect(trigger).toHaveFocus();
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('@payments, @regression');
    await waitFor(() => expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id));
    await expectAccessible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('opens on hover', async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.hover(screen.getByRole('button', { name: '+2' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('@payments');
  });
});

describe('Popover', () => {
  it('opens with the keyboard and closes with Escape, returning focus', async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger asChild>
          <Button>Filters</Button>
        </PopoverTrigger>
        <PopoverContent aria-label="Filters">
          <label>
            Version <input />
          </label>
        </PopoverContent>
      </Popover>,
    );
    await user.tab();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Version');
    await expectAccessible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveFocus();
  });
});

describe('Combobox', () => {
  const OPTIONS: ComboboxOption[] = [
    { value: 'smoke', label: '@smoke' },
    { value: 'cart', label: '@cart' },
  ];

  function Example({ onCreate }: { onCreate?: (text: string) => void }) {
    const [value, setValue] = useState<string[]>([]);
    const [options, setOptions] = useState(OPTIONS);
    return (
      <>
        <Combobox
          label="Tags"
          multiple
          options={options}
          value={value}
          onChange={setValue}
          placeholder="Add tags"
          searchPlaceholder="Search tags"
          onCreate={(text) => {
            onCreate?.(text);
            setOptions((current) => [...current, { value: text, label: `@${text}` }]);
            setValue((current) => [...current, text]);
          }}
          createLabel={(text) => `Create @${text}`}
        />
        <output>{value.join(',')}</output>
      </>
    );
  }

  it('opens with the keyboard, selects with Enter and closes with Escape', async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Tags' })).toHaveFocus();
    await user.keyboard('{Enter}');
    const search = await screen.findByRole('combobox', { name: 'Tags' });
    await waitFor(() => expect(search).toHaveFocus());
    await expectAccessible();
    await user.keyboard('ca');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('cart');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Tags' })).toHaveTextContent('@cart');
  });

  it('offers to create a value that does not exist', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<Example onCreate={onCreate} />);
    await user.click(screen.getByRole('button', { name: 'Tags' }));
    await user.keyboard('payments');
    const create = await screen.findByRole('option', { name: 'Create @payments' });
    await user.click(create);
    expect(onCreate).toHaveBeenCalledWith('payments');
    expect(screen.getByRole('status')).toHaveTextContent('payments');
  });
});

describe('Pagination', () => {
  it('lists nearby pages with gaps and marks the current page', async () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(1, 3)).toEqual([1, 2, 3]);
    expect(pageItems(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10]);
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Pagination
        page={2}
        pageCount={3}
        onPageChange={onPageChange}
        label="Pages"
        previousLabel="Previous page"
        nextLabel="Next page"
        pageLabel={(page) => `Page ${page}`}
      />,
    );
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    await expectAccessible();
  });

  it('renders nothing for a single page', () => {
    const { container } = render(
      <Pagination
        page={1}
        pageCount={1}
        onPageChange={() => {}}
        label="Pages"
        previousLabel="Previous"
        nextLabel="Next"
        pageLabel={String}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('SortableHead', () => {
  function Example() {
    const [direction, setDirection] = useState<SortDirection>(false);
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead
              direction={direction}
              onSort={() => setDirection((d) => (d === 'desc' ? 'asc' : 'desc'))}
            >
              Updated
            </SortableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>today</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
  }

  it('announces the sort direction through aria-sort', async () => {
    const user = userEvent.setup();
    render(<Example />);
    const header = screen.getByRole('columnheader', { name: 'Updated' });
    expect(header).toHaveAttribute('aria-sort', 'none');
    await user.click(screen.getByRole('button', { name: 'Updated' }));
    expect(header).toHaveAttribute('aria-sort', 'descending');
    await user.keyboard('{Enter}');
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    await expectAccessible();
  });
});
