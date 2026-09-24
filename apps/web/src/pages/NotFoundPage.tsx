import { Button } from '@testrex/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CenteredLayout } from '../components/common';
import { meQuery } from '../lib/queries';

/** Shown for missing pages and for resources the user cannot access (same response by design). */
export function NotFoundContent() {
  const { t } = useTranslation();
  const me = useQuery({ ...meQuery, retry: false });
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <SearchX className="size-7" aria-hidden />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{t('notFound.title')}</h1>
      <p className="max-w-md text-muted-foreground">{t('notFound.body')}</p>
      <Button asChild>
        {me.data ? (
          <Link to="/">{t('notFound.home')}</Link>
        ) : (
          <Link to="/sign-in">{t('notFound.signIn')}</Link>
        )}
      </Button>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <CenteredLayout>
      <NotFoundContent />
    </CenteredLayout>
  );
}
