import { Label as LabelPrimitive } from 'radix-ui';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../cn';

const fieldClasses =
  'flex w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-destructive/40';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(fieldClasses, 'h-9 py-1', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(fieldClasses, 'min-h-20 py-2', className)} {...props} />;
}

/** Native select: keyboard- and screen-reader-friendly everywhere, styled to match inputs. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(fieldClasses, 'h-9 py-1 pr-8', className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn('text-sm font-medium leading-none peer-disabled:opacity-70', className)}
      {...props}
    />
  );
}

export interface FieldProps {
  label: ReactNode;
  /** Help text shown under the control. */
  hint?: ReactNode;
  /** Validation message; marks the control invalid and is announced by screen readers. */
  error?: ReactNode;
  className?: string;
  children: (control: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
  }) => ReactNode;
}

/** Label + control + hint/error wired together for accessibility. */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        'aria-invalid': Boolean(error),
        'aria-describedby': [errorId, hintId].filter(Boolean).join(' ') || undefined,
      })}
      {error ? (
        <p id={errorId} className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
