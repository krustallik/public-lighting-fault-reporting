import type { LightPoint } from '@/types/lightPoint';
import { STATUS_LABELS } from '@/types/lightPoint';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildLightPointPopupHtml(
  point: LightPoint,
  address: string
): string {
  const inventory = escapeHtml(point.inventory_number ?? '—');
  const addressText = escapeHtml(address);
  const type = escapeHtml(point.type ?? '—');
  const status = escapeHtml(STATUS_LABELS[point.status] ?? point.status);

  return `
    <div class="lightPointPopup">
      <p class="lightPointPopupRow"><span class="lightPointPopupLabel">Inventárne číslo:</span> ${inventory}</p>
      <p class="lightPointPopupRow"><span class="lightPointPopupLabel">Adresa:</span> ${addressText}</p>
      <p class="lightPointPopupRow"><span class="lightPointPopupLabel">Typ:</span> ${type}</p>
      <p class="lightPointPopupRow"><span class="lightPointPopupLabel">Stav:</span> ${status}</p>
      <a class="lightPointPopupLink" href="/report?lightPointId=${point.id}">Nahlásiť poruchu</a>
    </div>
  `;
}
