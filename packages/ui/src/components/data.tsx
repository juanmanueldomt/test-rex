import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { Button } from './button';
import { TableHead } from './table';

export type SortDirection = 'asc' | 'desc' | false;

export interface SortableHeadProps {
  children: ReactNode;
  direction: SortDirection;
  onSort: () => void;
  className?: string;
}

/**
 * A column header that sorts when activated. `aria-sort` tells assistive technology the
 * current direction.
 */
export function SortableHead({ children, direction, onSort, className }: SortableHeadProps) {
  const Icon = direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ChevronsUpDown;
  return (
    <TableHead
      className={cn('px-2', className)}
      aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
    >
      <button
        type="button"
        onClick={onSort}
        className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
        <Icon
          className={cn('size-3.5', direction ? 'text-foreground' : 'opacity-60')}
          aria-hidden
        />
      </button>
    </TableHead>
  );
}

/** Page numbers to show: first, last, and a window around the current page. */
export function pageItems(page: number, pageCount: number): (number | 'gap')[] {
  const pages = new Set([1, pageCount, page - 1, page, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const items: (number | 'gap')[] = [];
  for (const [index, p] of sorted.entries()) {
    const previous = sorted[index - 1];
    if (previous !== undefined && p - previous > 1) items.push('gap');
    items.push(p);
  }
  return items;
}

export interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Accessible name of the navigation landmark. */
  label: string;
  previousLabel: string;
  nextLabel: string;
  /** Accessible name of a page button, e.g. `Page 3`. */
  pageLabel: (page: number) => string;
  className?: string;
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  label,
  previousLabel,
  nextLabel,
  pageLabel,
  className,
}: PaginationProps) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label={label} className={cn('flex items-center gap-1', className)}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label={previousLabel}
      >
        <ChevronLeft />
      </Button>
      {pageItems(page, pageCount).map((item, index) =>
        item === 'gap' ? (
          <span key={`gap-${index}`} className="px-1 text-muted-foreground" aria-hidden>
            …
          </span>
        ) : (
          <Button
            key={item}
            variant={item === page ? 'outline' : 'ghost'}
            size="sm"
            className="min-w-8"
            aria-label={pageLabel(item)}
            aria-current={item === page ? 'page' : undefined}
            onClick={() => onPageChange(item)}
          >
            {item}
          </Button>
        ),
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pageCount}
        aria-label={nextLabel}
      >
        <ChevronRight />
      </Button>
    </nav>
  );
}
