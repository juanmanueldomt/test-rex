// Pure helpers behind the keyboard shortcut registry (see shortcuts.tsx).

const MODIFIERS = /(^|\+|\s)(\$mod|Control|Meta|Alt)\+/;

/**
 * Whether a binding consists of plain keys (`c`, `g s`, `?`), which WCAG 2.1.4 lets users turn
 * off. Bindings with Ctrl/⌘/Alt are not affected; Shift alone still counts as a plain key.
 */
export function isSingleKeyBinding(keys: string): boolean {
  return !MODIFIERS.test(keys);
}

export function isEscapeBinding(keys: string): boolean {
  return keys.trim() === 'Escape';
}

/** Text fields, selects, editors: typing there must never trigger plain-key shortcuts. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const element = target as HTMLElement;
  if (element.closest('[contenteditable=""], [contenteditable="true"]')) return true;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(
      element.type,
    );
  }
  return element.getAttribute('role') === 'combobox' || element.getAttribute('role') === 'textbox';
}

export const SINGLE_KEY_STORAGE_KEY = 'testrex-single-key-shortcuts';

export function singleKeyShortcutsEnabled(): boolean {
  try {
    return localStorage.getItem(SINGLE_KEY_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSingleKeyShortcutsEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(SINGLE_KEY_STORAGE_KEY);
    else localStorage.setItem(SINGLE_KEY_STORAGE_KEY, 'off');
  } catch {
    // Storage unavailable: the choice lasts until the page reloads.
  }
}

/** Keys as shown in the help dialog: `$mod+s` → `["Ctrl", "S"]`, `g s` → `["G", "S"]`. */
export function displayKeys(keys: string, isMac: boolean): string[][] {
  return keys
    .trim()
    .split(' ')
    .map((press) =>
      press
        .split(/(?<=\w|\])\+/)
        .filter((part) => !/^\[.*\]$/.test(part))
        .map((part) => {
          if (part === '$mod') return isMac ? '⌘' : 'Ctrl';
          if (part === 'Control') return 'Ctrl';
          if (part === 'Escape') return 'Esc';
          return part.length === 1 ? part.toUpperCase() : part;
        }),
    );
}
