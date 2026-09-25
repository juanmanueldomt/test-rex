// Versions of the product under test ("supported from 2.4 up to 3.10"), shared by the API
// (storage and filtering) and the web app (form validation).

/** Largest value of a Postgres `integer`, the type each stored part uses. */
const MAX_PART = 2_147_483_647;
export const PRODUCT_VERSION_PARTS = 4;
const PRODUCT_VERSION_PATTERN = /^\d+(\.\d+){0,3}$/;

export type VersionParts = [number, number, number, number];

/**
 * Parses 1 to 4 dot-separated non-negative integers (`3`, `3.2`, `3.2.1`). Returns the parts
 * as written, or null when the text is not a valid version.
 */
export function parseProductVersion(text: string): number[] | null {
  const trimmed = text.trim();
  if (!PRODUCT_VERSION_PATTERN.test(trimmed)) return null;
  const parts = trimmed.split('.').map(Number);
  return parts.every((part) => part <= MAX_PART) ? parts : null;
}

/** Zero-padded parts used for storage and comparison: `3.2` → `[3, 2, 0, 0]`. */
export function paddedVersionParts(text: string): VersionParts | null {
  const parts = parseProductVersion(text);
  if (!parts) return null;
  return Array.from({ length: PRODUCT_VERSION_PARTS }, (_, i) => parts[i] ?? 0) as VersionParts;
}

/**
 * Compares two versions numerically part by part, treating missing parts as 0
 * (`3.10` > `3.9`, `3` = `3.0.0`). Throws on invalid input.
 */
export function compareProductVersions(a: string, b: string): -1 | 0 | 1 {
  const left = paddedVersionParts(a);
  const right = paddedVersionParts(b);
  if (!left || !right) throw new Error(`Invalid product version: ${left ? b : a}`);
  for (let i = 0; i < PRODUCT_VERSION_PARTS; i++) {
    if (left[i]! !== right[i]!) return left[i]! < right[i]! ? -1 : 1;
  }
  return 0;
}

/** Whether `version` lies inside the inclusive range; a missing bound means no limit. */
export function isVersionInRange(
  version: string,
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  if (from && compareProductVersions(version, from) < 0) return false;
  if (to && compareProductVersions(version, to) > 0) return false;
  return true;
}
