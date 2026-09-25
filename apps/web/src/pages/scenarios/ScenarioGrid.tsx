import {
  compactScenarioListQuery,
  formatTag,
  MODULE_NONE,
  parseScenarioListQueryLenient,
  productVersionSchema,
  SCENARIO_PAGE_SIZES,
  SCENARIO_PRIORITIES,
  SCENARIO_STATUSES,
  type ScenarioListItem,
  type ScenarioListQuery,
  type ScenarioSort,
  type ScenarioSortField,
} from '@testrex/contracts';
import {
  Alert,
  Badge,
  Button,
  Combobox,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  NativeSelect,
  Pagination,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  SortableHead,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@testrex/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { ChevronDown, FlaskConical, Plus, Search, SearchX, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PriorityLabel,
  RelativeTime,
  StatusBadge,
  TagCell,
  userName,
} from '../../components/scenario-ui';
import { errorMessage } from '../../lib/api';
import {
  modulesQuery,
  scenarioAuthorsQuery,
  scenarioListQuery,
  tagsQuery,
} from '../../lib/queries';
import { useShortcut } from '../../lib/shortcuts';
import { useScenarioAccess } from './common';

/** The grid's view state as it appears in the URL (defaults omitted). */
export type ScenarioSearch = Partial<Record<string, string | number | boolean>>;

export function validateScenarioSearch(raw: Record<string, unknown>): ScenarioSearch {
  return compactScenarioListQuery(parseScenarioListQueryLenient(raw));
}

/** First activation sorts these newest/highest first. */
const DESCENDING_FIRST: ScenarioSortField[] = ['key', 'updated'];

function sortState(sort: ScenarioSort): { field: ScenarioSortField; desc: boolean } {
  return { field: sort.replace(/^-/, '') as ScenarioSortField, desc: sort.startsWith('-') };
}

function nextSort(current: ScenarioSort, field: ScenarioSortField): ScenarioSort {
  const { field: active, desc } = sortState(current);
  if (active === field) return (desc ? field : `-${field}`) as ScenarioSort;
  return (DESCENDING_FIRST.includes(field) ? `-${field}` : field) as ScenarioSort;
}

const FILTER_FIELDS = ['status', 'priority', 'module', 'author', 'tag'] as const;
type FilterField = (typeof FILTER_FIELDS)[number];

function hasFilters(query: ScenarioListQuery): boolean {
  return (
    Boolean(query.q || query.version || query.deleted) ||
    FILTER_FIELDS.some((field) => (query[field]?.length ?? 0) > 0)
  );
}

function FilterMenu({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn(selected.length && 'border-primary/60')}>
          {label}
          {selected.length ? (
            <Badge variant="default" className="px-1.5 py-0">
              {selected.length}
            </Badge>
          ) : null}
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selected.includes(option.value)}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? [...selected, option.value]
                  : selected.filter((value) => value !== option.value),
              )
            }
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function VersionFilter({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ?? '');
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    if (!text.trim()) {
      onChange(undefined);
      setOpen(false);
      return;
    }
    const parsed = productVersionSchema.safeParse(text);
    if (!parsed.success) return setError(t('validation.version.invalid'));
    onChange(parsed.data);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setText(value ?? '');
          setError(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn(value && 'border-primary/60')}>
          {t('scenarios.filters.version')}
          {value ? <Badge className="px-1.5 py-0 font-mono">{value}</Badge> : null}
          <ChevronDown aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label={t('scenarios.filters.versionLabel')}>
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <label htmlFor="version-filter" className="text-sm font-medium">
            {t('scenarios.filters.versionLabel')}
          </label>
          <Input
            id="version-filter"
            value={text}
            placeholder="3.2"
            onChange={(event) => setText(event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby="version-filter-hint"
          />
          <p
            id="version-filter-hint"
            className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}
            role={error ? 'alert' : undefined}
          >
            {error ?? t('scenarios.filters.versionHint')}
          </p>
          <Button type="submit" size="sm">
            {t('scenarios.filters.apply')}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-card py-0.5 pl-2.5 pr-1 text-xs">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('scenarios.filters.remove', { filter: label })}
        className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}

export function ScenarioGridPage({
  orgSlug,
  appKey,
  search,
}: {
  orgSlug: string;
  appKey: string;
  search: ScenarioSearch;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canWrite } = useScenarioAccess(orgSlug, appKey);
  const query = useMemo(() => parseScenarioListQueryLenient(search), [search]);
  const list = useQuery(scenarioListQuery(orgSlug, appKey, query));
  const modules = useQuery(modulesQuery(orgSlug, appKey)).data ?? [];
  const authors = useQuery(scenarioAuthorsQuery(orgSlug, appKey)).data ?? [];
  const [tagSearch, setTagSearch] = useState('');
  const tagOptions = useQuery(tagsQuery(orgSlug, appKey, tagSearch.replace(/^@/, ''))).data ?? [];

  /** Changes the view; anything but paging returns to page 1. Each change is a history entry. */
  const setView = (patch: Partial<ScenarioListQuery>, options: { replace?: boolean } = {}) => {
    const next = { ...query, ...patch };
    if (!('page' in patch)) next.page = 1;
    void navigate({
      to: '/o/$orgSlug/a/$appKey/scenarios',
      params: { orgSlug, appKey },
      search: compactScenarioListQuery(next),
      replace: options.replace,
    });
  };

  // A page beyond the end: the server answers with the last page; reflect it in the URL.
  // Placeholder data belongs to the previous view, so it must not drive this.
  const servedPage = list.isPlaceholderData ? undefined : list.data?.page;
  useEffect(() => {
    if (servedPage !== undefined && servedPage !== query.page) {
      setView({ page: servedPage }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servedPage, query.page]);

  // Search box: typed text is applied after a short pause, and follows back/forward.
  const [text, setText] = useState(query.q ?? '');
  const [lastQ, setLastQ] = useState(query.q);
  if (lastQ !== query.q) {
    setLastQ(query.q);
    setText(query.q ?? '');
  }
  useEffect(() => {
    if (text.trim() === (query.q ?? '')) return;
    const timer = setTimeout(() => setView({ q: text.trim() || undefined }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  const searchInput = useRef<HTMLInputElement>(null);

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const { field: sortField, desc: sortDesc } = sortState(query.sort);
  const toggleTag = (tag: string) => {
    const tags = query.tag ?? [];
    if (!tags.includes(tag)) setView({ tag: [...tags, tag] });
  };

  const columns = useMemo<ColumnDef<ScenarioListItem>[]>(
    () => [
      {
        id: 'key',
        header: t('scenarios.columns.key'),
        cell: ({ row }) => (
          <Link
            to="/o/$orgSlug/a/$appKey/scenarios/$scenarioKey"
            params={{ orgSlug, appKey, scenarioKey: row.original.key }}
            className="whitespace-nowrap font-mono text-xs font-medium hover:underline"
            onClick={(event) => event.stopPropagation()}
            tabIndex={-1}
          >
            {row.original.key}
          </Link>
        ),
      },
      {
        id: 'title',
        header: t('scenarios.columns.title'),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <span className="line-clamp-2 font-medium">{row.original.title}</span>
            {row.original.deletedAt ? (
              <Badge variant="warning">{t('scenarios.deleted')}</Badge>
            ) : null}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('scenarios.columns.status'),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'module',
        header: t('scenarios.columns.module'),
        cell: ({ row }) =>
          row.original.module?.name ?? <span className="text-muted-foreground">—</span>,
      },
      {
        id: 'priority',
        header: t('scenarios.columns.priority'),
        cell: ({ row }) => <PriorityLabel priority={row.original.priority} />,
      },
      {
        id: 'tags',
        header: t('scenarios.columns.tags'),
        enableSorting: false,
        cell: ({ row }) => <TagCell tags={row.original.tags} onSelect={toggleTag} />,
      },
      {
        id: 'testCases',
        header: t('scenarios.columns.testCases'),
        enableSorting: false,
        cell: ({ row }) => <span className="tabular-nums">{row.original.testCaseCount}</span>,
      },
      {
        id: 'author',
        header: t('scenarios.columns.author'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{userName(row.original.author)}</span>
        ),
      },
      {
        id: 'updated',
        header: t('scenarios.columns.updated'),
        cell: ({ row }) => (
          <RelativeTime value={row.original.updatedAt} by={row.original.updatedBy} />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, orgSlug, appKey, query.tag],
  );

  // TanStack Table's API is not memoizable by the React Compiler; this component opts out.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    manualSorting: true,
    manualPagination: true,
    state: { sorting: [{ id: sortField, desc: sortDesc }] },
  });

  // Keyboard selection: j/k move a roving selection, Enter opens the selected scenario.
  const [selected, setSelected] = useState(-1);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const [lastItems, setLastItems] = useState(items);
  if (lastItems !== items) {
    setLastItems(items);
    setSelected(-1);
  }
  const openScenario = (key: string) =>
    void navigate({
      to: '/o/$orgSlug/a/$appKey/scenarios/$scenarioKey',
      params: { orgSlug, appKey, scenarioKey: key },
    });
  const select = (index: number) => {
    if (items.length === 0) return;
    const next = Math.max(0, Math.min(items.length - 1, index));
    setSelected(next);
    rowRefs.current[next]?.focus();
  };

  useShortcut({
    keys: 'c',
    description: t('shortcuts.newScenario'),
    group: 'scenarios',
    enabled: canWrite,
    handler: () =>
      void navigate({ to: '/o/$orgSlug/a/$appKey/scenarios/new', params: { orgSlug, appKey } }),
  });
  useShortcut({
    keys: '/',
    description: t('shortcuts.focusSearch'),
    group: 'scenarios',
    handler: () => searchInput.current?.focus(),
  });
  useShortcut({
    keys: 'j',
    description: t('shortcuts.nextRow'),
    group: 'scenarios',
    handler: () => select(selected + 1),
  });
  useShortcut({
    keys: 'k',
    description: t('shortcuts.previousRow'),
    group: 'scenarios',
    handler: () => select(selected < 0 ? 0 : selected - 1),
  });
  useShortcut({
    keys: 'Enter',
    description: t('shortcuts.openRow'),
    group: 'scenarios',
    handler: (event) => {
      const row = items[selected];
      // Only when the selected row (or nothing in particular) has focus.
      const target = event.target as HTMLElement;
      if (!row || (target !== document.body && !target.closest('[data-scenario-row]'))) {
        return false;
      }
      openScenario(row.key);
    },
  });

  const moduleName = (id: string) =>
    id === MODULE_NONE
      ? t('scenarios.filters.noModule')
      : (modules.find((m) => m.id === id)?.name ?? id);
  const authorName = (id: string) => authors.find((a) => a.id === id)?.name ?? id;
  const chips: { key: string; label: string; remove: () => void }[] = [];
  const addChips = (field: FilterField, name: string, display: (value: string) => string) => {
    for (const value of query[field] ?? []) {
      chips.push({
        key: `${field}:${value}`,
        label: `${name}: ${display(value)}`,
        remove: () => setView({ [field]: (query[field] ?? []).filter((v) => v !== value) }),
      });
    }
  };
  addChips('status', t('scenarios.filters.status'), (v) => t(`scenario.status.${v}`));
  addChips('priority', t('scenarios.filters.priority'), (v) => t(`scenario.priority.${v}`));
  addChips('module', t('scenarios.filters.module'), moduleName);
  addChips('author', t('scenarios.filters.author'), authorName);
  addChips('tag', t('scenarios.filters.tags'), formatTag);
  if (query.version) {
    chips.push({
      key: 'version',
      label: `${t('scenarios.filters.version')}: ${query.version}`,
      remove: () => setView({ version: undefined }),
    });
  }
  if (query.deleted) {
    chips.push({
      key: 'deleted',
      label: t('scenarios.filters.showDeleted'),
      remove: () => setView({ deleted: false }),
    });
  }
  const clearAll = () => {
    setText('');
    setView({
      q: undefined,
      status: undefined,
      priority: undefined,
      module: undefined,
      author: undefined,
      tag: undefined,
      version: undefined,
      deleted: false,
    });
  };

  const total = list.data?.total ?? 0;
  const page = list.data?.page ?? query.page;
  const pageCount = Math.max(1, Math.ceil(total / query.size));
  const first = total === 0 ? 0 : (page - 1) * query.size + 1;
  const last = Math.min(total, page * query.size);

  let body: ReactNode;
  if (list.isPending) {
    body = (
      <div className="grid gap-2" aria-busy="true" aria-label={t('scenarios.loading')}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  } else if (list.isError) {
    body = <Alert variant="destructive">{errorMessage(list.error)}</Alert>;
  } else if (total === 0 && !hasFilters(query)) {
    body = (
      <EmptyState
        icon={<FlaskConical />}
        title={t('scenarios.emptyTitle')}
        description={t('scenarios.emptyBody')}
        action={
          canWrite ? (
            <Button asChild>
              <Link to="/o/$orgSlug/a/$appKey/scenarios/new" params={{ orgSlug, appKey }}>
                <Plus /> {t('scenarios.new')}
              </Link>
            </Button>
          ) : null
        }
      />
    );
  } else if (total === 0) {
    body = (
      <EmptyState
        icon={<SearchX />}
        title={t('scenarios.noMatches')}
        description={t('scenarios.noMatchesBody')}
        action={
          <Button variant="outline" onClick={clearAll}>
            {t('scenarios.clearFilters')}
          </Button>
        }
      />
    );
  } else {
    body = (
      <>
        <Table role="grid" aria-label={t('scenarios.gridLabel')} aria-rowcount={total + 1}>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => {
                  const label = flexRender(header.column.columnDef.header, header.getContext());
                  if (header.column.columnDef.enableSorting === false) {
                    return (
                      <TableHead key={header.id} className="whitespace-nowrap">
                        {label}
                      </TableHead>
                    );
                  }
                  const field = header.column.id as ScenarioSortField;
                  return (
                    <SortableHead
                      key={header.id}
                      className="whitespace-nowrap"
                      direction={sortField === field ? (sortDesc ? 'desc' : 'asc') : false}
                      onSort={() => setView({ sort: nextSort(query.sort, field) })}
                    >
                      {label}
                    </SortableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className={cn(list.isPlaceholderData && 'opacity-60')}>
            {table.getRowModel().rows.map((row, index) => (
              <TableRow
                key={row.id}
                ref={(element) => {
                  rowRefs.current[index] = element;
                }}
                data-scenario-row
                aria-selected={selected === index}
                aria-rowindex={first + index + 1}
                tabIndex={selected === index || (selected < 0 && index === 0) ? 0 : -1}
                onFocus={(event) => {
                  if (event.target === event.currentTarget) setSelected(index);
                }}
                onClick={() => openScenario(row.original.key)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && event.target === event.currentTarget) {
                    event.preventDefault();
                    openScenario(row.original.key);
                  }
                }}
                className={cn(
                  'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-selected:bg-accent/60',
                  row.original.deletedAt && 'text-muted-foreground',
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="px-3 py-2.5">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground" aria-live="polite">
            {t('scenarios.range', { from: first, to: last, total })}
          </p>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-muted-foreground">
              {t('scenarios.pageSize')}
              <NativeSelect
                className="h-8 w-20"
                value={query.size}
                onChange={(event) => setView({ size: Number(event.target.value) })}
              >
                {SCENARIO_PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <Pagination
              page={page}
              pageCount={pageCount}
              onPageChange={(next) => setView({ page: next })}
              label={t('scenarios.pagination')}
              previousLabel={t('scenarios.previousPage')}
              nextLabel={t('scenarios.nextPage')}
              pageLabel={(n) => t('scenarios.page', { page: n })}
            />
          </div>
        </div>
      </>
    );
  }

  return (
    <section aria-labelledby="scenarios-heading" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="scenarios-heading" className="sr-only">
          {t('workspace.tabs.scenarios')}
        </h2>
        <div className="relative w-full max-w-md">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={searchInput}
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setView({ q: text.trim() || undefined });
              if (event.key === 'Escape') event.currentTarget.blur();
            }}
            aria-label={t('scenarios.searchLabel')}
            placeholder={t('scenarios.searchPlaceholder')}
            className="pl-8"
          />
        </div>
        {canWrite ? (
          <Button asChild>
            <Link to="/o/$orgSlug/a/$appKey/scenarios/new" params={{ orgSlug, appKey }}>
              <Plus /> {t('scenarios.new')}
            </Link>
          </Button>
        ) : null}
      </div>

      <div
        role="group"
        aria-label={t('scenarios.filters.label')}
        className="flex flex-wrap items-center gap-2"
      >
        <FilterMenu
          label={t('scenarios.filters.status')}
          options={SCENARIO_STATUSES.map((s) => ({ value: s, label: t(`scenario.status.${s}`) }))}
          selected={query.status ?? []}
          onChange={(values) => setView({ status: values as ScenarioListQuery['status'] })}
        />
        <FilterMenu
          label={t('scenarios.filters.module')}
          options={[
            { value: MODULE_NONE, label: t('scenarios.filters.noModule') },
            ...modules.map((m) => ({ value: m.id, label: m.name })),
          ]}
          selected={query.module ?? []}
          onChange={(values) => setView({ module: values })}
        />
        <FilterMenu
          label={t('scenarios.filters.priority')}
          options={SCENARIO_PRIORITIES.map((p) => ({
            value: p,
            label: t(`scenario.priority.${p}`),
          }))}
          selected={query.priority ?? []}
          onChange={(values) => setView({ priority: values as ScenarioListQuery['priority'] })}
        />
        <FilterMenu
          label={t('scenarios.filters.author')}
          options={authors.map((a) => ({ value: a.id!, label: a.name }))}
          selected={query.author ?? []}
          onChange={(values) => setView({ author: values })}
        />
        <Combobox
          label={t('scenarios.filters.tags')}
          multiple
          className="h-8 min-h-8 w-auto py-0 text-sm"
          options={[
            ...(query.tag ?? []).map((tag) => ({ value: tag, label: formatTag(tag) })),
            ...tagOptions
              .filter((tag) => !(query.tag ?? []).includes(tag.name))
              .map((tag) => ({ value: tag.name, label: formatTag(tag.name) })),
          ]}
          value={query.tag ?? []}
          onChange={(values) => setView({ tag: values })}
          search={tagSearch}
          onSearchChange={setTagSearch}
          placeholder={t('scenarios.filters.tags')}
          searchPlaceholder={t('scenarios.filters.tagsSearch')}
          emptyText={t('scenarios.filters.noTags')}
          renderValue={(selectedTags) => (
            <span>
              {t('scenarios.filters.tags')}{' '}
              <Badge className="px-1.5 py-0">{selectedTags.length}</Badge>
            </span>
          )}
        />
        <VersionFilter value={query.version} onChange={(version) => setView({ version })} />
        <Button
          variant="outline"
          size="sm"
          aria-pressed={query.deleted}
          onClick={() => setView({ deleted: !query.deleted })}
          className={cn(query.deleted && 'border-primary/60 bg-accent')}
        >
          <Trash2 aria-hidden /> {t('scenarios.filters.showDeleted')}
        </Button>
      </div>

      {chips.length > 0 ? (
        <div
          role="group"
          aria-label={t('scenarios.filters.active')}
          className="flex flex-wrap items-center gap-2"
        >
          {chips.map((chip) => (
            <FilterChip key={chip.key} label={chip.label} onRemove={chip.remove} />
          ))}
          <Button variant="link" size="sm" className="h-auto px-1" onClick={clearAll}>
            {t('scenarios.filters.clearAll')}
          </Button>
        </div>
      ) : null}

      {body}
    </section>
  );
}
