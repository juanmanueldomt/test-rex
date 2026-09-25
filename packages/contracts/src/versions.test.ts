import { describe, expect, it } from 'vitest';
import {
  compareProductVersions,
  isVersionInRange,
  paddedVersionParts,
  parseProductVersion,
} from './versions';

describe('parseProductVersion', () => {
  it.each([
    ['3', [3]],
    ['3.2', [3, 2]],
    ['3.2.1', [3, 2, 1]],
    ['10.0.0.7', [10, 0, 0, 7]],
    [' 2.4 ', [2, 4]],
    ['0', [0]],
  ])('accepts %s', (text, parts) => {
    expect(parseProductVersion(text)).toEqual(parts);
  });

  it.each(['v3', '3.x', 'v3.x', '1.2.3.4.5', '', '3.', '.3', '3..1', '-1', '3.2-beta', '1e3'])(
    'rejects %s',
    (text) => {
      expect(parseProductVersion(text)).toBeNull();
    },
  );

  it('rejects parts that do not fit a database integer', () => {
    expect(parseProductVersion('2147483647')).toEqual([2147483647]);
    expect(parseProductVersion('2147483648')).toBeNull();
  });
});

describe('paddedVersionParts', () => {
  it('fills missing parts with 0', () => {
    expect(paddedVersionParts('3')).toEqual([3, 0, 0, 0]);
    expect(paddedVersionParts('3.2.1')).toEqual([3, 2, 1, 0]);
    expect(paddedVersionParts('nope')).toBeNull();
  });
});

describe('compareProductVersions', () => {
  it.each([
    ['3.10', '3.9', 1],
    ['3.9', '3.10', -1],
    ['3', '3.0.0', 0],
    ['3.0.1', '3', 1],
    ['2.4', '2.4.0.0', 0],
    ['10', '9.99', 1],
  ] as const)('%s vs %s = %i', (a, b, expected) => {
    expect(compareProductVersions(a, b)).toBe(expected);
  });

  it('throws on invalid versions', () => {
    expect(() => compareProductVersions('v3', '3')).toThrow(/v3/);
  });
});

describe('isVersionInRange', () => {
  it('treats bounds as inclusive and empty bounds as unlimited', () => {
    expect(isVersionInRange('3.9', '2.4', '3.10')).toBe(true);
    expect(isVersionInRange('3.10', '2.4', '3.10')).toBe(true);
    expect(isVersionInRange('3.11', '2.4', '3.10')).toBe(false);
    expect(isVersionInRange('2.3', '2.4', null)).toBe(false);
    expect(isVersionInRange('99', '2.4', null)).toBe(true);
    expect(isVersionInRange('1', null, null)).toBe(true);
  });
});
