import {
  compactTestCaseListQuery,
  EXECUTION_MODES,
  parseTestCaseListQueryLenient,
  TEST_CASE_PAGE_SIZES,
  TEST_CASE_PRIORITIES,
  TEST_CASE_STATUSES,
  type TestCaseListQuery,
  type TestCaseSort,
  type TestCaseSortField,
} from '@testrex/contracts';
import {
  Alert,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  NativeSelect,
  Pagination,
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
import { ChevronDown, ListChecks, Plus, Search, SearchX, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PriorityLabel, StatusBadge, TagCell } from '../../components/scenario-ui';
import { errorMessage } from '../../lib/api';
import { scenarioListQuery, testCaseListQuery } from '../../lib/queries';
import { useShortcut } from '../../lib/shortcuts';
import { LastResultBadge, ModeBadge, ScenarioChips, useTestingAccess } from './common';

export type TestCaseSearch = Partial<Record<string, string | number | boolean>>;

export function validateTestCaseSearch(raw: Record<string, unknown>): TestCaseSearch {
  return compactTestCaseListQuery(parseTestCaseListQueryLenient(raw));
}

const DESCENDING_FIRST: TestCaseSortField[] = ['key', 'updated'];

function nextSort(current: TestCaseSort, field: TestCaseSortField): TestCaseSort {
  const active = current.replace(/^-/, '');
  const desc = current.startsWith('-');
  if (active === field) return (desc ? field : `-${field}`) as TestCaseSort;
  return (DESCENDING_FIRST.includes(field) ? `-${field}` : field) as TestCaseSort;
}

function Filter({
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
          {selected.length ? <Badge className="px-1.5 py-0">{selected.length}</Badge> : null}
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

export function TestCaseGridPage({
  orgSlug,
  appKey,
  search,
}: {
  orgSlug: string;
  appKey: string;
  search: TestCaseSearch;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canEdit } = useTestingAccess(orgSlug, appKey);
  const query = useMemo(() => parseTestCaseListQueryLenient(search), [search]);
  const list = useQuery(testCaseListQuery(orgSlug, appKey, query));
  const scenarios = useQuery(scenarioListQuery(orgSlug, appKey, { size: 100 })).data?.items ?? [];

  const setView = (patch: Partial<TestCaseListQuery>, options: { replace?: boolean } = {}) => {
    const next = { ...query, ...patch };
    if (!('page' in patch)) next.page = 1;
    void navigate({
      to: '/o/$orgSlug/a/$appKey/test-cases',
      params: { orgSlug, appKey },
      search: compactTestCaseListQuery(next),
      replace: options.replace,
    });
  };

  const servedPage = list.isPlaceholderData ? undefined : list.data?.page;
  useEffect(() => {
    if (servedPage !== undefined && servedPage !== query.page) {
      setView({ page: servedPage }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servedPage, query.page]);

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
  const [selected, setSelected] = useState(-1);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const [lastItems, setLastItems] = useState(items);
  if (lastItems !== items) {
    setLastItems(items);
    setSelected(-1);
  }
  const open = (key: string) =>
    void navigate({
      to: '/o/$orgSlug/a/$appKey/test-cases/$testCaseKey',
      params: { orgSlug, appKey, testCaseKey: key },
    });
  const select = (index: number) => {
    if (items.length === 0) return;
    const next = Math.max(0, Math.min(items.length - 1, index));
    setSelected(next);
    rowRefs.current[next]?.focus();
  };

  useShortcut({
    keys: 'c',
    description: t('shortcuts.newTestCase'),
    group: 'testCases',
    enabled: canEdit,
    handler: () =>
      void navigate({ to: '/o/$orgSlug/a/$appKey/test-cases/new', params: { orgSlug, appKey } }),
  });
  useShortcut({
    keys: '/',
    description: t('shortcuts.focusSearch'),
    group: 'testCases',
    handler: () => searchInput.current?.focus(),
  });
  useShortcut({
    keys: 'j',
    description: t('shortcuts.nextRow'),
    group: 'testCases',
    handler: () => select(selected + 1),
  });
  useShortcut({
    keys: 'k',
    description: t('shortcuts.previousRow'),
    group: 'testCases',
    handler: () => select(selected < 0 ? 0 : selected - 1),
  });
  useShortcut({
    keys: 'Enter',
    description: t('shortcuts.openRow'),
    group: 'testCases',
    handler: (event) => {
      const row = items[selected];
      const target = event.target as HTMLElement;
      if (!row || (target !== document.body && !target.closest('[data-row]'))) return false;
      open(row.key);
    },
  });

  const sortField = query.sort.replace(/^-/, '') as TestCaseSortField;
  const sortDesc = query.sort.startsWith('-');
  const sortable = (field: TestCaseSortField, label: string) => (
    <SortableHead
      className="whitespace-nowrap"
      direction={sortField === field ? (sortDesc ? 'desc' : 'asc') : false}
      onSort={() => setView({ sort: nextSort(query.sort, field) })}
    >
      {label}
    </SortableHead>
  );
  const filtered = Boolean(
    query.q ||
    query.deleted ||
    query.status ||
    query.mode ||
    query.priority ||
    query.scenario ||
    query.tag,
  );
  const clearAll = () => {
    setText('');
    setView({
      q: undefined,
      status: undefined,
      mode: undefined,
      priority: undefined,
      scenario: undefined,
      tag: undefined,
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
      <div className="grid gap-2" aria-busy="true" aria-label={t('testCases.loading')}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  } else if (list.isError) {
    body = <Alert variant="destructive">{errorMessage(list.error)}</Alert>;
  } else if (total === 0 && !filtered) {
    body = (
      <EmptyState
        icon={<ListChecks />}
        title={t('testCases.emptyTitle')}
        description={t('testCases.emptyBody')}
        action={
          canEdit ? (
            <Button asChild>
              <Link to="/o/$orgSlug/a/$appKey/test-cases/new" params={{ orgSlug, appKey }}>
                <Plus /> {t('testCases.new')}
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
        title={t('testCases.noMatches')}
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
        <Table role="grid" aria-label={t('testCases.gridLabel')} aria-rowcount={total + 1}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {sortable('key', t('testCases.columns.key'))}
              {sortable('title', t('testCases.columns.title'))}
              {sortable('mode', t('testCases.columns.mode'))}
              {sortable('status', t('testCases.columns.status'))}
              {sortable('priority', t('testCases.columns.priority'))}
              <TableHead>{t('testCases.columns.scenarios')}</TableHead>
              <TableHead>{t('testCases.columns.tags')}</TableHead>
              <TableHead className="text-right">{t('testCases.columns.steps')}</TableHead>
              <TableHead>{t('testCases.columns.lastResult')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className={cn(list.isPlaceholderData && 'opacity-60')}>
            {items.map((item, index) => (
              <TableRow
                key={item.id}
                ref={(element) => {
                  rowRefs.current[index] = element;
                }}
                data-row
                aria-selected={selected === index}
                aria-rowindex={first + index + 1}
                tabIndex={selected === index || (selected < 0 && index === 0) ? 0 : -1}
                onFocus={(event) => {
                  if (event.target === event.currentTarget) setSelected(index);
                }}
                onClick={() => open(item.key)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && event.target === event.currentTarget) {
                    event.preventDefault();
                    open(item.key);
                  }
                }}
                className={cn(
                  'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-selected:bg-accent/60',
                  item.deletedAt && 'text-muted-foreground',
                )}
              >
                <TableCell className="px-3 py-2.5">
                  <Link
                    to="/o/$orgSlug/a/$appKey/test-cases/$testCaseKey"
                    params={{ orgSlug, appKey, testCaseKey: item.key }}
                    className="whitespace-nowrap font-mono text-xs font-medium hover:underline"
                    tabIndex={-1}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {item.key}
                  </Link>
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className="line-clamp-2 font-medium">{item.title}</span>
                    {item.deletedAt ? (
                      <Badge variant="warning">{t('scenarios.deleted')}</Badge>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <ModeBadge mode={item.executionMode} />
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <StatusBadge status={item.status} />
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <PriorityLabel priority={item.priority} />
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <ScenarioChips scenarios={item.scenarios} orgSlug={orgSlug} appKey={appKey} />
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <TagCell tags={item.tags} />
                </TableCell>
                <TableCell className="px-3 py-2.5 text-right tabular-nums">
                  {item.stepCount}
                  {item.dataset ? (
                    <span className="ml-1 text-xs text-muted-foreground" title={item.dataset.name}>
                      ×{t('testCases.dataset')}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <LastResultBadge result={item.lastResult} orgSlug={orgSlug} appKey={appKey} />
                </TableCell>
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
                {TEST_CASE_PAGE_SIZES.map((size) => (
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
    <section aria-labelledby="test-cases-heading" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="test-cases-heading" className="sr-only">
          {t('workspace.tabs.testCases')}
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
            aria-label={t('testCases.searchLabel')}
            placeholder={t('testCases.searchPlaceholder')}
            className="pl-8"
          />
        </div>
        {canEdit ? (
          <Button asChild>
            <Link to="/o/$orgSlug/a/$appKey/test-cases/new" params={{ orgSlug, appKey }}>
              <Plus /> {t('testCases.new')}
            </Link>
          </Button>
        ) : null}
      </div>
      <div
        role="group"
        aria-label={t('scenarios.filters.label')}
        className="flex flex-wrap items-center gap-2"
      >
        <Filter
          label={t('testCases.columns.mode')}
          options={EXECUTION_MODES.map((mode) => ({
            value: mode,
            label: t(`testCases.mode.${mode}`),
          }))}
          selected={query.mode ?? []}
          onChange={(values) => setView({ mode: values as TestCaseListQuery['mode'] })}
        />
        <Filter
          label={t('scenarios.filters.status')}
          options={TEST_CASE_STATUSES.map((s) => ({ value: s, label: t(`scenario.status.${s}`) }))}
          selected={query.status ?? []}
          onChange={(values) => setView({ status: values as TestCaseListQuery['status'] })}
        />
        <Filter
          label={t('scenarios.filters.priority')}
          options={TEST_CASE_PRIORITIES.map((p) => ({
            value: p,
            label: t(`scenario.priority.${p}`),
          }))}
          selected={query.priority ?? []}
          onChange={(values) => setView({ priority: values as TestCaseListQuery['priority'] })}
        />
        <Filter
          label={t('testCases.columns.scenarios')}
          options={scenarios.map((s) => ({ value: s.id, label: `${s.key} · ${s.title}` }))}
          selected={query.scenario ?? []}
          onChange={(values) => setView({ scenario: values })}
        />
        <Button
          variant="outline"
          size="sm"
          aria-pressed={query.deleted}
          onClick={() => setView({ deleted: !query.deleted })}
          className={cn(query.deleted && 'border-primary/60 bg-accent')}
        >
          <Trash2 aria-hidden /> {t('scenarios.filters.showDeleted')}
        </Button>
        {filtered ? (
          <Button variant="link" size="sm" className="h-auto px-1" onClick={clearAll}>
            {t('scenarios.filters.clearAll')}
          </Button>
        ) : null}
      </div>
      {body}
    </section>
  );
}
