/**
 * Plan limits for the cloud edition. Self-hosted instances use the no-op implementation;
 * a billing-aware implementation can throw an ApiError (e.g. 402) to refuse an action.
 */
export type QuotaAction = 'organization.create' | 'application.create' | 'member.add';

export interface QuotaService {
  check(action: QuotaAction, context: { organizationId?: string; plan?: string }): Promise<void>;
}

export const unlimitedQuota: QuotaService = {
  async check() {
    // Self-hosted: no limits.
  },
};
