/** AUSEMIO `properties[typ_poruchy]` codes for VO — keep in sync with frontend config. */
export const AUSEMIO_FAULT_TYPE_OTHER = 'Q';

export const AUSEMIO_FAULT_TYPE_VALUES = [
  'Q1',
  'Q2',
  'Q3',
  'Q4',
  'Q5',
  'Q6',
  'Q7',
  'Q8',
  AUSEMIO_FAULT_TYPE_OTHER,
] as const;

/** AUSEMIO `properties[lokalizacia_blok]` codes — keep in sync with frontend config. */
export const AUSEMIO_LOCATION_BLOCK_VALUES = ['Q8', 'Q9', 'Q10'] as const;

export function isOtherFaultType(value: string): boolean {
  return value === AUSEMIO_FAULT_TYPE_OTHER;
}

export function isValidFaultType(value: string): boolean {
  return (AUSEMIO_FAULT_TYPE_VALUES as readonly string[]).includes(value);
}

export function isValidLocationBlock(value: string): boolean {
  return (AUSEMIO_LOCATION_BLOCK_VALUES as readonly string[]).includes(value);
}
