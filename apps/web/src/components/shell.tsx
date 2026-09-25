import { hasOrgPermission } from '@testrex/contracts';
import {
  Avatar,
  Badge,
  Button,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Kbd,
} from '@testrex/ui';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useParams } from '@tanstack/react-router';
import {
  AppWindow,
  Building2,
  Check,
  ChevronsUpDown,
  Keyboard,
  Languages,
  LayoutGrid,
  LogOut,
  Moon,
  Plus,
  Search,
  Settings,
  UserPlus,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { signOut } from '../lib/auth';
import { setLanguage } from '../lib/i18n';
import { useOpenShortcutHelp, useShortcut, useSingleKeyShortcuts } from '../lib/shortcuts';
import { appsQuery, meQuery, orgQuery } from '../lib/queries';
import { useTheme } from '../lib/theme';
import { Logo, ThemeToggle } from './common';

function useSignOut() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return async () => {
    await signOut().catch(() => {});
    queryClient.clear();
    await navigate({ to: '/sign-in' });
  };
}

function OrgSwitcher({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation();
  const me = useSuspenseQuery(meQuery).data;
  const org = useSuspenseQuery(orgQuery(orgSlug)).data;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="max-w-56 gap-2 px-2" aria-label={t('shell.switchOrg')}>
          <Building2 className="text-muted-foreground" />
          <span className="truncate font-semibold">{org.name}</span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{t('shell.organizations')}</DropdownMenuLabel>
        {me.organizations.map((item) => (
          <DropdownMenuItem key={item.id} asChild>
            <Link to="/o/$orgSlug" params={{ orgSlug: item.slug }}>
              <span className="flex-1 truncate">{item.name}</span>
              {item.slug === orgSlug ? <Check aria-label="current" /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/onboarding">
            <Plus /> {t('shell.createOrg')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AppSwitcher({ orgSlug, appKey }: { orgSlug: string; appKey?: string }) {
  const { t } = useTranslation();
  const apps = useQuery(appsQuery(orgSlug)).data ?? [];
  const org = useSuspenseQuery(orgQuery(orgSlug)).data;
  const current = apps.find((app) => app.key === appKey);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="max-w-56 gap-2 px-2" aria-label={t('shell.switchApp')}>
          <AppWindow className="text-muted-foreground" />
          <span className="truncate">{current ? current.name : t('shell.applications')}</span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{t('shell.applications')}</DropdownMenuLabel>
        {apps.map((app) => (
          <DropdownMenuItem key={app.id} asChild>
            <Link to="/o/$orgSlug/a/$appKey" params={{ orgSlug, appKey: app.key }}>
              <Badge variant="key">{app.key}</Badge>
              <span className="flex-1 truncate">{app.name}</span>
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/o/$orgSlug" params={{ orgSlug }}>
            <LayoutGrid /> {t('shell.allApps')}
          </Link>
        </DropdownMenuItem>
        {hasOrgPermission(org.role, 'apps.create') ? (
          <DropdownMenuItem asChild>
            <Link to="/o/$orgSlug" params={{ orgSlug }} search={{ new: 'app' }}>
              <Plus /> {t('shell.newApp')}
            </Link>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { t, i18n } = useTranslation();
  const me = useSuspenseQuery(meQuery).data;
  const handleSignOut = useSignOut();
  const openShortcutHelp = useOpenShortcutHelp();
  const [singleKeys, setSingleKeys] = useSingleKeyShortcuts();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label={t('shell.account')}
        >
          <Avatar name={me.user.name} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="grid gap-0.5">
          <span className="text-sm font-medium text-foreground">{me.user.name}</span>
          <span className="font-normal">{me.user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('shell.language')}</DropdownMenuLabel>
        {(['en', 'es'] as const).map((code) => (
          <DropdownMenuItem key={code} onSelect={() => setLanguage(code)}>
            <Languages />
            <span className="flex-1">{code === 'en' ? 'English' : 'Español'}</span>
            {i18n.language === code ? <Check aria-label="current" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={openShortcutHelp}>
          <Keyboard /> {t('shortcuts.title')}
          <Kbd className="ml-auto">?</Kbd>
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem checked={singleKeys} onCheckedChange={setSingleKeys}>
          {t('shortcuts.singleKeys')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void handleSignOut()}>
          <LogOut /> {t('auth.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CommandMenu({
  orgSlug,
  open,
  onOpenChange,
}: {
  orgSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const me = useSuspenseQuery(meQuery).data;
  const org = useSuspenseQuery(orgQuery(orgSlug)).data;
  const apps = useQuery(appsQuery(orgSlug)).data ?? [];
  const [, toggleTheme] = useTheme();
  const handleSignOut = useSignOut();

  const run = (action: () => unknown) => {
    onOpenChange(false);
    void action();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={t('command.title')}>
      <CommandInput placeholder={t('command.placeholder')} />
      <CommandList>
        <CommandEmpty>{t('command.empty')}</CommandEmpty>
        {apps.length > 0 ? (
          <CommandGroup heading={t('command.applications')}>
            {apps.map((app) => (
              <CommandItem
                key={app.id}
                value={`app ${app.key} ${app.name}`}
                onSelect={() =>
                  run(() =>
                    navigate({ to: '/o/$orgSlug/a/$appKey', params: { orgSlug, appKey: app.key } }),
                  )
                }
              >
                <AppWindow />
                <Badge variant="key">{app.key}</Badge>
                {app.name}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        <CommandGroup heading={t('command.organizations')}>
          {me.organizations.map((item) => (
            <CommandItem
              key={item.id}
              value={`org ${item.slug} ${item.name}`}
              onSelect={() =>
                run(() => navigate({ to: '/o/$orgSlug', params: { orgSlug: item.slug } }))
              }
            >
              <Building2 />
              {item.name}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading={t('command.actions')}>
          {hasOrgPermission(org.role, 'apps.create') ? (
            <CommandItem
              onSelect={() =>
                run(() =>
                  navigate({ to: '/o/$orgSlug', params: { orgSlug }, search: { new: 'app' } }),
                )
              }
            >
              <Plus /> {t('command.newApp')}
            </CommandItem>
          ) : null}
          {hasOrgPermission(org.role, 'members.manage') ? (
            <CommandItem
              onSelect={() =>
                run(() =>
                  navigate({
                    to: '/o/$orgSlug/settings',
                    params: { orgSlug },
                    search: { tab: 'invitations' },
                  }),
                )
              }
            >
              <UserPlus /> {t('command.inviteMembers')}
            </CommandItem>
          ) : null}
          <CommandItem
            onSelect={() =>
              run(() =>
                navigate({
                  to: '/o/$orgSlug/settings',
                  params: { orgSlug },
                  search: { tab: 'general' },
                }),
              )
            }
          >
            <Settings /> {t('command.orgSettings')}
          </CommandItem>
          <CommandItem onSelect={() => run(toggleTheme)}>
            <Moon /> {t('command.toggleTheme')}
          </CommandItem>
          <CommandItem
            onSelect={() => run(() => setLanguage(i18n.language === 'es' ? 'en' : 'es'))}
          >
            <Languages /> {t('command.switchLanguage')}
          </CommandItem>
          <CommandItem onSelect={() => run(handleSignOut)}>
            <LogOut /> {t('command.signOut')}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

/** Layout for everything inside an organization: top bar, ⌘K menu and page content. */
export function OrgLayout() {
  const { t } = useTranslation();
  const { orgSlug, appKey } = useParams({ strict: false }) as { orgSlug: string; appKey?: string };
  const [commandOpen, setCommandOpen] = useState(false);
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

  useShortcut({
    keys: '$mod+k',
    description: t('shortcuts.commandMenu'),
    group: 'general',
    allowInInputs: true,
    handler: () => setCommandOpen((open) => !open),
  });

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow"
      >
        {t('shell.skipToContent')}
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
        <nav
          aria-label={t('shell.mainNav')}
          className="mx-auto flex h-14 max-w-7xl items-center gap-1 px-4"
        >
          <Link
            to="/o/$orgSlug"
            params={{ orgSlug }}
            className="mr-2 shrink-0"
            aria-label="testRex"
          >
            <Logo className="h-9 w-auto" />
          </Link>
          <OrgSwitcher orgSlug={orgSlug} />
          <span className="text-muted-foreground" aria-hidden>
            /
          </span>
          <AppSwitcher orgSlug={orgSlug} appKey={appKey} />
          <div className="flex-1" />
          <Button
            variant="outline"
            className="hidden w-64 justify-start gap-2 text-muted-foreground md:inline-flex"
            onClick={() => setCommandOpen(true)}
          >
            <Search />
            <span className="flex-1 text-left">{t('shell.search')}</span>
            <Kbd>{isMac ? '⌘' : 'Ctrl'} K</Kbd>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={t('shell.search')}
            onClick={() => setCommandOpen(true)}
          >
            <Search />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            asChild
            aria-label={t('command.orgSettings')}
            title={t('command.orgSettings')}
          >
            <Link to="/o/$orgSlug/settings" params={{ orgSlug }} search={{ tab: 'general' }}>
              <Settings />
            </Link>
          </Button>
          <ThemeToggle />
          <UserMenu />
        </nav>
      </header>
      <main
        id="content"
        tabIndex={-1}
        className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 focus:outline-none"
      >
        <Outlet />
      </main>
      <CommandMenu orgSlug={orgSlug} open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  );
}
