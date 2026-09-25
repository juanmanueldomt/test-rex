/**
 * Plan limits for the cloud edition. Self-hosted instances use the no-op implementation;
 * a billing-aware implementation can throw an ApiError (e.g. 402) to refuse an action.
 */
export type QuotaAction =
  'organization.create' | 'application.create' | 'member.add' | 'storage.upload';

export interface QuotaContext {
  organizationId?: string;
  plan?: string;
  /** `storage.upload`: size of the upload in bytes (an upper bound while it streams). */
  bytes?: number;
  /** `storage.upload`: bytes the organization already stores. */
  usageBytes?: number;
}

export interface QuotaService {
  check(action: QuotaAction, context: QuotaContext): Promise<void>;
}

export const unlimitedQuota: QuotaService = {
  async check() {
    // Self-hosted: no limits.
  },
};
