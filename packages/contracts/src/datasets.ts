// Datasets: named columns and rows that drive test cases (one iteration per row), plus CSV
// conversion used by the dataset editor.
import { z } from 'zod';
import { BUILTIN_VARIABLES } from './steps';
import type { UserRef } from './scenarios';

export const DATASET_NAME_MAX = 80;
export const DATASET_DESCRIPTION_MAX = 500;
export const DATASET_COLUMNS_MAX = 50;
export const DATASET_ROWS_MAX = 500;
export const DATASET_CELL_MAX = 1_000;
export const VARIABLE_NAME_MAX = 60;

/** A column name, usable in steps as `{{name}}`. */
export const variableNameSchema = z
  .string()
  .trim()
  .max(VARIABLE_NAME_MAX, 'dataset.columnTooLong')
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'dataset.columnInvalid')
  .refine(
    (name) => !(BUILTIN_VARIABLES as readonly string[]).includes(name),
    'dataset.columnReserved',
  );

export const datasetInputSchema = z
  .object({
    name: z.string().trim().min(1, 'name.required').max(DATASET_NAME_MAX, 'dataset.nameTooLong'),
    description: z
      .string()
      .trim()
      .max(DATASET_DESCRIPTION_MAX, 'dataset.descriptionTooLong')
      .default(''),
    columns: z
      .array(variableNameSchema)
      .min(1, 'dataset.columnsRequired')
      .max(DATASET_COLUMNS_MAX, 'dataset.tooManyColumns'),
    rows: z
      .array(z.array(z.string().max(DATASET_CELL_MAX, 'dataset.cellTooLong')))
      .max(DATASET_ROWS_MAX, 'dataset.tooManyRows')
      .default([]),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.columns.forEach((column, index) => {
      if (seen.has(column)) {
        ctx.addIssue({
          code: 'custom',
          path: ['columns', index],
          message: 'dataset.columnDuplicate',
        });
      }
      seen.add(column);
    });
    value.rows.forEach((row, index) => {
      if (row.length !== value.columns.length) {
        ctx.addIssue({ code: 'custom', path: ['rows', index], message: 'dataset.rowWidth' });
      }
    });
  });
export type DatasetInput = z.infer<typeof datasetInputSchema>;

export interface DatasetSummary {
  id: string;
  name: string;
  description: string;
  columns: string[];
  rowCount: number;
  /** Live test cases using it. */
  testCaseCount: number;
  updatedBy: UserRef;
  updatedAt: string;
}

export interface Dataset extends DatasetSummary {
  rows: string[][];
  createdAt: string;
}

/** The rows a run item iterates over (snapshot taken when the run is created). */
export interface DatasetSnapshot {
  id: string;
  name: string;
  columns: string[];
  rows: string[][];
}

/** Row values by column name. */
export function rowValues(columns: string[], row: string[]): Record<string, string> {
  return Object.fromEntries(columns.map((column, index) => [column, row[index] ?? '']));
}

// ---------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------

/** Picks the delimiter that splits the header line into the most fields (outside quotes). */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let bestCount = -1;
  for (const delimiter of [',', ';', '\t']) {
    let count = 0;
    let quoted = false;
    for (const char of firstLine) {
      if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) count++;
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/** RFC 4180 style parsing (quotes, doubled quotes, line breaks inside quotes, CRLF). */
export function parseCsvRecords(text: string, delimiter = detectDelimiter(text)): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  // Blank lines carry no data.
  return records.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** First record as column names (trimmed), the rest as rows padded/truncated to that width. */
export function parseCsv(text: string): { columns: string[]; rows: string[][] } {
  const [header = [], ...rest] = parseCsvRecords(text);
  const columns = header.map((name) => name.trim());
  const rows = rest.map((row) => columns.map((_, index) => row[index] ?? ''));
  return { columns, rows };
}

function csvField(value: string, delimiter: string): string {
  return /[",\r\n;\t]/.test(value) || value.includes(delimiter)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

export function formatCsv(columns: string[], rows: string[][], delimiter = ','): string {
  return [columns, ...rows]
    .map((row) => row.map((value) => csvField(value, delimiter)).join(delimiter))
    .join('\r\n');
}
