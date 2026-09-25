import { EmptyState, cn } from '@testrex/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { Construction, FlaskConical, PlayCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { scenarioListQuery } from '../../lib/queries';
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
    keys: 'g r',
    description: t('shortcuts.goRuns'),
    group: 'navigation',
    handler: () => void navigate({ to: '/o/$orgSlug/a/$appKey/runs', params: { orgSlug, appKey } }),
  });
  return <Outlet />;
}

const tabClasses =
  'relative inline-flex h-10 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-md [&_svg]:size-4 data-[status=active]:border-primary data-[status=active]:text-foreground';

/**
 * The application home: header plus link tabs. Each tab is a route with its own URL, so the
 * active tab survives reloads and shared links (aria-current marks it for assistive tech).
 */
export function WorkspaceLayout() {
  const { t } = useTranslation();
  const { orgSlug, appKey } = useParams({ strict: false }) as AppParams;
  // Same cache entry as the unfiltered grid.
  const count = useQuery(scenarioListQuery(orgSlug, appKey, {})).data?.total;
  return (
    <>
      <AppHeader orgSlug={orgSlug} appKey={appKey} />
      <nav aria-label={t('workspace.tabs.label')} className="mb-6 flex gap-1 border-b">
        <Link
          to="/o/$orgSlug/a/$appKey/scenarios"
          params={{ orgSlug, appKey }}
          className={tabClasses}
          activeOptions={{ includeSearch: false }}
        >
          <FlaskConical aria-hidden />
          {t('workspace.tabs.scenarios')}
          {count !== undefined ? (
            <span
              className={cn(
                'rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground',
              )}
            >
              {count}
            </span>
          ) : null}
        </Link>
        <Link to="/o/$orgSlug/a/$appKey/runs" params={{ orgSlug, appKey }} className={tabClasses}>
          <PlayCircle aria-hidden />
          {t('workspace.tabs.runs')}
        </Link>
      </nav>
      <Outlet />
    </>
  );
}

export function RunsPage() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<Construction />}
      title={t('workspace.runsTitle')}
      description={t('workspace.runsBody')}
    />
  );
}
