import {
  AUDIT_ACTIONS,
  createInvitationSchema,
  hasOrgPermission,
  ORG_ROLES,
  renameOrgSchema,
  SCENARIO_PRIORITIES,
  SCENARIO_STATUSES,
  type AuditEvent,
  type CreateInvitationResponse,
  type OrgContext,
  type OrgRole,
} from '@testrex/contracts';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  Input,
  NativeSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@testrex/ui';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { LogOut, UserMinus, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmButton, CopyField, PageHeader, RoleSelect } from '../components/common';
import { api, errorMessage } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/i18n';
import {
  fetchAudit,
  invitationsQuery,
  keys,
  meQuery,
  membersQuery,
  orgQuery,
  type AuditFilters,
} from '../lib/queries';
import { validate, type FieldErrors } from '../lib/validation';

export type OrgSettingsTab = 'general' | 'members' | 'invitations' | 'audit';

function GeneralSection({ org }: { org: OrgContext }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const editable = hasOrgPermission(org.role, 'org.manage');
  const [name, setName] = useState(org.name);
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useMutation({
    mutationFn: () => api.patch<OrgContext>(`/api/orgs/${org.slug}`, { name }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(orgQuery(org.slug).queryKey, updated);
      await queryClient.invalidateQueries({ queryKey: keys.me });
      toast.success(t('common.saved'));
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validate(renameOrgSchema, { name });
    setErrors(result.errors ?? {});
    if (result.data) save.mutate();
  };
  return (
    <Card>
      <form onSubmit={submit} noValidate>
        <CardHeader>
          <CardTitle>{t('orgSettings.general')}</CardTitle>
          {!editable ? <CardDescription>{t('orgSettings.readOnly')}</CardDescription> : null}
        </CardHeader>
        <CardContent className="grid max-w-xl gap-4">
          {save.isError ? <Alert variant="destructive">{errorMessage(save.error)}</Alert> : null}
          <Field label={t('orgSettings.name')} error={errors.name}>
            {(control) => (
              <Input
                {...control}
                disabled={!editable}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('orgSettings.slug')} hint={t('orgSettings.slugLocked')}>
            {(control) => (
              <Input {...control} readOnly value={`/o/${org.slug}`} className="font-mono" />
            )}
          </Field>
        </CardContent>
        {editable ? (
          <CardFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
}

function MembersSection({ org }: { org: OrgContext }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const me = useSuspenseQuery(meQuery).data;
  const members = useQuery(membersQuery(org.slug));
  const canManage = hasOrgPermission(org.role, 'members.manage');

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: membersQuery(org.slug).queryKey });
  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; name: string; role: OrgRole }) =>
      api.patch(`/api/orgs/${org.slug}/members/${userId}`, { role }),
    onSuccess: async (_d, v) => {
      toast.success(t('members.roleChanged', { name: v.name, role: t(`roles.${v.role}`) }));
      await refresh();
    },
    onError: async (error) => {
      toast.error(errorMessage(error));
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: ({ userId }: { userId: string; name: string }) =>
      api.delete(`/api/orgs/${org.slug}/members/${userId}`),
    onSuccess: async (_d, v) => {
      if (v.userId === me.user.id) {
        toast.success(t('members.left', { org: org.name }));
        await queryClient.invalidateQueries();
        await navigate({ to: '/' });
        return;
      }
      toast.success(t('members.removed', { name: v.name }));
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  /** Owners manage everyone; admins everyone but owners. */
  const canEdit = (role: OrgRole) => canManage && (org.role === 'owner' || role !== 'owner');
  const assignable = org.role === 'owner' ? ORG_ROLES : ORG_ROLES.filter((r) => r !== 'owner');

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {members.data ? t('members.count', { count: members.data.length }) : t('common.loading')}
        </p>
        <ConfirmButton
          variant="outline"
          title={t('members.leaveConfirm', { org: org.name })}
          description={t('members.leaveBody')}
          confirmLabel={t('members.leave')}
          onConfirm={() => remove.mutate({ userId: me.user.id, name: me.user.name })}
        >
          <LogOut /> {t('members.leave')}
        </ConfirmButton>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('members.name')}</TableHead>
            <TableHead className="w-48">{t('members.role')}</TableHead>
            <TableHead className="hidden w-32 sm:table-cell">{t('members.joined')}</TableHead>
            {canManage ? (
              <TableHead className="w-12">
                <span className="sr-only">{t('members.remove')}</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {(members.data ?? []).map((member) => {
            const isMe = member.userId === me.user.id;
            return (
              <TableRow key={member.userId}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar name={member.name} />
                    <div className="grid">
                      <span className="font-medium">
                        {member.name}{' '}
                        {isMe ? (
                          <span className="text-muted-foreground">({t('common.you')})</span>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">{member.email}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {canEdit(member.role) ? (
                    <RoleSelect
                      aria-label={t('members.roleFor', { name: member.name })}
                      roles={member.role === 'owner' ? ORG_ROLES : assignable}
                      value={member.role}
                      disabled={changeRole.isPending}
                      onChange={(role) =>
                        role &&
                        changeRole.mutate({ userId: member.userId, name: member.name, role })
                      }
                    />
                  ) : (
                    <Badge variant={member.role === 'member' ? 'muted' : 'default'}>
                      {t(`roles.${member.role}`)}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">
                  {formatDate(member.joinedAt)}
                </TableCell>
                {canManage ? (
                  <TableCell>
                    {!isMe && canEdit(member.role) ? (
                      <ConfirmButton
                        variant="ghost"
                        size="icon"
                        aria-label={`${t('members.remove')} ${member.name}`}
                        title={t('members.removeConfirm', { name: member.name, org: org.name })}
                        description={t('members.removeBody')}
                        confirmLabel={t('members.remove')}
                        onConfirm={() =>
                          remove.mutate({ userId: member.userId, name: member.name })
                        }
                      >
                        <UserMinus />
                      </ConfirmButton>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function InvitationsSection({ org }: { org: OrgContext }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const invitations = useQuery(invitationsQuery(org.slug));
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [shared, setShared] = useState<{ email: string; link: string } | null>(null);
  const roles = org.role === 'owner' ? ORG_ROLES : ORG_ROLES.filter((r) => r !== 'owner');

  const invite = useMutation({
    mutationFn: () =>
      api.post<CreateInvitationResponse>(`/api/orgs/${org.slug}/invitations`, { email, role }),
    onSuccess: async (result) => {
      if (result.link) setShared({ email: result.invitation.email, link: result.link });
      else toast.success(t('invitations.emailed', { email: result.invitation.email }));
      setEmail('');
      await queryClient.invalidateQueries({ queryKey: invitationsQuery(org.slug).queryKey });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/api/orgs/${org.slug}/invitations/${id}`),
    onSuccess: async () => {
      toast.success(t('invitations.revoked'));
      await queryClient.invalidateQueries({ queryKey: invitationsQuery(org.slug).queryKey });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShared(null);
    const result = validate(createInvitationSchema, { email, role });
    setErrors(result.errors ?? {});
    if (result.data) invite.mutate();
  };

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('invitations.title')}</CardTitle>
          <CardDescription>{t('invitations.body')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form
            className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
            onSubmit={submit}
            noValidate
          >
            <Field label={t('invitations.email')} error={errors.email}>
              {(control) => (
                <Input
                  {...control}
                  type="email"
                  placeholder="teammate@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('invitations.role')}>
              {(control) => (
                <RoleSelect
                  {...control}
                  roles={roles}
                  value={role}
                  onChange={(r) => r && setRole(r)}
                />
              )}
            </Field>
            <Button type="submit" disabled={invite.isPending}>
              <UserPlus /> {invite.isPending ? t('invitations.sending') : t('invitations.send')}
            </Button>
          </form>
          {invite.isError ? (
            <Alert variant="destructive">{errorMessage(invite.error)}</Alert>
          ) : null}
          {shared ? (
            <Alert variant="info" className="grid gap-3">
              <div className="grid gap-1">
                <p className="font-medium">{t('invitations.linkTitle')}</p>
                <p>{t('invitations.linkBody', { email: shared.email })}</p>
              </div>
              <CopyField value={shared.link} label={t('invitations.link')} />
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <section className="grid gap-3" aria-labelledby="pending-invitations">
        <h2 id="pending-invitations" className="font-semibold">
          {t('invitations.pending')}
        </h2>
        {invitations.data && invitations.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('invitations.none')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('invitations.email')}</TableHead>
                <TableHead>{t('invitations.role')}</TableHead>
                <TableHead />
                <TableHead className="w-24">
                  <span className="sr-only">{t('invitations.revoke')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(invitations.data ?? []).map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.email}</TableCell>
                  <TableCell>{t(`roles.${item.role}`)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.status === 'expired' ? (
                      <Badge variant="warning">{t('invitations.expired')}</Badge>
                    ) : (
                      t('invitations.expires', { date: formatDate(item.expiresAt) })
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revoke.mutate(item.id)}
                      aria-label={`${t('invitations.revoke')} ${item.email}`}
                    >
                      {t('invitations.revoke')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

const ROLE_VALUES = new Set(['owner', 'admin', 'member', 'manager', 'editor', 'tester', 'viewer']);

const STATUS_VALUES = new Set<string>(SCENARIO_STATUSES);
const PRIORITY_VALUES = new Set<string>(SCENARIO_PRIORITIES);

function formatValue(value: unknown, t: (key: string) => string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) {
    return value.length ? value.map((item) => formatValue(item, t)).join(', ') : '—';
  }
  if (typeof value === 'boolean') return value ? t('audit.yes') : t('audit.no');
  if (typeof value === 'string' && ROLE_VALUES.has(value)) return t(`roles.${value}`);
  if (typeof value === 'string' && STATUS_VALUES.has(value)) return t(`scenario.status.${value}`);
  if (typeof value === 'string' && PRIORITY_VALUES.has(value)) {
    return t(`scenario.priority.${value}`);
  }
  return String(value);
}

/** "Ana García <ana@example.com>" → name and email on separate lines. */
function PersonLabel({ label }: { label: string }) {
  const match = /^(.*) <(.+)>$/.exec(label);
  if (!match) return <span>{label}</span>;
  return (
    <div className="grid">
      <span>{match[1]}</span>
      <span className="text-xs text-muted-foreground">{match[2]}</span>
    </div>
  );
}

function AuditRow({ event }: { event: AuditEvent }) {
  const { t } = useTranslation();
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatDateTime(event.createdAt)}
      </TableCell>
      <TableCell>
        <PersonLabel label={event.actor.label} />
      </TableCell>
      <TableCell>{t(`audit.actions.${event.action}`, { defaultValue: event.action })}</TableCell>
      <TableCell>{event.target.label ? <PersonLabel label={event.target.label} /> : '—'}</TableCell>
      <TableCell className="text-muted-foreground">
        {Object.entries(event.changes).map(([rawField, change]) => {
          const fieldKey = rawField.startsWith('role:') ? 'role' : rawField;
          const field = t(`audit.fields.${fieldKey}`, { defaultValue: rawField });
          const from = formatValue(change.from, t);
          const to = formatValue(change.to, t);
          return (
            <div key={rawField}>
              {change.from === null
                ? t('audit.set', { field, to })
                : t('audit.change', { field, from, to })}
            </div>
          );
        })}
      </TableCell>
    </TableRow>
  );
}

function AuditSection({ org }: { org: OrgContext }) {
  const { t } = useTranslation();
  const members = useQuery(membersQuery(org.slug));
  const [filters, setFilters] = useState<AuditFilters>({});
  const audit = useInfiniteQuery({
    queryKey: keys.audit(org.slug, filters),
    queryFn: ({ pageParam }) => fetchAudit(org.slug, filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const events = audit.data?.pages.flatMap((page) => page.events) ?? [];
  const dayStart = (date: string) =>
    date ? new Date(`${date}T00:00:00`).toISOString() : undefined;
  const dayEnd = (date: string) =>
    date ? new Date(`${date}T23:59:59.999`).toISOString() : undefined;

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('audit.body')}</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={t('audit.actor')}>
          {(control) => (
            <NativeSelect
              {...control}
              value={filters.actorId ?? ''}
              onChange={(e) => setFilters({ ...filters, actorId: e.target.value || undefined })}
            >
              <option value="">{t('audit.anyone')}</option>
              {(members.data ?? []).map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label={t('audit.action')}>
          {(control) => (
            <NativeSelect
              {...control}
              value={filters.action ?? ''}
              onChange={(e) => setFilters({ ...filters, action: e.target.value || undefined })}
            >
              <option value="">{t('audit.anyAction')}</option>
              {AUDIT_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {t(`audit.actions.${action}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label={t('audit.from')}>
          {(control) => (
            <Input
              {...control}
              type="date"
              onChange={(e) => setFilters({ ...filters, from: dayStart(e.target.value) })}
            />
          )}
        </Field>
        <Field label={t('audit.to')}>
          {(control) => (
            <Input
              {...control}
              type="date"
              onChange={(e) => setFilters({ ...filters, to: dayEnd(e.target.value) })}
            />
          )}
        </Field>
      </div>
      {audit.isError ? <Alert variant="destructive">{errorMessage(audit.error)}</Alert> : null}
      {audit.isSuccess && events.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('audit.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">{t('audit.when')}</TableHead>
              <TableHead>{t('audit.actor')}</TableHead>
              <TableHead>{t('audit.action')}</TableHead>
              <TableHead>{t('audit.target')}</TableHead>
              <TableHead>{t('audit.details')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <AuditRow key={event.id} event={event} />
            ))}
          </TableBody>
        </Table>
      )}
      {audit.hasNextPage ? (
        <Button
          variant="outline"
          className="justify-self-center"
          onClick={() => void audit.fetchNextPage()}
          disabled={audit.isFetchingNextPage}
        >
          {t('audit.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}

export function OrgSettingsPage({ orgSlug, tab }: { orgSlug: string; tab: OrgSettingsTab }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const org = useSuspenseQuery(orgQuery(orgSlug)).data;
  const canManage = hasOrgPermission(org.role, 'members.manage');
  const canAudit = hasOrgPermission(org.role, 'audit.read');
  const visible = (['general', 'members', 'invitations', 'audit'] as const).filter(
    (item) => (item !== 'invitations' || canManage) && (item !== 'audit' || canAudit),
  );
  const current = visible.includes(tab) ? tab : 'general';

  return (
    <>
      <PageHeader title={t('orgSettings.title')} description={org.name} />
      <Tabs
        value={current}
        onValueChange={(value) =>
          void navigate({
            to: '/o/$orgSlug/settings',
            params: { orgSlug },
            search: { tab: value as OrgSettingsTab },
            replace: true,
          })
        }
      >
        <TabsList>
          {visible.map((item) => (
            <TabsTrigger key={item} value={item}>
              {t(`orgSettings.${item}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="general">
          <GeneralSection key={org.name} org={org} />
        </TabsContent>
        <TabsContent value="members">
          <MembersSection org={org} />
        </TabsContent>
        {canManage ? (
          <TabsContent value="invitations">
            <InvitationsSection org={org} />
          </TabsContent>
        ) : null}
        {canAudit ? (
          <TabsContent value="audit">
            <AuditSection org={org} />
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}
