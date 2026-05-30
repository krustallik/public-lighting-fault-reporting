import type { ImportRowResult } from '@/types/admin';
import type { SortOrder } from '@/components/SortableColumnHeader/SortableColumnHeader';

const ACTION_ORDER: Record<string, number> = {
  create: 1,
  update: 2,
  skip: 3,
  error: 4,
};

export function sortImportPreviewRows(
  rows: ImportRowResult[],
  sortBy: string,
  sortOrder: SortOrder
): ImportRowResult[] {
  const dir = sortOrder === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    let cmp: number;

    switch (sortBy) {
      case 'rowIndex':
        cmp = a.rowIndex - b.rowIndex;
        break;
      case 'inventoryNumber':
        cmp = a.inventoryNumber.localeCompare(b.inventoryNumber, 'sk');
        break;
      case 'action':
        cmp =
          (ACTION_ORDER[a.action] ?? 99) - (ACTION_ORDER[b.action] ?? 99);
        break;
      case 'message':
        cmp = (a.message ?? '').localeCompare(b.message ?? '', 'sk');
        break;
      default:
        cmp = 0;
    }

    return cmp * dir;
  });
}
