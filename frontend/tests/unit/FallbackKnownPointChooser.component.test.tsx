// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FallbackKnownPointChooser } from '@/components/LightPointsMap/FallbackKnownPointChooser';
import { getReportFormMessages } from '@/i18n/reportFormMessages';
import type { LightPoint } from '@/types/lightPoint';

afterEach(cleanup);

function point(id: number, inventory_number: string | null, address: string | null): LightPoint {
  return { id, inventory_number, latitude: 48.7, longitude: 21.25, address, type: null, status: 'active' };
}

describe('FallbackKnownPointChooser', () => {
  const messages = getReportFormMessages('sk').map;

  it('searches inventory number, address, and numeric ID using the selected locale', () => {
    const points = [point(42, 'LP-314', 'Hlavná 1'), point(43, null, 'Školská 2'), point(144, null, null)];
    const onSelect = vi.fn();
    render(<FallbackKnownPointChooser points={points} locale="sk" messages={messages} onSelect={onSelect} />);

    const search = screen.getByRole('searchbox', { name: messages.fallbackPointsSearch });
    expect(screen.getByRole('status').textContent).toBe('Počet nájdených bodov: 3');
    fireEvent.change(search, { target: { value: '  lp-314  ' } });
    expect(screen.getByRole('status').textContent).toBe('Počet nájdených bodov: 1');
    expect(screen.getByRole('button', { name: 'LP-314 · Hlavná 1 · #42' })).toBeTruthy();

    fireEvent.change(search, { target: { value: 'ŠKOLSKÁ' } });
    expect(screen.getByRole('button', { name: 'Školská 2 · #43' })).toBeTruthy();
    fireEvent.change(search, { target: { value: '144' } });
    expect(screen.getByRole('button', { name: '#144' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'LP-314 · Hlavná 1 · #42' })).toBeNull();
  });

  it('reports zero matches and passes the exact selected point and button trigger', () => {
    const selected = point(7, 'N-7', null);
    const onSelect = vi.fn();
    render(<FallbackKnownPointChooser points={[selected]} locale="en" messages={getReportFormMessages('en').map} onSelect={onSelect} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no such point' } });
    expect(screen.getByRole('status').textContent).toBe('Matching points: 0');

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    const button = screen.getByRole('button', { name: 'N-7 · #7' });
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(selected, button);
  });

  it('shows a maximum of twenty choices while preserving the true match count', () => {
    const points = Array.from({ length: 25 }, (_, index) => point(index + 1, `LP-${index + 1}`, null));
    render(<FallbackKnownPointChooser points={points} locale="en" messages={getReportFormMessages('en').map} onSelect={vi.fn()} />);

    expect(screen.getByRole('status').textContent).toBe('Matching points: 25');
    expect(screen.getAllByRole('button')).toHaveLength(20);
    expect(screen.queryByRole('button', { name: 'LP-21 · #21' })).toBeNull();
  });
});
