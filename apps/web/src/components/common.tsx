import type { AppRole, OrgRole } from '@testrex/contracts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Input,
  NativeSelect,
} from '@testrex/ui';
import { Check, Copy, Languages, Moon, Sun } from 'lucide-react';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { LANGUAGES, setLanguage, type Language } from '../lib/i18n';
import { useTheme } from '../lib/theme';

export function Logo({ className = 'h-10 w-auto' }: { className?: string }) {
  const [theme] = useTheme();
  return (
    <img
      src={theme === 'dark' ? '/logo-dark.svg' : '/logo.svg'}
      alt="testRex"
      className={className}
    />
  );
}

export function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, toggle] = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={theme === 'dark' ? t('shell.lightTheme') : t('shell.darkTheme')}
      title={theme === 'dark' ? t('shell.lightTheme') : t('shell.darkTheme')}
    >
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  );
}

export function LanguageSelect() {
  const { t, i18n } = useTranslation();
  return (
    <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Languages className="size-4" aria-hidden />
      <span className="sr-only">{t('shell.language')}</span>
      <NativeSelect
        className="h-8 w-auto border-transparent bg-transparent shadow-none"
        value={i18n.language}
        onChange={(event) => setLanguage(event.target.value as Language)}
      >
        {LANGUAGES.map((language) => (
          <option key={language.code} value={language.code}>
            {language.label}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="grid gap-1">
        {eyebrow}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function RoleSelect<R extends OrgRole | AppRole>({
  roles,
  value,
  onChange,
  includeNone,
  ...props
}: Omit<ComponentProps<typeof NativeSelect>, 'value' | 'onChange'> & {
  roles: readonly R[];
  value: R | null;
  onChange: (role: R | null) => void;
  includeNone?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <NativeSelect
      value={value ?? ''}
      onChange={(event) => onChange((event.target.value || null) as R | null)}
      {...props}
    >
      {includeNone ? <option value="">{t('roles.none')}</option> : null}
      {roles.map((role) => (
        <option key={role} value={role}>
          {t(`roles.${role}`)}
        </option>
      ))}
    </NativeSelect>
  );
}

export function CopyField({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(t('common.copied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the field stays selectable for manual copying.
    }
  };
  return (
    <div className="flex gap-2">
      <Input
        readOnly
        value={value}
        aria-label={label}
        className="font-mono text-xs"
        onFocus={(event) => event.currentTarget.select()}
      />
      <Button
        type="button"
        variant="outline"
        onClick={copy}
        aria-label={`${t('common.copy')}: ${label}`}
      >
        {copied ? <Check /> : <Copy />}
        {t('common.copy')}
      </Button>
    </div>
  );
}

/** A button that asks for confirmation before running a destructive action. */
export function ConfirmButton({
  title,
  description,
  confirmLabel,
  onConfirm,
  children,
  destructive = true,
  ...buttonProps
}: ComponentProps<typeof Button> & {
  title: string;
  description?: string;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button {...buttonProps}>{children}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        <div className="flex justify-end gap-2">
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction destructive={destructive} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Centered layout for pages outside an organization (sign-in, invitations, onboarding). */
export function CenteredLayout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <a href="/" aria-label="testRex">
          <Logo />
        </a>
        <div className="flex items-center gap-1">
          <LanguageSelect />
          <ThemeToggle />
        </div>
      </header>
      <main
        id="content"
        className="flex flex-1 items-start justify-center px-4 pb-16 pt-8 sm:pt-16"
      >
        <div className={wide ? 'w-full max-w-2xl' : 'w-full max-w-md'}>{children}</div>
      </main>
    </div>
  );
}
