// Text diff of Markdown between two revisions: line diff, refined to words inside changed
// blocks. Added and removed content is marked with +/− gutters and <ins>/<del>, so meaning
// never depends on color alone.
import { cn } from '@testrex/ui';
import { diffLines, diffWords, type Change } from 'diff';
import { useTranslation } from 'react-i18next';

export type DiffRow =
  | { kind: 'same'; text: string }
  | { kind: 'removed' | 'added'; parts: { text: string; changed: boolean }[] };

function lines(value: string): string[] {
  const result = value.split('\n');
  if (result.at(-1) === '') result.pop();
  return result;
}

/** Rows for rendering: unchanged lines, and removed/added blocks with word-level emphasis. */
export function diffRows(before: string, after: string): DiffRow[] {
  const changes: Change[] = diffLines(before, after);
  const rows: DiffRow[] = [];
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index]!;
    const next = changes[index + 1];
    if (change.removed && next?.added) {
      // A replaced block: show which words changed on each side.
      const words = diffWords(change.value.replace(/\n$/, ''), next.value.replace(/\n$/, ''));
      rows.push({
        kind: 'removed',
        parts: words
          .filter((word) => !word.added)
          .map((word) => ({ text: word.value, changed: Boolean(word.removed) })),
      });
      rows.push({
        kind: 'added',
        parts: words
          .filter((word) => !word.removed)
          .map((word) => ({ text: word.value, changed: Boolean(word.added) })),
      });
      index++;
    } else if (change.added || change.removed) {
      for (const line of lines(change.value)) {
        rows.push({
          kind: change.added ? 'added' : 'removed',
          parts: [{ text: line, changed: true }],
        });
      }
    } else {
      for (const line of lines(change.value)) rows.push({ kind: 'same', text: line });
    }
  }
  return rows;
}

export function TextDiff({
  before,
  after,
  label,
}: {
  before: string;
  after: string;
  label: string;
}) {
  const { t } = useTranslation();
  const rows = diffRows(before, after);
  return (
    <div
      role="region"
      aria-label={label}
      className="overflow-x-auto rounded-md border bg-card font-mono text-xs leading-relaxed"
    >
      {rows.map((row, index) => {
        if (row.kind === 'same') {
          return (
            <div key={index} className="flex">
              <span
                className="w-6 shrink-0 select-none text-center text-muted-foreground"
                aria-hidden
              >
                {' '}
              </span>
              <span className="whitespace-pre-wrap break-words px-2">{row.text || ' '}</span>
            </div>
          );
        }
        const added = row.kind === 'added';
        const Mark = added ? 'ins' : 'del';
        return (
          <div
            key={index}
            data-diff={row.kind}
            className={cn('flex', added ? 'bg-primary/10' : 'bg-destructive/10')}
          >
            <span
              className={cn(
                'w-6 shrink-0 select-none text-center font-bold',
                added ? 'text-primary' : 'text-destructive',
              )}
              aria-hidden
            >
              {added ? '+' : '−'}
            </span>
            <span className="whitespace-pre-wrap break-words px-2">
              <span className="sr-only">{added ? t('compare.added') : t('compare.removed')}: </span>
              {row.parts.map((part, partIndex) =>
                part.changed ? (
                  <Mark
                    key={partIndex}
                    className={cn(
                      'rounded-sm',
                      added
                        ? 'bg-primary/25 no-underline decoration-primary'
                        : 'bg-destructive/25 line-through decoration-destructive',
                    )}
                  >
                    {part.text}
                  </Mark>
                ) : (
                  <span key={partIndex}>{part.text}</span>
                ),
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
