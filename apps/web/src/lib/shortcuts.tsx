// Keyboard shortcut registry: pages register shortcuts with useShortcut, one tinykeys listener
// dispatches them, and the `?` dialog lists whatever is active on the current page.
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Kbd,
  Label,
} from '@testrex/ui';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { tinykeys } from 'tinykeys';
import {
  displayKeys,
  isEditableTarget,
  isEscapeBinding,
  isSingleKeyBinding,
  setSingleKeyShortcutsEnabled,
  singleKeyShortcutsEnabled,
} from './shortcut-keys';

export type ShortcutGroup = 'general' | 'navigation' | 'scenarios' | 'editing';

export interface ShortcutOptions {
  /** tinykeys syntax: `c`, `g s`, `$mod+s`, `[Shift]+?`, `Escape`. */
  keys: string;
  /** Translated text shown in the help dialog. */
  description: string;
  /** Return false when the shortcut does not apply right now (the key keeps its default). */
  handler: (event: KeyboardEvent) => void | boolean;
  group?: ShortcutGroup;
  /** Registered but inactive (e.g. the user lacks permission): does nothing, not listed. */
  enabled?: boolean;
  /** Also fire while typing in a field or editor (modifier shortcuts such as Ctrl+S). */
  allowInInputs?: boolean;
}

interface Registration extends ShortcutOptions {
  id: number;
}

interface Registry {
  register(registration: Registration): () => void;
  list(): Registration[];
  subscribe(listener: () => void): () => void;
  singleKeys: boolean;
  setSingleKeys(enabled: boolean): void;
  openHelp(): void;
}

const ShortcutContext = createContext<Registry | null>(null);

function createStore() {
  const registrations = new Map<number, Registration>();
  const listeners = new Set<() => void>();
  let snapshot: Registration[] = [];
  const emit = () => {
    snapshot = [...registrations.values()];
    for (const listener of listeners) listener();
  };
  return {
    add(registration: Registration) {
      registrations.set(registration.id, registration);
      emit();
      return () => {
        registrations.delete(registration.id);
        emit();
      };
    },
    list: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** A modal dialog is open: plain-key shortcuts must not act on the page behind it. */
function modalOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

export function ShortcutProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createStore);
  const [singleKeys, setSingleKeysState] = useState(singleKeyShortcutsEnabled);
  const [helpOpen, setHelpOpen] = useState(false);
  const registrations = useSyncExternalStore(store.subscribe, store.list);

  const setSingleKeys = useCallback((enabled: boolean) => {
    setSingleKeyShortcutsEnabled(enabled);
    setSingleKeysState(enabled);
  }, []);

  // One listener for all bindings, so sequences like `g s` are tracked consistently.
  const bindingKeys = useMemo(
    () =>
      [...new Set(registrations.filter((r) => r.enabled !== false).map((r) => r.keys))].join('\n'),
    [registrations],
  );
  useEffect(() => {
    if (!bindingKeys) return;
    const bindings: Record<string, (event: KeyboardEvent) => void> = {};
    for (const keys of bindingKeys.split('\n')) {
      bindings[keys] = (event) => {
        // The most recently registered (innermost page) shortcut wins.
        const registration = store
          .list()
          .filter((r) => r.keys === keys && r.enabled !== false)
          .at(-1);
        if (!registration || event.defaultPrevented) return;
        const plain = isSingleKeyBinding(keys);
        if (!registration.allowInInputs && isEditableTarget(event.target)) return;
        if (plain && !isEscapeBinding(keys)) {
          if (!singleKeys || modalOpen()) return;
        }
        if (registration.handler(event) !== false) event.preventDefault();
      };
    }
    return tinykeys(window, bindings, { ignore: (event) => event.isComposing });
  }, [bindingKeys, singleKeys, store]);

  const registry = useMemo<Registry>(
    () => ({
      register: (registration) => store.add(registration),
      list: store.list,
      subscribe: store.subscribe,
      singleKeys,
      setSingleKeys,
      openHelp: () => setHelpOpen(true),
    }),
    [store, singleKeys, setSingleKeys],
  );

  return (
    <ShortcutContext.Provider value={registry}>
      {children}
      <HelpShortcut onOpen={() => setHelpOpen(true)} />
      <ShortcutHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </ShortcutContext.Provider>
  );
}

function useRegistry(): Registry {
  const registry = useContext(ShortcutContext);
  if (!registry) throw new Error('useShortcut must be used inside <ShortcutProvider>');
  return registry;
}

let nextId = 1;

/** Registers a shortcut for as long as the calling component is mounted. */
export function useShortcut(options: ShortcutOptions): void {
  const registry = useRegistry();
  const handlerRef = useRef(options.handler);
  useEffect(() => {
    handlerRef.current = options.handler;
  });
  const [id] = useState(() => nextId++);
  const { keys, description, group, enabled, allowInInputs } = options;

  const registration = useMemo<Registration>(
    () => ({
      id,
      keys,
      description,
      group,
      enabled,
      allowInInputs,
      handler: (event) => handlerRef.current(event),
    }),
    [id, keys, description, group, enabled, allowInInputs],
  );

  useEffect(() => registry.register(registration), [registry, registration]);
}

/** Current state of the WCAG 2.1.4 single-key opt-out and a setter. */
export function useSingleKeyShortcuts(): [boolean, (enabled: boolean) => void] {
  const registry = useRegistry();
  return [registry.singleKeys, registry.setSingleKeys];
}

export function useOpenShortcutHelp(): () => void {
  return useRegistry().openHelp;
}

function HelpShortcut({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  useShortcut({
    keys: '[Shift]+?',
    description: t('shortcuts.help'),
    group: 'general',
    handler: onOpen,
  });
  return null;
}

const GROUP_ORDER: ShortcutGroup[] = ['general', 'navigation', 'scenarios', 'editing'];

export function ShortcutHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const registry = useRegistry();
  const registrations = useSyncExternalStore(registry.subscribe, registry.list);
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
  const active = registrations.filter((r) => r.enabled !== false);
  const unique = active.filter(
    (r, index) => active.findLastIndex((other) => other.keys === r.keys) === index,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('shortcuts.title')}</DialogTitle>
          <DialogDescription>{t('shortcuts.body')}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-4 overflow-y-auto">
          {GROUP_ORDER.map((group) => {
            const items = unique.filter((r) => (r.group ?? 'general') === group);
            if (items.length === 0) return null;
            return (
              <section key={group} aria-labelledby={`shortcuts-${group}`} className="grid gap-1">
                <h3 id={`shortcuts-${group}`} className="text-xs font-medium text-muted-foreground">
                  {t(`shortcuts.groups.${group}`)}
                </h3>
                <dl className="grid gap-1">
                  {items.map((r) => {
                    const disabled =
                      !registry.singleKeys &&
                      isSingleKeyBinding(r.keys) &&
                      !isEscapeBinding(r.keys);
                    return (
                      <div
                        key={r.id}
                        className={`flex items-center justify-between gap-4 rounded-md px-2 py-1.5 text-sm ${disabled ? 'opacity-60' : ''}`}
                      >
                        <dt>{r.description}</dt>
                        <dd className="flex items-center gap-1">
                          {displayKeys(r.keys, isMac).map((press, index) => (
                            <span key={index} className="flex items-center gap-1">
                              {index > 0 ? (
                                <span className="text-xs text-muted-foreground">
                                  {t('shortcuts.then')}
                                </span>
                              ) : null}
                              {press.map((key) => (
                                <Kbd key={key}>{key}</Kbd>
                              ))}
                            </span>
                          ))}
                          {disabled ? <span className="sr-only">{t('shortcuts.off')}</span> : null}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </section>
            );
          })}
        </div>
        <div className="flex items-start gap-2 border-t pt-4">
          <input
            id="single-key-shortcuts"
            type="checkbox"
            className="mt-0.5 size-4 accent-(--primary)"
            checked={registry.singleKeys}
            onChange={(event) => registry.setSingleKeys(event.target.checked)}
          />
          <div className="grid gap-1">
            <Label htmlFor="single-key-shortcuts">{t('shortcuts.singleKeys')}</Label>
            <p className="text-xs text-muted-foreground">{t('shortcuts.singleKeysHint')}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
