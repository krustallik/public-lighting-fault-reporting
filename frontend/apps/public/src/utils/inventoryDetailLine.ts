import { getReportFormMessages } from '@/i18n/reportFormMessages';
import type { ReportFormLocale } from '@/i18n/reportFormLocale';

export function buildInventoryDetailLine(
  locale: ReportFormLocale,
  inventoryNumber: string
): string {
  const prefix = getReportFormMessages(locale).form.inventoryPrefix;
  return `${prefix}: ${inventoryNumber}`;
}

/** True if the line is only the auto-filled inventory label (SK or EN). */
export function isAutoInventoryDetailLine(line: string, inventoryNumber: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed === buildInventoryDetailLine('sk', inventoryNumber) ||
    trimmed === buildInventoryDetailLine('en', inventoryNumber)
  );
}

/**
 * Updates the inventory prefix line to match locale; leaves user-added text unchanged.
 */
export function replaceInventoryLineForLocale(
  currentDetail: string,
  inventoryNumber: string,
  locale: ReportFormLocale
): string {
  const newLine = buildInventoryDetailLine(locale, inventoryNumber);
  const trimmed = currentDetail.trim();

  if (!trimmed || isAutoInventoryDetailLine(trimmed, inventoryNumber)) {
    return newLine;
  }

  const lines = currentDetail.split('\n');
  const firstLine = lines[0]?.trim() ?? '';

  if (isAutoInventoryDetailLine(firstLine, inventoryNumber)) {
    lines[0] = newLine;
    return lines.join('\n');
  }

  return currentDetail;
}
