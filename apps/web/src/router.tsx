import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  notFound,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { TooltipProvider } from '@testrex/ui';
import { Toaster } from 'sonner';
import { OrgLayout } from './components/shell';
import { isApiError } from './lib/api';
import {
  appQuery,
  meQuery,
  orgQuery,
  queryClient,
  runQuery,
  scenarioQuery,
  testCaseQuery,
} from './lib/queries';
import { ShortcutProvider } from './lib/shortcuts';
import { useTheme } from './lib/theme';
import { ApplicationsPage } from './pages/applications';
import { AppSettingsPage, type AppSettingsTab } from './pages/AppSettingsPage';
import { InvitePage, SignInPage, SignUpPage } from './pages/auth';
import { NotFoundContent, NotFoundPage } from './pages/NotFoundPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { OrgSettingsPage, type OrgSettingsTab } from './pages/OrgSettingsPage';
import { ComparePage, RevisionPage } from './pages/scenarios/revisions';
import { EditScenarioPage, NewScenarioPage } from './pages/scenarios/ScenarioForm';
import {
  ScenarioGridPage,
  validateScenarioSearch,
  type ScenarioSearch,
} from './pages/scenarios/ScenarioGrid';
import { SCENARIO_TABS, ScenarioPage, type ScenarioTab } from './pages/scenarios/ScenarioPage';
import { AppShell, WorkspaceLayout } from './pages/scenarios/workspace';
import {
  AUTOMATION_TABS,
  AutomationPage,
  DatasetPage,
  type AutomationTab,
} from './pages/automation/AutomationPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { RunPage } from './pages/runs/RunPage';
import { RunsPage, validateRunSearch, type RunSearch } from './pages/runs/RunsPage';
import {
  TestCaseGridPage,
  validateTestCaseSearch,
  type TestCaseSearch,
} from './pages/test-cases/TestCaseGrid';
import { EditTestCasePage, NewTestCasePage } from './pages/test-cases/TestCaseForm';
import { TEST_CASE_TABS, TestCasePage, type TestCaseTab } from './pages/test-cases/TestCasePage';

function Root() {
  const [theme] = useTheme();
  return (
    <TooltipProvider>
      <ShortcutProvider>
        <Outlet />
        <Toaster theme={theme} position="bottom-right" richColors closeButton />
      </ShortcutProvider>
    </TooltipProvider>
  );
}

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Root,
  notFoundComponent: NotFoundPage,
});

const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

/** `/` sends people to their last organization, onboarding, or sign-in. */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async ({ context }) => {
    let me;
    try {
      me = await context.queryClient.fetchQuery(meQuery);
    } catch (error) {
      if (isApiError(error, 401)) throw redirect({ to: '/sign-in' });
      throw error;
    }
    if (me.lastOrganizationSlug) {
      throw redirect({ to: '/o/$orgSlug', params: { orgSlug: me.lastOrganizationSlug } });
    }
    throw redirect({ to: '/onboarding' });
  },
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  validateSearch: (search: Record<string, unknown>): { redirect?: string; email?: string } => ({
    redirect: str(search.redirect),
    email: str(search.email),
  }),
  component: function SignInRoute() {
    const search = signInRoute.useSearch();
    return <SignInPage redirect={search.redirect} email={search.email} />;
  },
});

const signUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-up',
  validateSearch: (search: Record<string, unknown>): { invite?: string } => ({
    invite: str(search.invite),
  }),
  component: function SignUpRoute() {
    return <SignUpPage invite={signUpRoute.useSearch().invite} />;
  },
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$token',
  component: function InviteRoute() {
    return <InvitePage token={inviteRoute.useParams().token} />;
  },
});

/** Everything below requires a session. */
const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(meQuery);
    } catch (error) {
      if (isApiError(error, 401)) {
        throw redirect({ to: '/sign-in', search: { redirect: location.href } });
      }
      throw error;
    }
  },
});

const onboardingRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/onboarding',
  component: OnboardingPage,
});

/** Missing and inaccessible organizations both surface as not found. */
const orgRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/o/$orgSlug',
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.fetchQuery(orgQuery(params.orgSlug));
    } catch (error) {
      if (isApiError(error, 404)) throw notFound();
      throw error;
    }
    // Keep the organization list (switcher) fresh after joining or creating one.
    await context.queryClient.ensureQueryData(meQuery);
  },
  component: OrgLayout,
  notFoundComponent: NotFoundPage,
});

const orgIndexRoute = createRoute({
  getParentRoute: () => orgRoute,
  path: '/',
  validateSearch: (search: Record<string, unknown>): { archived?: boolean; new?: 'app' } => ({
    archived: search.archived === true || search.archived === 'true' ? true : undefined,
    new: search.new === 'app' ? ('app' as const) : undefined,
  }),
  component: function OrgIndexRoute() {
    const { orgSlug } = orgIndexRoute.useParams();
    const search = orgIndexRoute.useSearch();
    return (
      <ApplicationsPage
        orgSlug={orgSlug}
        showArchived={Boolean(search.archived)}
        creating={search.new === 'app'}
      />
    );
  },
});

const orgTabs: readonly OrgSettingsTab[] = ['general', 'members', 'invitations', 'audit', 'ai'];
const orgSettingsRoute = createRoute({
  getParentRoute: () => orgRoute,
  path: '/settings',
  validateSearch: (search: Record<string, unknown>): { tab?: OrgSettingsTab } => ({
    tab: orgTabs.includes(search.tab as OrgSettingsTab)
      ? (search.tab as OrgSettingsTab)
      : 'general',
  }),
  component: function OrgSettingsRoute() {
    const { orgSlug } = orgSettingsRoute.useParams();
    return (
      <OrgSettingsPage orgSlug={orgSlug} tab={orgSettingsRoute.useSearch().tab ?? 'general'} />
    );
  },
});

const appRoute = createRoute({
  getParentRoute: () => orgRoute,
  path: '/a/$appKey',
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.fetchQuery(appQuery(params.orgSlug, params.appKey));
    } catch (error) {
      if (isApiError(error, 404)) throw notFound();
      throw error;
    }
  },
  component: AppShell,
  notFoundComponent: NotFoundContent,
});

/** The application home opens on the test scenarios tab. */
const appIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/o/$orgSlug/a/$appKey/scenarios', params, replace: true });
  },
});

/** Header and tab bar shared by the scenarios and runs tabs. */
const workspaceRoute = createRoute({
  getParentRoute: () => appRoute,
  id: 'workspace',
  component: WorkspaceLayout,
});

const scenariosRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/scenarios',
  // Same schema as the API: search, filters, sort and paging live in the URL.
  validateSearch: (search: Record<string, unknown>): ScenarioSearch =>
    validateScenarioSearch(search),
  component: function ScenariosRoute() {
    const { orgSlug, appKey } = scenariosRoute.useParams();
    return (
      <ScenarioGridPage orgSlug={orgSlug} appKey={appKey} search={scenariosRoute.useSearch()} />
    );
  },
});

const testCasesRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/test-cases',
  validateSearch: (search: Record<string, unknown>): TestCaseSearch =>
    validateTestCaseSearch(search),
  component: function TestCasesRoute() {
    const { orgSlug, appKey } = testCasesRoute.useParams();
    return (
      <TestCaseGridPage orgSlug={orgSlug} appKey={appKey} search={testCasesRoute.useSearch()} />
    );
  },
});

const runsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/runs',
  validateSearch: (search: Record<string, unknown>): RunSearch => validateRunSearch(search),
  component: function RunsRoute() {
    const { orgSlug, appKey } = runsRoute.useParams();
    return <RunsPage orgSlug={orgSlug} appKey={appKey} search={runsRoute.useSearch()} />;
  },
});

const reportsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/reports',
  component: function ReportsRoute() {
    const { orgSlug, appKey } = reportsRoute.useParams();
    return <ReportsPage orgSlug={orgSlug} appKey={appKey} />;
  },
});

const automationRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/automation',
  validateSearch: (search: Record<string, unknown>): { tab?: AutomationTab } => ({
    tab: AUTOMATION_TABS.includes(search.tab as AutomationTab)
      ? (search.tab as AutomationTab)
      : undefined,
  }),
  component: function AutomationRoute() {
    const { orgSlug, appKey } = automationRoute.useParams();
    return (
      <AutomationPage
        orgSlug={orgSlug}
        appKey={appKey}
        tab={automationRoute.useSearch().tab ?? 'settings'}
      />
    );
  },
});

const datasetRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/automation/datasets/$datasetId',
  component: function DatasetRoute() {
    const { orgSlug, appKey, datasetId } = datasetRoute.useParams();
    return <DatasetPage orgSlug={orgSlug} appKey={appKey} datasetId={datasetId} />;
  },
});

const newTestCaseRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/test-cases/new',
  validateSearch: (search: Record<string, unknown>): { scenario?: string } => ({
    scenario: str(search.scenario),
  }),
  component: function NewTestCaseRoute() {
    const { orgSlug, appKey } = newTestCaseRoute.useParams();
    return (
      <NewTestCasePage
        orgSlug={orgSlug}
        appKey={appKey}
        scenarioKey={newTestCaseRoute.useSearch().scenario}
      />
    );
  },
});

/** Unknown test cases (and those of other applications) surface as not found. */
async function loadTestCase(
  client: QueryClient,
  params: { orgSlug: string; appKey: string; testCaseKey: string },
) {
  try {
    await client.fetchQuery(testCaseQuery(params.orgSlug, params.appKey, params.testCaseKey));
  } catch (error) {
    if (isApiError(error, 404)) throw notFound();
    throw error;
  }
}

const testCaseRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/test-cases/$testCaseKey',
  validateSearch: (search: Record<string, unknown>): { tab?: TestCaseTab } => ({
    tab: TEST_CASE_TABS.includes(search.tab as TestCaseTab)
      ? (search.tab as TestCaseTab)
      : undefined,
  }),
  loader: ({ context, params }) => loadTestCase(context.queryClient, params),
  component: function TestCaseRoute() {
    const { orgSlug, appKey, testCaseKey } = testCaseRoute.useParams();
    return (
      <TestCasePage
        orgSlug={orgSlug}
        appKey={appKey}
        testCaseKey={testCaseKey}
        tab={testCaseRoute.useSearch().tab ?? 'steps'}
      />
    );
  },
});

const editTestCaseRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/test-cases/$testCaseKey/edit',
  loader: ({ context, params }) => loadTestCase(context.queryClient, params),
  component: function EditTestCaseRoute() {
    const { orgSlug, appKey, testCaseKey } = editTestCaseRoute.useParams();
    return <EditTestCasePage orgSlug={orgSlug} appKey={appKey} testCaseKey={testCaseKey} />;
  },
});

const runRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/runs/$runKey',
  validateSearch: (search: Record<string, unknown>): { item?: string } => ({
    item: str(search.item),
  }),
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.fetchQuery(runQuery(params.orgSlug, params.appKey, params.runKey));
    } catch (error) {
      if (isApiError(error, 404)) throw notFound();
      throw error;
    }
  },
  component: function RunRoute() {
    const { orgSlug, appKey, runKey } = runRoute.useParams();
    return (
      <RunPage
        orgSlug={orgSlug}
        appKey={appKey}
        runKey={runKey}
        itemId={runRoute.useSearch().item}
      />
    );
  },
});

const newScenarioRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/scenarios/new',
  component: function NewScenarioRoute() {
    const { orgSlug, appKey } = newScenarioRoute.useParams();
    return <NewScenarioPage orgSlug={orgSlug} appKey={appKey} />;
  },
});

/** Unknown scenarios (and those of other applications) surface as not found. */
async function loadScenario(
  queryClient: QueryClient,
  params: { orgSlug: string; appKey: string; scenarioKey: string },
) {
  try {
    await queryClient.fetchQuery(scenarioQuery(params.orgSlug, params.appKey, params.scenarioKey));
  } catch (error) {
    if (isApiError(error, 404)) throw notFound();
    throw error;
  }
}

const scenarioRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/scenarios/$scenarioKey',
  validateSearch: (search: Record<string, unknown>): { tab?: ScenarioTab } => ({
    tab: SCENARIO_TABS.includes(search.tab as ScenarioTab)
      ? (search.tab as ScenarioTab)
      : undefined,
  }),
  loader: ({ context, params }) => loadScenario(context.queryClient, params),
  component: function ScenarioRoute() {
    const { orgSlug, appKey, scenarioKey } = scenarioRoute.useParams();
    return (
      <ScenarioPage
        orgSlug={orgSlug}
        appKey={appKey}
        scenarioKey={scenarioKey}
        tab={scenarioRoute.useSearch().tab ?? 'details'}
      />
    );
  },
});

const editScenarioRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/scenarios/$scenarioKey/edit',
  loader: ({ context, params }) => loadScenario(context.queryClient, params),
  component: function EditScenarioRoute() {
    const { orgSlug, appKey, scenarioKey } = editScenarioRoute.useParams();
    return <EditScenarioPage orgSlug={orgSlug} appKey={appKey} scenarioKey={scenarioKey} />;
  },
});

const revisionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/scenarios/$scenarioKey/revisions/$number',
  loader: ({ context, params }) => loadScenario(context.queryClient, params),
  component: function RevisionRoute() {
    const { orgSlug, appKey, scenarioKey, number } = revisionRoute.useParams();
    return (
      <RevisionPage
        orgSlug={orgSlug}
        appKey={appKey}
        scenarioKey={scenarioKey}
        number={Number(number.replace(/^r/i, '')) || 0}
      />
    );
  },
});

const positive = (value: unknown) =>
  Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : undefined;

const compareRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/scenarios/$scenarioKey/compare',
  validateSearch: (search: Record<string, unknown>): { from?: number; to?: number } => ({
    from: positive(search.from),
    to: positive(search.to),
  }),
  loader: ({ context, params }) => loadScenario(context.queryClient, params),
  component: function CompareRoute() {
    const { orgSlug, appKey, scenarioKey } = compareRoute.useParams();
    const { from, to } = compareRoute.useSearch();
    return (
      <ComparePage
        orgSlug={orgSlug}
        appKey={appKey}
        scenarioKey={scenarioKey}
        from={from}
        to={to}
      />
    );
  },
});

const appTabs: readonly AppSettingsTab[] = ['general', 'members', 'archive'];
const appSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  validateSearch: (search: Record<string, unknown>): { tab?: AppSettingsTab } => ({
    tab: appTabs.includes(search.tab as AppSettingsTab)
      ? (search.tab as AppSettingsTab)
      : 'general',
  }),
  component: function AppSettingsRoute() {
    const { orgSlug, appKey } = appSettingsRoute.useParams();
    return (
      <AppSettingsPage
        orgSlug={orgSlug}
        appKey={appKey}
        tab={appSettingsRoute.useSearch().tab ?? 'general'}
      />
    );
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  signInRoute,
  signUpRoute,
  inviteRoute,
  authedRoute.addChildren([
    onboardingRoute,
    orgRoute.addChildren([
      orgIndexRoute,
      orgSettingsRoute,
      appRoute.addChildren([
        appIndexRoute,
        workspaceRoute.addChildren([
          scenariosRoute,
          testCasesRoute,
          runsRoute,
          reportsRoute,
          automationRoute,
        ]),
        newScenarioRoute,
        newTestCaseRoute,
        testCaseRoute,
        editTestCaseRoute,
        runRoute,
        datasetRoute,
        scenarioRoute,
        editScenarioRoute,
        revisionRoute,
        compareRoute,
        appSettingsRoute,
      ]),
    ]),
  ]),
]);

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  defaultNotFoundComponent: NotFoundPage,
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
