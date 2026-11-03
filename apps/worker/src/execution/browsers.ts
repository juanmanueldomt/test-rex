import { chromium, firefox, webkit, type Browser } from 'playwright-core';
import type { LaunchBrowser } from './run-executor';

const TYPES = { chromium, firefox, webkit };

/**
 * Launches a headless browser of the worker image (the official Playwright image ships all
 * three). PLAYWRIGHT_BROWSERS_PATH points elsewhere when browsers are installed separately.
 */
export const launchBrowser: LaunchBrowser = (name): Promise<Browser> =>
  TYPES[name].launch({ headless: true });
