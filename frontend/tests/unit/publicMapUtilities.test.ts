// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLightPointPopupHtml } from '@/utils/lightPointPopup';
import { getMapMarkerSizesPx } from '@/utils/mapMarkerSize';
import { maskDetailDescription, maskEmail, maskPhone } from '@/utils/maskPii';
import { buildInventoryDetailLine, isAutoInventoryDetailLine, replaceInventoryLineForLocale } from '@/utils/inventoryDetailLine';
import type { LightPoint } from '@/types/lightPoint';

const labels = {
  inventory: 'Inventory', address: 'Address', type: 'Type', status: 'Status',
  statusValues: { active: 'Active', inactive: 'Inactive', maintenance: 'Repair' }, choose: 'Choose point',
};

afterEach(() => vi.restoreAllMocks());

describe('public map and report-detail helpers', () => {
  it('escapes untrusted popup content and safely falls back for missing point values', () => {
    const point = {
      id: 32, inventory_number: '<img src=x onerror=alert(1)>', address: '', latitude: 48.7, longitude: 21.2,
      type: 'LED & <lamp>', status: 'inactive',
    } as LightPoint;

    const html = buildLightPointPopupHtml(point, 'Main "street" <script>', labels);

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Main &quot;street&quot; &lt;script&gt;');
    expect(html).toContain('LED &amp; &lt;lamp&gt;');
    expect(html).toContain('> Inactive</p>');
    expect(html).toContain('data-select-light-point="32"');
    expect(buildLightPointPopupHtml({ ...point, inventory_number: null, type: null, status: 'future' } as unknown as LightPoint, '—', labels)).toContain('> —</p>');
  });

  it('uses CSS marker dimensions and documented rem defaults while cleaning measurement probes', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.style.setProperty('--map-marker-outer', '36px');
    container.style.setProperty('--map-marker-inner', '24px');
    container.style.setProperty('--map-cluster-medium-outer', '44px');
    const offsetWidth = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      const width = this.style.width;
      if (width.endsWith('rem')) return Number.parseFloat(width) * 16;
      return Number.parseFloat(width);
    });

    try {
      expect(getMapMarkerSizesPx(container)).toEqual({
        outer: 36, inner: 24, anchor: 18, cluster: { small: 36, medium: 44, large: 42 },
      });
      expect(container.childElementCount).toBe(0);
      expect(offsetWidth).toHaveBeenCalled();
    } finally {
      container.remove();
    }
  });

  it('falls back to the documented marker sizes when the map has no CSS overrides', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return Number.parseFloat(this.style.width) * (this.style.width.endsWith('rem') ? 16 : 1);
    });

    try {
      expect(getMapMarkerSizesPx(container)).toEqual({
        outer: 28, inner: 21, anchor: 14, cluster: { small: 28, medium: 35, large: 42 },
      });
      expect(container.childElementCount).toBe(0);
    } finally {
      container.remove();
    }
  });

  it('masks short and long personal data without exposing complete identifiers', () => {
    expect(maskEmail('x@example.test')).toBe('x***@example.test');
    expect(maskEmail('invalid')).toBe('***');
    expect(maskPhone('')).toBe('');
    expect(maskPhone('1234')).toBe('***');
    expect(maskPhone('+421 905 123 456')).toBe('+421 *** 456');
    expect(maskDetailDescription('')).toBe('');
    expect(maskDetailDescription('  short  ')).toBe('***');
    expect(maskDetailDescription('A private description')).toBe('A pr…on (21 znakov)');
  });

  it('updates only the known auto-filled inventory line when the form locale changes', () => {
    const sk = buildInventoryDetailLine('sk', 'INV-42');
    const en = buildInventoryDetailLine('en', 'INV-42');
    expect(isAutoInventoryDetailLine(sk, 'INV-42')).toBe(true);
    expect(isAutoInventoryDetailLine(en, 'INV-42')).toBe(true);
    expect(isAutoInventoryDetailLine(`${sk} extra`, 'INV-42')).toBe(false);
    expect(replaceInventoryLineForLocale('', 'INV-42', 'en')).toBe(en);
    expect(replaceInventoryLineForLocale(`  ${sk}  `, 'INV-42', 'en')).toBe(en);
    expect(replaceInventoryLineForLocale(`${sk}\nAdditional note`, 'INV-42', 'en')).toBe(`${en}\nAdditional note`);
    expect(replaceInventoryLineForLocale('User provided details', 'INV-42', 'en')).toBe('User provided details');
  });
});
