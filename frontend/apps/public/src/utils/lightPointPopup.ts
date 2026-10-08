import type { LightPoint } from '@/types/lightPoint';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildLightPointPopupHtml(
  point: LightPoint,
  address: string,
  labels: {
    inventory: string;
    address: string;
    type: string;
    status: string;
    statusValues: Record<'active' | 'inactive' | 'maintenance', string>;
    choose: string;
  }
): string {
  const inventory = escapeHtml(point.inventory_number ?? '—');
  const addressText = escapeHtml(address);
  const type = escapeHtml(point.type ?? '—');
  const status = escapeHtml(labels.statusValues[point.status] ?? point.status);
  const inventoryLabel = escapeHtml(labels.inventory);
  const addressLabel = escapeHtml(labels.address);
  const typeLabel = escapeHtml(labels.type);
  const statusLabel = escapeHtml(labels.status);
  const chooseLabel = escapeHtml(labels.choose);

  return `
    <div class="lightPointPopup">
      <p class="lightPointPopupRow"><span class="lightPointPopupLabel">${inventoryLabel}:</span> ${inventory}</p>
      <p class="lightPointPopupRow"><span class="lightPointPopupLabel">${addressLabel}:</span> ${addressText}</p>
      <p class="lightPointPopupRow"><span class="lightPointPopupLabel">${typeLabel}:</span> ${type}</p>
      <p class="lightPointPopupRow"><span class="lightPointPopupLabel">${statusLabel}:</span> ${status}</p>
      <button class="lightPointPopupButton" type="button" data-select-light-point="${point.id}">${chooseLabel}</button>
    </div>
  `;
}
