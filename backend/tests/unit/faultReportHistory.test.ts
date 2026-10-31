import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { AUSEMIO_VO_LOCALITIES } from '../../src/config/data/ausemioVoLocalities.generated.js';
import {
  buildAutomaticFaultNotes,
  buildOperatorAdditionalInfo,
  FAULT_RECURRENCE_THRESHOLDS,
  FaultHistoryInputError,
  PostgresFaultHistoryStore,
  type FaultHistorySubmissionInput,
} from '../../src/services/faultReportHistory.service.js';

const anchor = new Date('2026-10-26T12:00:00.000Z');
const inventoryTarget = { kind: 'light-point' as const, lightPointId: 42 };
const validLocality = AUSEMIO_VO_LOCALITIES[0]!.value;

function validationStore() {
  const connect = vi.fn();
  const pool = { connect, query: vi.fn() } as unknown as Pick<Pool, 'connect' | 'query'>;
  return { store: new PostgresFaultHistoryStore(pool, () => 'inside', 'synthetic address proof secret'), connect };
}

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

  it('omits the recent-count clause below its threshold in a recurring note', () => {
    expect(buildAutomaticFaultNotes({
      recentCount: 1, recurringCount: 5, latestPreviousAt: null,
    }, anchor, inventoryTarget)).toEqual([
      'Opakované hlásenia na evidovanom svietidle #42: 5 predchádzajúcich hlásení za posledných 30 dní.',
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

  it('formats a PostgreSQL string timestamp in the operator timezone', () => {
    expect(buildAutomaticFaultNotes({
      recentCount: 0, recurringCount: 0, latestPreviousAt: '2026-10-26T10:15:00.000Z',
    }, anchor, inventoryTarget)).toEqual([
      'Posledné predchádzajúce hlásenie na evidovanom svietidle #42: 26. 10. 2026, 11:15:00 (Europe/Bratislava).',
    ]);
  });

  it('uses inclusive fallback seven-day boundaries and excludes future timestamps', () => {
    const exactBoundary = new Date(anchor.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(buildAutomaticFaultNotes({
      recentCount: 0, recurringCount: 0, latestPreviousAt: anchor,
    }, anchor, inventoryTarget)).toEqual([
      'Posledné predchádzajúce hlásenie na evidovanom svietidle #42: 26. 10. 2026, 13:00:00 (Europe/Bratislava).',
    ]);
    expect(buildAutomaticFaultNotes({
      recentCount: 0, recurringCount: 0, latestPreviousAt: exactBoundary,
    }, anchor, inventoryTarget)).toEqual([
      'Posledné predchádzajúce hlásenie na evidovanom svietidle #42: 19. 10. 2026, 14:00:00 (Europe/Bratislava).',
    ]);
    expect(buildAutomaticFaultNotes({
      recentCount: 0, recurringCount: 0,
      latestPreviousAt: new Date(exactBoundary.getTime() - 1),
    }, anchor, inventoryTarget)).toEqual([]);
    expect(buildAutomaticFaultNotes({
      recentCount: 0, recurringCount: 0,
      latestPreviousAt: new Date(anchor.getTime() + 1),
    }, anchor, inventoryTarget)).toEqual([]);
    expect(buildAutomaticFaultNotes({
      recentCount: 0, recurringCount: 0, latestPreviousAt: null,
    }, new Date('1970-01-03T00:00:00.000Z'), inventoryTarget)).toEqual([]);
  });

  it('keeps original description unchanged and appends only operator notes in memory', () => {
    const original = 'User wrote exactly this text.';
    const composed = buildOperatorAdditionalInfo(original, ['Synthetic recurrence note.']);
    expect(composed).toBe(`${original}\n\nAutomatické poznámky pre operátora: Synthetic recurrence note.`);
    expect(composed.startsWith(original)).toBe(true);
    expect(buildOperatorAdditionalInfo('  ', [])).toBe('');
    expect(buildOperatorAdditionalInfo(undefined, [])).toBe('');
    expect(buildOperatorAdditionalInfo(undefined, ['First fact.', 'Second fact.']))
      .toBe('Automatické poznámky pre operátora: First fact. Second fact.');
  });

  it('emits no automatic notes for custom, device, manual, or unspecified targets', () => {
    const summary = { recentCount: 0, recurringCount: 0, latestPreviousAt: null };
    expect(buildAutomaticFaultNotes(summary, anchor, { kind: 'custom', latitude: 48.7, longitude: 21.2 })).toEqual([]);
    expect(buildAutomaticFaultNotes(summary, anchor, { kind: 'device', latitude: 48.7, longitude: 21.2 })).toEqual([]);
    expect(buildAutomaticFaultNotes(summary, anchor, { kind: 'manual' })).toEqual([]);
    expect(buildAutomaticFaultNotes(summary, anchor)).toEqual([]);
    expect(buildOperatorAdditionalInfo('User custom description.', [])).toBe('User custom description.');
  });

  it.each([
    ['unsupported locality', { locality: 'Unknown locality' }, 'invalid_locality'],
    ['unsupported fault type', { faultTypeCode: 'UNKNOWN' }, 'invalid_fault_code'],
    ['unsupported block code', { locationBlockCode: 'UNKNOWN' }, 'invalid_fault_code'],
    ['control characters in generated address', { automaticAddress: 'Street\nCity' }, 'invalid_automatic_address'],
    ['overlong generated address', { automaticAddress: 'x'.repeat(501) }, 'invalid_automatic_address'],
    ['non-string generated address', { automaticAddress: 42 }, 'invalid_automatic_address'],
    ['malformed proof token', { automaticAddress: 'Street 1', automaticAddressProof: 'not-a-proof' }, 'invalid_automatic_address_proof'],
    ['address without proof', { automaticAddress: 'Street 1' }, 'invalid_automatic_address_proof'],
    ['proof without address', { automaticAddressProof: `v1.${'a'.repeat(43)}` }, 'invalid_automatic_address_proof'],
    ['non-object target', { reportTarget: [] }, 'invalid_report_target'],
    ['address attached to inventory light', {
      automaticAddress: 'Street 1', automaticAddressProof: `v1.${'a'.repeat(43)}`, reportTarget: inventoryTarget,
    }, 'invalid_automatic_address'],
  ])('rejects %s before opening PostgreSQL', async (_label, overrides, code) => {
    const { store, connect } = validationStore();
    const input = {
      locality: validLocality,
      reportTarget: { kind: 'custom' as const, latitude: 48.7, longitude: 21.25 },
      ...overrides,
    } as FaultHistorySubmissionInput;

    const error = await store.recordSubmission(input).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(FaultHistoryInputError);
    expect(error).toMatchObject({ code });
    expect(connect).not.toHaveBeenCalled();
  });

});
