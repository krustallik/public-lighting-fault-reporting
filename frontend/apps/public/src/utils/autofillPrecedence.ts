import { AUSEMIO_VO_LOCALITIES } from '@/config/data/ausemioVoLocalities.generated';

export type AutofillSource = 'untouched' | 'auto' | 'user';

export class AutofillPrecedenceTracker<Field extends string> {
  private readonly sources = new Map<Field, AutofillSource>();

  sourceOf(field: Field): AutofillSource {
    return this.sources.get(field) ?? 'untouched';
  }

  canAutofill(field: Field): boolean {
    return this.sourceOf(field) !== 'user';
  }

  markAuto(field: Field): void {
    if (this.canAutofill(field)) {
      this.sources.set(field, 'auto');
    }
  }

  markUser(field: Field): void {
    this.sources.set(field, 'user');
  }

  reset(): void {
    this.sources.clear();
  }
}

export interface LocalityChoice {
  value: string;
  label: string;
}

export function findExactUniqueLocality(
  address: string,
  choices: readonly LocalityChoice[] = AUSEMIO_VO_LOCALITIES
): LocalityChoice | undefined {
  const matches = choices.filter(
    (choice) => choice.value === address && choice.label === address
  );
  return matches.length === 1 ? matches[0] : undefined;
}
