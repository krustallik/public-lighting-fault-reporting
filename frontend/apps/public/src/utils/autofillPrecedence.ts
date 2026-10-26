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

/** Match a canonical VO street at the start of a stored or reverse-geocoded address. */
export function findUniqueLocalityInAddress(
  address: string,
  choices: readonly LocalityChoice[] = AUSEMIO_VO_LOCALITIES
): LocalityChoice | undefined {
  const normalizedAddress = address.normalize('NFC').trim().toLocaleLowerCase('sk');
  if (!normalizedAddress) return undefined;

  const matches = choices.filter((choice) => {
    const normalizedLocality = choice.value.normalize('NFC').trim().toLocaleLowerCase('sk');
    if (!normalizedLocality || choice.label !== choice.value) return false;
    if (normalizedAddress === normalizedLocality) return true;
    if (!normalizedAddress.startsWith(normalizedLocality)) return false;
    return /^[\s,./-]/u.test(normalizedAddress.slice(normalizedLocality.length));
  });
  if (matches.length === 0) return undefined;

  const longestLength = Math.max(...matches.map((choice) => choice.value.length));
  const longest = matches.filter((choice) => choice.value.length === longestLength);
  return new Set(longest.map((choice) => choice.value)).size === 1 ? longest[0] : undefined;
}
