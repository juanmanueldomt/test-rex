import { cn } from '@testrex/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { BarChart3, FlaskConical, ListChecks, PlayCircle, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { scenarioListQuery, testCaseListQuery } from '../../lib/queries';
import { useShortcut } from '../../lib/shortcuts';
import { AppHeader } from '../applications';

type AppParams = { orgSlug: string; appKey: string };

/** Everything under /o/:org/a/:app: application-wide shortcuts. */
export function AppShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { orgSlug, appKey } = useParams({ strict: false }) as AppParams;
  useShortcut({
    keys: 'g s',
    description: t('shortcuts.goScenarios'),
    group: 'navigation',
    handler: () =>
      void navigate({ to: '/o/$orgSlug/a/$appKey/scenarios', params: { orgSlug, appKey } }),
  });
  useShortcut({
    keys: 'g c',
    description: t('shortcuts.goTestCases'),
    group: 'navigation',
    handler: () =>
      void navigate({ to: '/o/$orgSlug/a/$appKey/test-cases', params: { orgSlug, appKey } }),
  });
  useShortcut({
    keys: 'g r',
    description: t('shortcuts.goRuns'),
    group: 'navigation',
    handler: () => void navigate({ to: '/o/$orgSlug/a/$appKey/runs', params: { orgSlug, appKey } }),
  });
  useShortcut({
    keys: 'g d',
    description: t('shortcuts.goReports'),
    group: 'navigation',
    handler: () =>
      void navigate({ to: '/o/$orgSlug/a/$appKey/reports', params: { orgSlug, appKey } }),
  });
  useShortcut({
    keys: 'g a',
    description: t('shortcuts.goAutomation'),
    group: 'navigation',
    handler: () =>
      void navigate({ to: '/o/$orgSlug/a/$appKey/automation', params: { orgSlug, appKey } }),
  });
  return <Outlet />;
}

const tabClasses =
  'relative inline-flex h-10 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-md [&_svg]:size-4 data-[status=active]:border-primary data-[status=active]:text-foreground';

/**
 * The application home: header plus link tabs. Each tab is a route with its own URL, so the
 * active tab survives reloads and shared links (aria-current marks it for assistive tech).
 */
function Count({ value }: { value: number | undefined }) {
  if (value === undefined) return null;
  return (
    <span className={cn('rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground')}>
      {value}
    </span>
  );
}

export function WorkspaceLayout() {
  const { t } = useTranslation();
  const { orgSlug, appKey } = useParams({ strict: false }) as AppParams;
  // Same cache entries as the unfiltered grids.
  const scenarios = useQuery(scenarioListQuery(orgSlug, appKey, {})).data?.total;
  const testCases = useQuery(testCaseListQuery(orgSlug, appKey, {})).data?.total;
  const tabs = [
    {
      to: '/o/$orgSlug/a/$appKey/scenarios',
      icon: FlaskConical,
      label: t('workspace.tabs.scenarios'),
      count: scenarios,
    },
    {
      to: '/o/$orgSlug/a/$appKey/test-cases',
      icon: ListChecks,
      label: t('workspace.tabs.testCases'),
      count: testCases,
    },
    { to: '/o/$orgSlug/a/$appKey/runs', icon: PlayCircle, label: t('workspace.tabs.runs') },
    { to: '/o/$orgSlug/a/$appKey/reports', icon: BarChart3, label: t('workspace.tabs.reports') },
    {
      to: '/o/$orgSlug/a/$appKey/automation',
      icon: Workflow,
      label: t('workspace.tabs.automation'),
    },
  ] as const;
  return (
    <>
      <AppHeader orgSlug={orgSlug} appKey={appKey} />
      <nav
        aria-label={t('workspace.tabs.label')}
        className="mb-6 flex gap-1 overflow-x-auto border-b"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            params={{ orgSlug, appKey }}
            className={tabClasses}
            activeOptions={{ includeSearch: false }}
          >
            <tab.icon aria-hidden />
            {tab.label}
            {'count' in tab ? <Count value={tab.count} /> : null}
          </Link>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
