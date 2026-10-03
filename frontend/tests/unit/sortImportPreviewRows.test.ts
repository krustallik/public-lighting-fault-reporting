import { describe, expect, it } from 'vitest';
import { sortImportPreviewRows } from '../../src/utils/sortImportPreviewRows';
import type { ImportRowResult } from '../../src/types/admin';

const rows: ImportRowResult[] = [
  { rowIndex: 4, inventoryNumber: 'L-4', action: 'error', message: 'Invalid' },
  { rowIndex: 2, inventoryNumber: 'L-2', action: 'update' },
  { rowIndex: 1, inventoryNumber: 'L-1', action: 'create' },
  { rowIndex: 3, inventoryNumber: 'L-3', action: 'skip' },
];

describe('sortImportPreviewRows', () => {
  it('sorts actions in the existing create/update/skip/error order', () => {
    expect(sortImportPreviewRows(rows, 'action', 'asc').map((row) => row.action)).toEqual([
      'create',
      'update',
      'skip',
      'error',
    ]);
  });

  it('sorts row indexes descending without mutating the input array', () => {
    const sorted = sortImportPreviewRows(rows, 'rowIndex', 'desc');
    expect(sorted.map((row) => row.rowIndex)).toEqual([4, 3, 2, 1]);
    expect(rows.map((row) => row.rowIndex)).toEqual([4, 2, 1, 3]);
    expect(sorted).not.toBe(rows);
  });
});
