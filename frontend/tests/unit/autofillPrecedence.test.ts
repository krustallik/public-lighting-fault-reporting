import { describe, expect, it } from 'vitest';
import {
  AutofillPrecedenceTracker,
  findExactUniqueLocality,
} from '../../src/utils/autofillPrecedence';

describe('autofill source precedence', () => {
  it('allows untouched and auto values to be filled/refreshed, then preserves explicit edits and clears', () => {
    const tracker = new AutofillPrecedenceTracker<'locality' | 'detailDescription'>();

    expect(tracker.canAutofill('locality')).toBe(true);
    tracker.markAuto('locality');
    expect(tracker.sourceOf('locality')).toBe('auto');
    expect(tracker.canAutofill('locality')).toBe(true);

    tracker.markUser('locality');
    expect(tracker.sourceOf('locality')).toBe('user');
    expect(tracker.canAutofill('locality')).toBe(false);
    tracker.markUser('locality'); // A manual clear is still a user decision.
    expect(tracker.canAutofill('locality')).toBe(false);
  });

  it('matches locality only when the full label/value is an exact unique match', () => {
    const choices = [
      { value: 'Hlavná', label: 'Hlavná' },
      { value: 'Námestie osloboditeľov', label: 'Námestie osloboditeľov' },
    ];

    expect(findExactUniqueLocality('Hlavná', choices)).toEqual(choices[0]);
    expect(findExactUniqueLocality(' hlavná ', choices)).toBeUndefined();
    expect(findExactUniqueLocality('Hlavná 1', choices)).toBeUndefined();
    expect(
      findExactUniqueLocality('Hlavná', [
        ...choices,
        { value: 'Hlavná', label: 'Hlavná' },
      ])
    ).toBeUndefined();
  });
});
