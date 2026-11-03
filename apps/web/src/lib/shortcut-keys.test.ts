// @vitest-environment jsdom
import { tinykeys } from 'tinykeys';
import { afterEach, describe, expect, it } from 'vitest';
import {
  displayKeys,
  isEditableTarget,
  isSingleKeyBinding,
  orderBindings,
  setSingleKeyShortcutsEnabled,
  singleKeyShortcutsEnabled,
} from './shortcut-keys';

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('isSingleKeyBinding', () => {
  it.each(['c', '/', 'g s', 'j', '[Shift]+?', 'Escape', 'Enter'])(
    '%s is a plain-key binding',
    (keys) => {
      expect(isSingleKeyBinding(keys)).toBe(true);
    },
  );
  it.each(['$mod+s', '$mod+k', 'Control+Enter', 'Alt+n'])('%s uses a modifier', (keys) => {
    expect(isSingleKeyBinding(keys)).toBe(false);
  });
});

describe('isEditableTarget (input guard)', () => {
  function element(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.body.querySelector('[data-target]') as HTMLElement;
  }

  it.each([
    '<input data-target />',
    '<input type="search" data-target />',
    '<textarea data-target></textarea>',
    '<select data-target><option>a</option></select>',
    '<div contenteditable="true"><p data-target>typing here</p></div>',
    '<div role="combobox" data-target></div>',
  ])('ignores shortcuts in %s', (html) => {
    expect(isEditableTarget(element(html))).toBe(true);
  });

  it.each([
    '<button data-target>Save</button>',
    '<input type="checkbox" data-target />',
    '<a href="#" data-target>link</a>',
    '<tr tabindex="0" data-target></tr>',
    '<div contenteditable="false"><p data-target>read only</p></div>',
  ])('allows shortcuts in %s', (html) => {
    expect(isEditableTarget(element(html))).toBe(false);
  });

  it('treats a missing target as not editable', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
  });
});

describe('single-key opt-out', () => {
  it('is on by default and remembered in this browser when turned off', () => {
    expect(singleKeyShortcutsEnabled()).toBe(true);
    setSingleKeyShortcutsEnabled(false);
    expect(localStorage.getItem('testrex-single-key-shortcuts')).toBe('off');
    expect(singleKeyShortcutsEnabled()).toBe(false);
    setSingleKeyShortcutsEnabled(true);
    expect(singleKeyShortcutsEnabled()).toBe(true);
  });
});

describe('displayKeys', () => {
  it('formats bindings for the help dialog', () => {
    expect(displayKeys('$mod+s', false)).toEqual([['Ctrl', 'S']]);
    expect(displayKeys('$mod+s', true)).toEqual([['⌘', 'S']]);
    expect(displayKeys('g s', false)).toEqual([['G'], ['S']]);
    expect(displayKeys('[Shift]+?', false)).toEqual([['?']]);
    expect(displayKeys('Escape', false)).toEqual([['Esc']]);
  });
});

describe('orderBindings', () => {
  it('puts longer sequences first', () => {
    expect(orderBindings(['c', 'g c', '$mod+k', 'g s', '[Shift]+?'])).toEqual([
      'g c',
      'g s',
      'c',
      '$mod+k',
      '[Shift]+?',
    ]);
  });

  it('lets `g c` win over a page shortcut on `c`', () => {
    const fired: string[] = [];
    // Registered in the order React mounts them: the page (child) before the workspace.
    const handlers: Record<string, (event: KeyboardEvent) => void> = {
      c: (event) => {
        if (event.defaultPrevented) return;
        fired.push('c');
        event.preventDefault();
      },
      'g c': (event) => {
        if (event.defaultPrevented) return;
        fired.push('g c');
        event.preventDefault();
      },
    };
    const bindings = Object.fromEntries(
      orderBindings(Object.keys(handlers)).map((k) => [k, handlers[k]!]),
    );
    const stop = tinykeys(window, bindings);
    const press = (key: string) =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, cancelable: true }),
      );
    press('g');
    press('c');
    press('c');
    stop();
    expect(fired).toEqual(['g c', 'c']);
  });
});
