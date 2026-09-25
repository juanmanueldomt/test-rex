import { describe, expect, it } from 'vitest';
import {
  APP_PERMISSIONS,
  APP_ROLES,
  appPermissionsFor,
  effectiveAppRole,
  hasAppPermission,
  hasOrgPermission,
  ORG_PERMISSIONS,
  ORG_ROLES,
  type AppPermission,
  type AppRole,
  type OrgPermission,
  type OrgRole,
} from './permissions';

// The access-control spec table, cell by cell.
const SPEC_TABLE: Record<AppPermission, Record<AppRole, boolean>> = {
  'app.read': { manager: true, editor: true, tester: true, viewer: true },
  'execution.write': { manager: true, editor: true, tester: true, viewer: false },
  'testcase.write': { manager: true, editor: true, tester: false, viewer: false },
  'scenario.write': { manager: true, editor: true, tester: false, viewer: false },
  'comment.write': { manager: true, editor: true, tester: true, viewer: false },
  'comment.moderate': { manager: true, editor: false, tester: false, viewer: false },
  'app.manage': { manager: true, editor: false, tester: false, viewer: false },
};

const ORG_TABLE: Record<OrgPermission, Record<OrgRole, boolean>> = {
  'org.read': { owner: true, admin: true, member: true },
  'org.manage': { owner: true, admin: true, member: false },
  'members.manage': { owner: true, admin: true, member: false },
  'audit.read': { owner: true, admin: true, member: false },
  'apps.create': { owner: true, admin: true, member: false },
  'apps.archive': { owner: true, admin: true, member: false },
};

describe('application permissions', () => {
  const cells = APP_PERMISSIONS.flatMap((permission) =>
    APP_ROLES.map((role) => ({ role, permission, allowed: SPEC_TABLE[permission][role] })),
  );

  it.each(cells)('$role → $permission = $allowed', ({ role, permission, allowed }) => {
    expect(hasAppPermission(role, permission)).toBe(allowed);
    expect(appPermissionsFor(role).includes(permission)).toBe(allowed);
  });

  it('no role means no permissions', () => {
    for (const permission of APP_PERMISSIONS)
      expect(hasAppPermission(null, permission)).toBe(false);
    expect(appPermissionsFor(null)).toEqual([]);
  });
});

describe('organization permissions', () => {
  const cells = ORG_PERMISSIONS.flatMap((permission) =>
    ORG_ROLES.map((role) => ({ role, permission, allowed: ORG_TABLE[permission][role] })),
  );

  it.each(cells)('$role → $permission = $allowed', ({ role, permission, allowed }) => {
    expect(hasOrgPermission(role, permission)).toBe(allowed);
  });
});

describe('effectiveAppRole', () => {
  it.each(['owner', 'admin'] as const)('%s is an implicit manager of every application', (org) => {
    expect(effectiveAppRole(org, null)).toBe('manager');
    expect(effectiveAppRole(org, 'viewer')).toBe('manager');
  });

  it.each(APP_ROLES)('member with explicit %s role keeps it', (role) => {
    expect(effectiveAppRole('member', role)).toBe(role);
  });

  it('member without an application role has no access', () => {
    expect(effectiveAppRole('member', null)).toBeNull();
    expect(effectiveAppRole('member', undefined)).toBeNull();
  });
});
