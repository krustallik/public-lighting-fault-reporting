import { describe, expect, it } from 'vitest';
import {
  buildAutomaticFaultNotes,
  buildOperatorAdditionalInfo,
  FAULT_RECURRENCE_THRESHOLDS,
} from '../../src/services/faultReportHistory.service.js';

const anchor = new Date('2026-10-26T12:00:00.000Z');
const inventoryTarget = { kind: 'light-point' as const, lightPointId: 42 };

describe('privacy-safe operator recurrence notes', () => {
  it('uses the owner-approved inclusive count thresholds and combines overlapping windows once', () => {
    expect(FAULT_RECURRENCE_THRESHOLDS).toEqual({
      recentDays: 3, recentMinimum: 2, recurringDays: 30, recurringMinimum: 5, previousDays: 7,
    });
    expect(buildAutomaticFaultNotes({
      recentCount: 2, recurringCount: 5, latestPreviousAt: new Date('2026-10-25T12:00:00Z'),
    }, anchor, inventoryTarget)).toEqual([
      'Opakované hlásenia na evidovanom svietidle #42: 5 predchádzajúcich hlásení za posledných 30 dní, z toho 2 za posledné 3 dni.',
    ]);
  });

  it('adds a recent-window note at two previous reports and no note below threshold', () => {
    expect(buildAutomaticFaultNotes({ recentCount: 2, recurringCount: 2, latestPreviousAt: null }, anchor, inventoryTarget))
      .toEqual(['2 predchádzajúcich hlásení na evidovanom svietidle #42 za posledné 3 dni.']);
    expect(buildAutomaticFaultNotes({ recentCount: 1, recurringCount: 4, latestPreviousAt: null }, anchor, inventoryTarget))
      .toEqual([]);
  });

  it('reports a previous event within seven days only when count notes do not already cover it', () => {
    expect(buildAutomaticFaultNotes({
      recentCount: 1, recurringCount: 1, latestPreviousAt: new Date('2026-10-20T10:15:00.000Z'),
    }, anchor, inventoryTarget)).toEqual([
      'Posledné predchádzajúce hlásenie na evidovanom svietidle #42: 20. 10. 2026, 12:15:00 (Europe/Bratislava).',
    ]);
    expect(buildAutomaticFaultNotes({
      recentCount: 1, recurringCount: 1, latestPreviousAt: new Date('2026-10-18T11:59:59.999Z'),
    }, anchor, inventoryTarget)).toEqual([]);
  });

  it('honors the database evaluated rolling seven-day boundary', () => {
    const exactBoundary = new Date(anchor.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(buildAutomaticFaultNotes({
      recentCount: 0, recurringCount: 0, latestPreviousAt: exactBoundary,
      latestPreviousWithinDays: true,
    }, anchor, inventoryTarget)).toEqual([
      'Posledné predchádzajúce hlásenie na evidovanom svietidle #42: 19. 10. 2026, 14:00:00 (Europe/Bratislava).',
    ]);
    expect(buildAutomaticFaultNotes({
      recentCount: 0, recurringCount: 0, latestPreviousAt: new Date(exactBoundary.getTime() - 1),
      latestPreviousWithinDays: false,
    }, anchor, inventoryTarget)).toEqual([]);
  });

  it('keeps original description unchanged and appends only operator notes in memory', () => {
    const original = 'User wrote exactly this text.';
    const composed = buildOperatorAdditionalInfo(original, ['Synthetic recurrence note.']);
    expect(composed).toBe(`${original}\n\nAutomatické poznámky pre operátora: Synthetic recurrence note.`);
    expect(composed.startsWith(original)).toBe(true);
    expect(buildOperatorAdditionalInfo('  ', [])).toBe('');
  });

  it('emits no automatic notes for custom, device, manual, or unspecified targets', () => {
    const summary = { recentCount: 0, recurringCount: 0, latestPreviousAt: null };
    expect(buildAutomaticFaultNotes(summary, anchor, { kind: 'custom', latitude: 48.7, longitude: 21.2 })).toEqual([]);
    expect(buildAutomaticFaultNotes(summary, anchor, { kind: 'device', latitude: 48.7, longitude: 21.2 })).toEqual([]);
    expect(buildAutomaticFaultNotes(summary, anchor, { kind: 'manual' })).toEqual([]);
    expect(buildAutomaticFaultNotes(summary, anchor)).toEqual([]);
    expect(buildOperatorAdditionalInfo('User custom description.', [])).toBe('User custom description.');
  });
});
