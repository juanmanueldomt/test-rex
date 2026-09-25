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
