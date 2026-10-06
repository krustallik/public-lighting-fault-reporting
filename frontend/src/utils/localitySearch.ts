export interface LocalityChoice {
  value: string;
  label: string;
}

export function normalizeLocalityQuery(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('sk')
    .trim();
}

export function rankLocalityMatches<T extends LocalityChoice>(
  query: string,
  choices: readonly T[],
  limit = 8
): T[] {
  const normalizedQuery = normalizeLocalityQuery(query);
  const ranked = choices
    .map((choice, index) => {
      const normalizedLabel = normalizeLocalityQuery(choice.label);
      const normalizedValue = normalizeLocalityQuery(choice.value);
      const matchText = normalizedLabel.includes(normalizedQuery) || normalizedValue.includes(normalizedQuery);
      const startsWith = normalizedLabel.startsWith(normalizedQuery) || normalizedValue.startsWith(normalizedQuery);
      return { choice, index, startsWith, matchText };
    })
    .filter(({ matchText }) => !normalizedQuery || matchText)
    .sort((left, right) => {
      if (!normalizedQuery) return left.index - right.index;
      if (left.startsWith !== right.startsWith) return left.startsWith ? -1 : 1;
      return left.index - right.index;
    });

  return ranked.slice(0, Math.max(0, limit)).map(({ choice }) => choice);
}
