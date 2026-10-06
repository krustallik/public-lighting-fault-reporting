import { describe, expect, it } from 'vitest';
import { rankLocalityMatches } from '@/utils/localitySearch';

const choices = [
  { value: 'Hlavná ulica', label: 'Hlavná ulica' },
  { value: 'Špitálska', label: 'Špitálska' },
  { value: 'Malá cesta', label: 'Malá cesta' },
  { value: 'Nová ulica', label: 'Nová ulica' },
  { value: 'Dlhá', label: 'Dlhá' },
];

describe('local locality search', () => {
  it('ranks prefixes before substring matches', () => {
    expect(rankLocalityMatches('ulica', choices).map(({ value }) => value)).toEqual([
      'Hlavná ulica',
      'Nová ulica',
    ]);
    expect(rankLocalityMatches('hlav', choices).map(({ value }) => value)).toEqual(['Hlavná ulica']);
  });

  it('matches case and Slovak diacritics without changing canonical values', () => {
    expect(rankLocalityMatches('spitalska', choices)[0]?.value).toBe('Špitálska');
    expect(rankLocalityMatches('MALA', choices)[0]?.value).toBe('Malá cesta');
  });

  it('caps the visible results and returns canonical records', () => {
    expect(rankLocalityMatches('', choices, 2)).toEqual(choices.slice(0, 2));
  });
});
