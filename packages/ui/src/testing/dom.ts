// Helpers for component tests in jsdom (`// @vitest-environment jsdom`).
import axe from 'axe-core';
import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Browser APIs Radix and cmdk use that jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

/**
 * Runs axe on the document in light and dark mode (the `dark` class on <html>) and expects no
 * serious or critical violations. jsdom cannot compute colors, so contrast is covered by the
 * Playwright axe checks on real pages.
 */
export async function expectAccessible(): Promise<void> {
  for (const dark of [false, true]) {
    document.documentElement.classList.toggle('dark', dark);
    const results = await axe.run(document.body, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    const blocking = results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({ theme: dark ? 'dark' : 'light', rule: v.id, help: v.help }));
    expect(blocking).toEqual([]);
  }
  document.documentElement.classList.remove('dark');
}
