import { describe, expect, it } from 'vitest';
import { formatCsv, parseCsv, datasetInputSchema, rowValues } from './datasets';
import {
  compactTestCaseListQuery,
  createTestCaseSchema,
  formatRunKey,
  formatTestCaseKey,
  parseRunKey,
  parseTestCaseKey,
  parseTestCaseListQueryLenient,
  updateTestCaseSchema,
} from './test-cases';

const SCENARIO = '0190a3b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b';

describe('keys', () => {
  it('formats and parses test case and run keys', () => {
    expect(formatTestCaseKey('CHK', 12)).toBe('CHK-TC-12');
    expect(formatRunKey('CHK', 3)).toBe('CHK-TR-3');
    expect(parseTestCaseKey('chk-tc-12', 'CHK')).toBe(12);
    expect(parseTestCaseKey('12')).toBe(12);
    expect(parseTestCaseKey('PAY-TC-12', 'CHK')).toBeNull();
    expect(parseTestCaseKey('CHK-TS-12', 'CHK')).toBeNull();
    expect(parseRunKey('CHK-TR-0')).toBeNull();
    expect(parseRunKey('CHK-TR-7')).toBe(7);
  });
});

describe('createTestCaseSchema', () => {
  it('defaults to an automated draft with medium priority', () => {
    const value = createTestCaseSchema.parse({ title: ' Apply coupon ', scenarioIds: [SCENARIO] });
    expect(value).toMatchObject({
      title: 'Apply coupon',
      status: 'draft',
      priority: 'medium',
      executionMode: 'automated',
      scenarioIds: [SCENARIO],
      tags: [],
      datasetId: null,
      steps: [],
      source: 'editor',
    });
  });

  it('requires at least one scenario and at most twenty', () => {
    const none = createTestCaseSchema.safeParse({ title: 'x', scenarioIds: [] });
    expect(none.error?.issues.map((i) => i.message)).toEqual(['scenarios.required']);
    const ids = Array.from(
      { length: 21 },
      (_, i) => `0190a3b2-7c4d-7e8f-9a0b-${String(i).padStart(12, '0')}`,
    );
    const many = createTestCaseSchema.safeParse({ title: 'x', scenarioIds: ids });
    expect(many.error?.issues.map((i) => i.message)).toEqual(['scenarios.tooMany']);
  });

  it('rejects manual steps in automated test cases but accepts them in manual ones', () => {
    const steps = [{ id: 'a', action: 'manual', description: 'Look at the receipt' }];
    const automated = createTestCaseSchema.safeParse({
      title: 'x',
      scenarioIds: [SCENARIO],
      steps,
    });
    expect(automated.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`)).toEqual([
      'steps.0.action:step.manualInAutomated',
    ]);
    const manual = createTestCaseSchema.safeParse({
      title: 'x',
      scenarioIds: [SCENARIO],
      executionMode: 'manual',
      steps,
    });
    expect(manual.success).toBe(true);
  });

  it('requires baseVersion on updates', () => {
    expect(updateTestCaseSchema.safeParse({ title: 'x' }).success).toBe(false);
    expect(updateTestCaseSchema.parse({ baseVersion: 2, title: 'x' }).source).toBe('editor');
  });
});

describe('list query', () => {
  it('drops invalid parameters and compacts defaults', () => {
    const query = parseTestCaseListQueryLenient({
      mode: 'manual,automated',
      status: 'bogus',
      sort: '-updated',
      page: '2',
    });
    expect(query.status).toBeUndefined();
    expect(compactTestCaseListQuery(query)).toEqual({
      mode: 'automated,manual',
      page: 2,
      sort: '-updated',
    });
  });
});

describe('datasets', () => {
  it('validates column names and row widths', () => {
    const result = datasetInputSchema.safeParse({
      name: 'Coupons',
      columns: ['code', 'first name', 'code', 'baseUrl'],
      rows: [['a', 'b']],
    });
    expect(result.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`)).toEqual([
      'columns.1:dataset.columnInvalid',
      'columns.3:dataset.columnReserved',
      'columns.2:dataset.columnDuplicate',
      'rows.0:dataset.rowWidth',
    ]);
    const width = datasetInputSchema.safeParse({
      name: 'Coupons',
      columns: ['code', 'code'],
      rows: [['a']],
    });
    expect(width.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`)).toEqual([
      'columns.1:dataset.columnDuplicate',
      'rows.0:dataset.rowWidth',
    ]);
  });

  it('parses CSV with semicolons, quotes, CRLF and embedded line breaks', () => {
    const csv = 'code;note\r\nSAVE10;"10% off; ""web"""\r\nFREE;"line 1\nline 2"\r\n\r\n';
    expect(parseCsv(csv)).toEqual({
      columns: ['code', 'note'],
      rows: [
        ['SAVE10', '10% off; "web"'],
        ['FREE', 'line 1\nline 2'],
      ],
    });
  });

  it('round-trips through formatCsv', () => {
    const columns = ['code', 'note'];
    const rows = [
      ['A,1', 'say "hi"'],
      ['B', ''],
    ];
    expect(parseCsv(formatCsv(columns, rows))).toEqual({ columns, rows });
    expect(rowValues(columns, rows[0]!)).toEqual({ code: 'A,1', note: 'say "hi"' });
  });
});
