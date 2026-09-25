import { hasAppPermission } from '@testrex/contracts';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { attachmentResolver } from '../../components/editor/RichText';
import { appQuery } from '../../lib/queries';

/** What the current user may do with scenarios of this application. */
export function useScenarioAccess(orgSlug: string, appKey: string) {
  const app = useSuspenseQuery(appQuery(orgSlug, appKey)).data;
  const writable = !app.archivedAt;
  return {
    app,
    /** Create, edit, delete and restore scenarios; manage modules, tags, links, attachments. */
    canWrite: writable && hasAppPermission(app.role, 'scenario.write'),
    canComment: writable && hasAppPermission(app.role, 'comment.write'),
    canModerate: writable && hasAppPermission(app.role, 'comment.moderate'),
  };
}

/** Stable image resolver for `attachment:<id>` in this application. */
export function useAttachmentResolver(orgSlug: string, appKey: string) {
  return useMemo(() => attachmentResolver(orgSlug, appKey), [orgSlug, appKey]);
}
