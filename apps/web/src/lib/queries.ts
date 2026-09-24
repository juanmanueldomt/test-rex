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
import { queryOptions, QueryClient } from '@tanstack/react-query';
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
