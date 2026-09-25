import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AUDIT_ACTIONS, SCENARIO_REVISION_FIELDS } from '@testrex/contracts';
import { describe, expect, it } from 'vitest';
import en from './en.json';
import es from './es.json';

type Tree = { [key: string]: string | Tree };
const PLURAL = /_(zero|one|two|few|many|other)$/;

function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`),
  );
}

/** Keys without plural suffixes: languages may need different plural forms. */
const keysOf = (tree: Tree) => new Set(flatten(tree).map((key) => key.replace(PLURAL, '')));
const enKeys = keysOf(en as Tree);
const esKeys = keysOf(es as Tree);

describe('locales', () => {
  it('English and Spanish define the same keys', () => {
    expect([...enKeys].filter((key) => !esKeys.has(key))).toEqual([]);
    expect([...esKeys].filter((key) => !enKeys.has(key))).toEqual([]);
  });

  it('no translation is empty', () => {
    for (const tree of [en, es] as Tree[]) {
      const empty = flatten(tree).filter((key) => {
        const value = key
          .split('.')
          .reduce<string | Tree>((node, part) => (node as Tree)[part]!, tree);
        return typeof value !== 'string' || value.trim() === '';
      });
      expect(empty).toEqual([]);
    }
  });

  it('every literal t("…") key used in the source exists', () => {
    const root = resolve(import.meta.dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) files.push(path);
      }
    };
    walk(root);
    const missing = new Set<string>();
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([\w.]+)'/g)) {
        if (!enKeys.has(match[1]!)) missing.add(match[1]!);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('labels every audit action and scenario field', () => {
    for (const action of AUDIT_ACTIONS) expect(enKeys).toContain(`audit.actions.${action}`);
    for (const field of SCENARIO_REVISION_FIELDS) {
      expect(enKeys).toContain(`scenario.fields.${field}`);
    }
  });
});
