// Small building blocks shared by the scenario grid, page, revisions and forms.
import {
  formatTag,
  type ScenarioPriority,
  type ScenarioStatus,
  type UserRef,
} from '@testrex/contracts';
import { Badge, cn, Tooltip } from '@testrex/ui';
import {
  ArrowDown,
  ArrowUp,
  ChevronsUp,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Equal,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import i18n, { formatDateTime } from '../lib/i18n';

const STATUS_ICONS = { draft: CircleDashed, ready: CircleCheck, deprecated: CircleSlash };
const STATUS_STYLES: Record<ScenarioStatus, string> = {
  draft: 'border-border bg-muted text-muted-foreground',
  ready: 'border-primary/40 bg-accent text-accent-foreground',
  deprecated: 'border-warning/40 text-warning',
};

/** Status with an icon and its name, so it never depends on color alone. */
export function StatusBadge({ status }: { status: ScenarioStatus }) {
  const { t } = useTranslation();
  const Icon = STATUS_ICONS[status];
  return (
    <Badge variant="outline" className={STATUS_STYLES[status]}>
      <Icon className="size-3.5" aria-hidden />
      {t(`scenario.status.${status}`)}
    </Badge>
  );
}

const PRIORITY_ICONS = { critical: ChevronsUp, high: ArrowUp, medium: Equal, low: ArrowDown };

export function PriorityLabel({ priority }: { priority: ScenarioPriority }) {
  const { t } = useTranslation();
  const Icon = PRIORITY_ICONS[priority];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-sm whitespace-nowrap',
        priority === 'critical' && 'font-medium text-destructive',
        priority === 'high' && 'font-medium',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {t(`scenario.priority.${priority}`)}
    </span>
  );
}

export function TagChip({ tag, onSelect }: { tag: string; onSelect?: (tag: string) => void }) {
  const { t } = useTranslation();
  const classes =
    'inline-flex max-w-40 items-center truncate rounded-md border bg-card px-1.5 py-0.5 font-mono text-xs';
  if (!onSelect) return <span className={classes}>{formatTag(tag)}</span>;
  return (
    <button
      type="button"
      className={cn(
        classes,
        'hover:border-primary/60 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(tag);
      }}
      title={t('scenarios.filterByTag', { tag: formatTag(tag) })}
    >
      {formatTag(tag)}
    </button>
  );
}

export const VISIBLE_TAGS = 2;
export const TOOLTIP_TAGS = 5;

/** The hidden tags listed by the `+N` tooltip (up to five) and how many remain beyond them. */
export function hiddenTags(tags: string[]): { listed: string[]; more: number } {
  const hidden = tags.slice(VISIBLE_TAGS);
  return { listed: hidden.slice(0, TOOLTIP_TAGS), more: Math.max(0, hidden.length - TOOLTIP_TAGS) };
}

/**
 * Up to two tag chips, then a `+N` badge whose tooltip (hover or keyboard focus) lists up to
 * five of the hidden tags and "and M more". Tags arrive sorted alphabetically.
 */
export function TagCell({ tags, onSelect }: { tags: string[]; onSelect?: (tag: string) => void }) {
  const { t } = useTranslation();
  const visible = tags.slice(0, VISIBLE_TAGS);
  const hidden = tags.length - visible.length;
  const { listed, more } = hiddenTags(tags);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((tag) => (
        <TagChip key={tag} tag={tag} onSelect={onSelect} />
      ))}
      {hidden > 0 ? (
        <Tooltip
          content={
            <span>
              {listed.map(formatTag).join(', ')}
              {more > 0 ? ` ${t('scenarios.andMore', { count: more })}` : ''}
            </span>
          }
        >
          <button
            type="button"
            aria-label={t('scenarios.moreTags', { count: hidden })}
            onClick={(event) => event.stopPropagation()}
            className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            +{hidden}
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 hours ago" / "hace 3 horas", in the interface language. */
export function formatRelative(value: string | Date, now = Date.now()): string {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  const format = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, 'minute');
}

export function userName(user: UserRef | null | undefined): string {
  return user?.name || i18n.t('common.deletedUser');
}

/** Relative time; the exact time (and who) on hover or keyboard focus. */
export function RelativeTime({ value, by }: { value: string; by?: UserRef }) {
  const { t } = useTranslation();
  const exact = formatDateTime(value);
  return (
    <Tooltip content={by ? t('common.timeBy', { time: exact, name: userName(by) }) : exact}>
      <time
        dateTime={value}
        tabIndex={0}
        className="whitespace-nowrap rounded-sm text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {formatRelative(value)}
      </time>
    </Tooltip>
  );
}

export function formatBytes(bytes: number): string {
  const format = (value: number, unit: string) =>
    `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value)} ${unit}`;
  if (bytes >= 1024 * 1024) return format(bytes / (1024 * 1024), 'MB');
  if (bytes >= 1024) return format(bytes / 1024, 'KB');
  return format(bytes, 'B');
}
