// Role and permission model shared by the API (enforcement) and the web app (hiding UI).

export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const APP_ROLES = ['manager', 'editor', 'tester', 'viewer'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const APP_PERMISSIONS = [
  'app.read',
  'execution.write',
  'testcase.write',
  'scenario.write',
  'comment.write',
  /** Delete other people's comments. */
  'comment.moderate',
  'app.manage',
] as const;
export type AppPermission = (typeof APP_PERMISSIONS)[number];

export const ORG_PERMISSIONS = [
  'org.read',
  'org.manage',
  'members.manage',
  'audit.read',
  'apps.create',
  'apps.archive',
] as const;
export type OrgPermission = (typeof ORG_PERMISSIONS)[number];

/** Mirrors the table in the access-control spec. */
const APP_ROLE_PERMISSIONS: Record<AppRole, readonly AppPermission[]> = {
  manager: [...APP_PERMISSIONS],
  editor: ['app.read', 'execution.write', 'testcase.write', 'scenario.write', 'comment.write'],
  tester: ['app.read', 'execution.write', 'comment.write'],
  viewer: ['app.read'],
};

const ORG_ROLE_PERMISSIONS: Record<OrgRole, readonly OrgPermission[]> = {
  owner: ORG_PERMISSIONS,
  admin: ORG_PERMISSIONS,
  member: ['org.read'],
};

/** Organization owners and admins manage every application implicitly. */
export function effectiveAppRole(
  orgRole: OrgRole,
  explicitRole: AppRole | null | undefined,
): AppRole | null {
  if (orgRole === 'owner' || orgRole === 'admin') return 'manager';
  return explicitRole ?? null;
}

export function appPermissionsFor(role: AppRole | null): AppPermission[] {
  return role ? [...APP_ROLE_PERMISSIONS[role]] : [];
}

export function orgPermissionsFor(role: OrgRole): OrgPermission[] {
  return [...ORG_ROLE_PERMISSIONS[role]];
}

export function hasAppPermission(role: AppRole | null, permission: AppPermission): boolean {
  return role !== null && APP_ROLE_PERMISSIONS[role].includes(permission);
}

export function hasOrgPermission(role: OrgRole, permission: OrgPermission): boolean {
  return ORG_ROLE_PERMISSIONS[role].includes(permission);
}
