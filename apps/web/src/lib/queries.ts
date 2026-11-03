import {
  compactRunListQuery,
  compactTestCaseListQuery,
  testCaseListQueryString,
  type AiStatus,
  type AutomationSettingsView,
  type Dataset,
  type DatasetSummary,
  type GlobalReport,
  type GlobalStep,
  type LlmSettings,
  type PlaywrightCode,
  type RecordingSession,
  type Run,
  type RunItemDetail,
  type RunListPage,
  type RunListQuery,
  type TestCase,
  type TestCaseListPage,
  type TestCaseListQuery,
  type TestCaseVersion,
  type TestCaseVersionSummary,
} from '@testrex/contracts';
import {
  compactScenarioListQuery,
  scenarioListQueryString,
  type Attachment,
  type AttachmentLimits,
  type RequirementLink,
  type Scenario,
  type ScenarioComment,
  type ScenarioListPage,
  type ScenarioListQuery,
  type ScenarioModule,
  type ScenarioRevision,
  type ScenarioRevisionSummary,
  type ScenarioTagSuggestion,
  type UserRef,
} from '@testrex/contracts';
import type {
  AppContext,
  AppMember,
  AppSummary,
  AuditPage,
  InstanceInfo,
  Invitation,
  InvitationPreview,
  Member,
  MeResponse,
  OrgContext,
} from '@testrex/contracts';
import { keepPreviousData, queryOptions, QueryClient } from '@tanstack/react-query';
import { api, isApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => !isApiError(error) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

export const keys = {
  instance: ['instance'] as const,
  me: ['me'] as const,
  org: (slug: string) => ['org', slug] as const,
  apps: (slug: string, status: string) => ['org', slug, 'apps', status] as const,
  app: (slug: string, key: string) => ['org', slug, 'app', key] as const,
  appMembers: (slug: string, key: string) => ['org', slug, 'app', key, 'members'] as const,
  members: (slug: string) => ['org', slug, 'members'] as const,
  invitations: (slug: string) => ['org', slug, 'invitations'] as const,
  audit: (slug: string, filters: object) => ['org', slug, 'audit', filters] as const,
  invitation: (token: string) => ['invitation', token] as const,
  /** Everything about one application's scenarios; invalidated after scenario changes. */
  scenarios: (slug: string, app: string) => ['org', slug, 'app', app, 'scenarios'] as const,
  /** Equivalent queries (defaults, value order) share one cache entry. */
  scenarioList: (slug: string, app: string, query: Partial<ScenarioListQuery>) =>
    [...keys.scenarios(slug, app), 'list', compactScenarioListQuery(query)] as const,
  scenarioAuthors: (slug: string, app: string) =>
    [...keys.scenarios(slug, app), 'authors'] as const,
  scenario: (slug: string, app: string, key: string) =>
    [...keys.scenarios(slug, app), 'item', key.toUpperCase()] as const,
  scenarioPart: (slug: string, app: string, key: string, part: string, ...rest: unknown[]) =>
    [...keys.scenario(slug, app, key), part, ...rest] as const,
  modules: (slug: string, app: string) => ['org', slug, 'app', app, 'modules'] as const,
  tags: (slug: string, app: string, prefix: string) =>
    ['org', slug, 'app', app, 'tags', prefix] as const,
  attachmentLimits: (slug: string, app: string) =>
    ['org', slug, 'app', app, 'attachment-limits'] as const,
};

export const instanceQuery = queryOptions({
  queryKey: keys.instance,
  queryFn: () => api.get<InstanceInfo>('/api/instance'),
});

export const meQuery = queryOptions({
  queryKey: keys.me,
  queryFn: () => api.get<MeResponse>('/api/me'),
});

export const orgQuery = (slug: string) =>
  queryOptions({
    queryKey: keys.org(slug),
    queryFn: () => api.get<OrgContext>(`/api/orgs/${slug}`),
  });

export const appsQuery = (slug: string, status: 'active' | 'archived' = 'active') =>
  queryOptions({
    queryKey: keys.apps(slug, status),
    queryFn: () => api.get<AppSummary[]>(`/api/orgs/${slug}/apps?status=${status}`),
  });

export const appQuery = (slug: string, key: string) =>
  queryOptions({
    queryKey: keys.app(slug, key),
    queryFn: () => api.get<AppContext>(`/api/orgs/${slug}/apps/${key}`),
  });

export const appMembersQuery = (slug: string, key: string) =>
  queryOptions({
    queryKey: keys.appMembers(slug, key),
    queryFn: () => api.get<AppMember[]>(`/api/orgs/${slug}/apps/${key}/members`),
  });

export const membersQuery = (slug: string) =>
  queryOptions({
    queryKey: keys.members(slug),
    queryFn: () => api.get<Member[]>(`/api/orgs/${slug}/members`),
  });

export const invitationsQuery = (slug: string) =>
  queryOptions({
    queryKey: keys.invitations(slug),
    queryFn: () => api.get<Invitation[]>(`/api/orgs/${slug}/invitations`),
  });

export const invitationPreviewQuery = (token: string) =>
  queryOptions({
    queryKey: keys.invitation(token),
    queryFn: () => api.get<InvitationPreview>(`/api/invitations/${encodeURIComponent(token)}`),
  });

export interface AuditFilters {
  actorId?: string;
  action?: string;
  from?: string;
  to?: string;
}

export function fetchAudit(slug: string, filters: AuditFilters, before?: string) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (before) params.set('before', before);
  return api.get<AuditPage>(`/api/orgs/${slug}/audit?${params}`);
}

/** Refetch everything that depends on the current organization. */
export function invalidateOrg(slug: string) {
  return queryClient.invalidateQueries({ queryKey: ['org', slug] });
}

// ---- Scenarios ------------------------------------------------------------------------------

export const appApi = (slug: string, app: string) => `/api/orgs/${slug}/apps/${app}`;
export const scenarioApi = (slug: string, app: string, key: string) =>
  `${appApi(slug, app)}/scenarios/${encodeURIComponent(key)}`;

export const scenarioListQuery = (slug: string, app: string, query: Partial<ScenarioListQuery>) =>
  queryOptions({
    queryKey: keys.scenarioList(slug, app, query),
    queryFn: () => {
      const search = scenarioListQueryString(query);
      return api.get<ScenarioListPage>(
        `${appApi(slug, app)}/scenarios${search ? `?${search}` : ''}`,
      );
    },
    // Keep showing the previous page while the next one loads (no flashing).
    placeholderData: keepPreviousData,
  });

export const scenarioAuthorsQuery = (slug: string, app: string) =>
  queryOptions({
    queryKey: keys.scenarioAuthors(slug, app),
    queryFn: () => api.get<UserRef[]>(`${appApi(slug, app)}/scenarios/authors`),
  });

export const scenarioQuery = (slug: string, app: string, key: string) =>
  queryOptions({
    queryKey: keys.scenario(slug, app, key),
    queryFn: () => api.get<Scenario>(scenarioApi(slug, app, key)),
  });

export const revisionsQuery = (slug: string, app: string, key: string) =>
  queryOptions({
    queryKey: keys.scenarioPart(slug, app, key, 'revisions'),
    queryFn: () => api.get<ScenarioRevisionSummary[]>(`${scenarioApi(slug, app, key)}/revisions`),
  });

export const revisionQuery = (slug: string, app: string, key: string, number: number) =>
  queryOptions({
    queryKey: keys.scenarioPart(slug, app, key, 'revision', number),
    queryFn: () => api.get<ScenarioRevision>(`${scenarioApi(slug, app, key)}/revisions/${number}`),
    // Revisions never change.
    staleTime: Infinity,
  });

export const commentsQuery = (slug: string, app: string, key: string) =>
  queryOptions({
    queryKey: keys.scenarioPart(slug, app, key, 'comments'),
    queryFn: () => api.get<ScenarioComment[]>(`${scenarioApi(slug, app, key)}/comments`),
  });

export const linksQuery = (slug: string, app: string, key: string) =>
  queryOptions({
    queryKey: keys.scenarioPart(slug, app, key, 'links'),
    queryFn: () => api.get<RequirementLink[]>(`${scenarioApi(slug, app, key)}/links`),
  });

export const attachmentsQuery = (slug: string, app: string, key: string) =>
  queryOptions({
    queryKey: keys.scenarioPart(slug, app, key, 'attachments'),
    queryFn: () => api.get<Attachment[]>(`${scenarioApi(slug, app, key)}/attachments`),
  });

export const modulesQuery = (slug: string, app: string) =>
  queryOptions({
    queryKey: keys.modules(slug, app),
    queryFn: () => api.get<ScenarioModule[]>(`${appApi(slug, app)}/modules`),
  });

export const tagsQuery = (slug: string, app: string, prefix = '') =>
  queryOptions({
    queryKey: keys.tags(slug, app, prefix),
    queryFn: () =>
      api.get<ScenarioTagSuggestion[]>(
        `${appApi(slug, app)}/tags?limit=50${prefix ? `&q=${encodeURIComponent(prefix)}` : ''}`,
      ),
  });

export const attachmentLimitsQuery = (slug: string, app: string) =>
  queryOptions({
    queryKey: keys.attachmentLimits(slug, app),
    queryFn: () => api.get<AttachmentLimits>(`${appApi(slug, app)}/attachments/limits`),
    staleTime: Infinity,
  });

/** Refetch lists, counts, modules and tags after a scenario change. */
export function invalidateScenarios(slug: string, app: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: keys.scenarios(slug, app) }),
    queryClient.invalidateQueries({ queryKey: keys.modules(slug, app) }),
    queryClient.invalidateQueries({ queryKey: ['org', slug, 'app', app, 'tags'] }),
  ]);
}

// ---- Test cases, automation, runs, reports, AI ---------------------------------------------

export const testKeys = {
  testCases: (slug: string, app: string) => ['org', slug, 'app', app, 'test-cases'] as const,
  testCaseList: (slug: string, app: string, query: Partial<TestCaseListQuery>) =>
    [...testKeys.testCases(slug, app), 'list', compactTestCaseListQuery(query)] as const,
  testCase: (slug: string, app: string, key: string) =>
    [...testKeys.testCases(slug, app), 'item', key.toUpperCase()] as const,
  testCasePart: (slug: string, app: string, key: string, part: string, ...rest: unknown[]) =>
    [...testKeys.testCase(slug, app, key), part, ...rest] as const,
  automation: (slug: string, app: string) => ['org', slug, 'app', app, 'automation'] as const,
  datasets: (slug: string, app: string) => ['org', slug, 'app', app, 'datasets'] as const,
  runs: (slug: string, app: string) => ['org', slug, 'app', app, 'runs'] as const,
  runList: (slug: string, app: string, query: Partial<RunListQuery>) =>
    [...testKeys.runs(slug, app), 'list', compactRunListQuery(query)] as const,
  run: (slug: string, app: string, key: string) =>
    [...testKeys.runs(slug, app), 'item', key.toUpperCase()] as const,
  report: (slug: string, app: string, days: number) =>
    ['org', slug, 'app', app, 'report', days] as const,
  aiStatus: (slug: string) => ['org', slug, 'llm', 'status'] as const,
  llmSettings: (slug: string) => ['org', slug, 'llm', 'settings'] as const,
};

export const testCaseApi = (slug: string, app: string, key: string) =>
  `${appApi(slug, app)}/test-cases/${encodeURIComponent(key)}`;
export const runApi = (slug: string, app: string, key: string) =>
  `${appApi(slug, app)}/runs/${encodeURIComponent(key)}`;

export const testCaseListQuery = (slug: string, app: string, query: Partial<TestCaseListQuery>) =>
  queryOptions({
    queryKey: testKeys.testCaseList(slug, app, query),
    queryFn: () => {
      const search = testCaseListQueryString(query);
      return api.get<TestCaseListPage>(
        `${appApi(slug, app)}/test-cases${search ? `?${search}` : ''}`,
      );
    },
    placeholderData: keepPreviousData,
  });

export const testCaseQuery = (slug: string, app: string, key: string) =>
  queryOptions({
    queryKey: testKeys.testCase(slug, app, key),
    queryFn: () => api.get<TestCase>(testCaseApi(slug, app, key)),
  });

export const testCaseVersionsQuery = (slug: string, app: string, key: string) =>
  queryOptions({
    queryKey: testKeys.testCasePart(slug, app, key, 'versions'),
    queryFn: () => api.get<TestCaseVersionSummary[]>(`${testCaseApi(slug, app, key)}/versions`),
  });

export const testCaseVersionQuery = (slug: string, app: string, key: string, number: number) =>
  queryOptions({
    queryKey: testKeys.testCasePart(slug, app, key, 'version', number),
    queryFn: () => api.get<TestCaseVersion>(`${testCaseApi(slug, app, key)}/versions/${number}`),
    staleTime: Infinity,
  });

export const testCaseCodeQuery = (slug: string, app: string, key: string) =>
  queryOptions({
    queryKey: testKeys.testCasePart(slug, app, key, 'code'),
    queryFn: () => api.get<PlaywrightCode>(`${testCaseApi(slug, app, key)}/playwright`),
  });

export const scenarioCodeQuery = (slug: string, app: string, key: string) =>
  queryOptions({
    queryKey: keys.scenarioPart(slug, app, key, 'code'),
    queryFn: () => api.get<PlaywrightCode>(`${scenarioApi(slug, app, key)}/playwright`),
  });

export const automationQuery = (slug: string, app: string) =>
  queryOptions({
    queryKey: testKeys.automation(slug, app),
    queryFn: () => api.get<AutomationSettingsView>(`${appApi(slug, app)}/automation`),
  });

export const globalStepsQuery = (slug: string, app: string) =>
  queryOptions({
    queryKey: [...testKeys.automation(slug, app), 'global-steps'],
    queryFn: () => api.get<GlobalStep[]>(`${appApi(slug, app)}/global-steps`),
  });

export const datasetsQuery = (slug: string, app: string) =>
  queryOptions({
    queryKey: testKeys.datasets(slug, app),
    queryFn: () => api.get<DatasetSummary[]>(`${appApi(slug, app)}/datasets`),
  });

export const datasetQuery = (slug: string, app: string, id: string) =>
  queryOptions({
    queryKey: [...testKeys.datasets(slug, app), id],
    queryFn: () => api.get<Dataset>(`${appApi(slug, app)}/datasets/${id}`),
  });

export const runListQuery = (slug: string, app: string, query: Partial<RunListQuery>) =>
  queryOptions({
    queryKey: testKeys.runList(slug, app, query),
    queryFn: () => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(compactRunListQuery(query))) {
        params.set(key, String(value));
      }
      const search = params.toString();
      return api.get<RunListPage>(`${appApi(slug, app)}/runs${search ? `?${search}` : ''}`);
    },
    placeholderData: keepPreviousData,
  });

const ACTIVE_RUN = new Set(['queued', 'running']);

export const runQuery = (slug: string, app: string, key: string) =>
  queryOptions({
    queryKey: testKeys.run(slug, app, key),
    queryFn: () => api.get<Run>(runApi(slug, app, key)),
    // Follow progress while the worker or testers are still executing.
    refetchInterval: (query) => (ACTIVE_RUN.has(query.state.data?.status ?? '') ? 2_000 : false),
  });

export const runItemQuery = (slug: string, app: string, key: string, itemId: string) =>
  queryOptions({
    queryKey: [...testKeys.run(slug, app, key), 'items', itemId],
    queryFn: () => api.get<RunItemDetail>(`${runApi(slug, app, key)}/items/${itemId}`),
    // An item opened while it is queued or executing shows its result once it has one.
    refetchInterval: (query) => (ACTIVE_RUN.has(query.state.data?.status ?? '') ? 2_000 : false),
  });

export const reportQuery = (slug: string, app: string, days: number) =>
  queryOptions({
    queryKey: testKeys.report(slug, app, days),
    queryFn: () => api.get<GlobalReport>(`${appApi(slug, app)}/reports/overview?days=${days}`),
  });

export const aiStatusQuery = (slug: string) =>
  queryOptions({
    queryKey: testKeys.aiStatus(slug),
    queryFn: () => api.get<AiStatus>(`/api/orgs/${slug}/llm/status`),
  });

export const llmSettingsQuery = (slug: string) =>
  queryOptions({
    queryKey: testKeys.llmSettings(slug),
    queryFn: () => api.get<LlmSettings | null>(`/api/orgs/${slug}/llm`),
  });

export const recordingQuery = (slug: string, app: string, id: string) =>
  queryOptions({
    queryKey: ['org', slug, 'app', app, 'recordings', id],
    queryFn: () => api.get<RecordingSession>(`${appApi(slug, app)}/recordings/${id}`),
    refetchInterval: (query) =>
      ['starting', 'active'].includes(query.state.data?.status ?? 'starting') ? 500 : false,
    staleTime: 0,
  });

/** Refetch everything about test cases, scenario counts and reports after a change. */
export function invalidateTestCases(slug: string, app: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: testKeys.testCases(slug, app) }),
    queryClient.invalidateQueries({ queryKey: keys.scenarios(slug, app) }),
    queryClient.invalidateQueries({ queryKey: testKeys.datasets(slug, app) }),
    queryClient.invalidateQueries({ queryKey: ['org', slug, 'app', app, 'tags'] }),
  ]);
}

export function invalidateRuns(slug: string, app: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: testKeys.runs(slug, app) }),
    queryClient.invalidateQueries({ queryKey: ['org', slug, 'app', app, 'report'] }),
    queryClient.invalidateQueries({ queryKey: testKeys.testCases(slug, app) }),
  ]);
}
