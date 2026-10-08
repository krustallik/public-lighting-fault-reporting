import { describe, expect, it, vi } from 'vitest';
import type { ReportFormValues } from '@/schemas/reportSchema';
import { AutofillPrecedenceTracker } from '@/utils/autofillPrecedence';
import {
  INITIAL_REPORT_FORM_VALUES,
  getReportTargetIdentity,
  shouldClearOtherFaultOnTypeChange,
  transitionReportTarget,
} from '@/utils/reportTargetSession';

describe('report target state', () => {
  it('resets user-entered target A data and permits autofill for target B', () => {
    let values: ReportFormValues = { ...INITIAL_REPORT_FORM_VALUES };
    const tracker = new AutofillPrecedenceTracker<'locality' | 'detailDescription'>();
    const reset = vi.fn((nextValues: typeof INITIAL_REPORT_FORM_VALUES) => { values = { ...nextValues }; });

    values = { ...values, locality: 'Manual A', detailDescription: 'Detail A', phone: 'Phone A', email: 'a@example.test', consent: true };
    tracker.markUser('locality');
    tracker.markUser('detailDescription');
    expect(transitionReportTarget('lightPoint:1', 'lightPoint:2', tracker, reset)).toBe(true);
    expect(values).toEqual(INITIAL_REPORT_FORM_VALUES);
    expect(tracker.canAutofill('locality')).toBe(true);
    expect(reset).toHaveBeenCalledWith(INITIAL_REPORT_FORM_VALUES);

    values = { ...values, locality: 'Biela' };
    tracker.markAuto('locality');
    expect(values.locality).toBe('Biela');
    expect(tracker.sourceOf('locality')).toBe('auto');
  });

  it('preserves same-target user edits and manual clears during locale/refetch changes', () => {
    let values: ReportFormValues = { ...INITIAL_REPORT_FORM_VALUES, locality: '', detailDescription: 'User detail' };
    const tracker = new AutofillPrecedenceTracker<'locality' | 'detailDescription'>();
    const reset = vi.fn((nextValues: typeof INITIAL_REPORT_FORM_VALUES) => { values = { ...nextValues }; });
    tracker.markUser('locality');
    tracker.markUser('detailDescription');

    expect(transitionReportTarget('lightPoint:1', 'lightPoint:1', tracker, reset)).toBe(false);
    expect(values.locality).toBe('');
    expect(values.detailDescription).toBe('User detail');
    expect(tracker.canAutofill('locality')).toBe(false);
    expect(reset).not.toHaveBeenCalled();
  });

  it('treats different custom coordinates as distinct report targets', () => {
    const tracker = new AutofillPrecedenceTracker<'locality'>();
    const reset = vi.fn();
    const first = getReportTargetIdentity(null, 48.7164, 21.2611);
    const second = getReportTargetIdentity(null, 48.7165, 21.2611);

    expect(first).toBe('coords:48.7164:21.2611');
    expect(second).toBe('coords:48.7165:21.2611');
    expect(transitionReportTarget(first, second, tracker, reset)).toBe(true);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('keeps device and custom targets distinct when coordinates match', () => {
    const custom = getReportTargetIdentity(null, 48.7164, 21.2611, 'custom');
    const device = getReportTargetIdentity(null, 48.7164, 21.2611, 'device');

    expect(custom).toBe('coords:48.7164:21.2611');
    expect(device).toBe('device:48.7164:21.2611');
    expect(device).not.toBe(custom);
  });

  it('clears conditional other-fault text only when selection leaves Q99', () => {
    expect(shouldClearOtherFaultOnTypeChange('Q99', 'Q1')).toBe(true);
    expect(shouldClearOtherFaultOnTypeChange('Q99', 'Q99')).toBe(false);
    expect(shouldClearOtherFaultOnTypeChange('Q1', 'Q99')).toBe(false);
  });
});
