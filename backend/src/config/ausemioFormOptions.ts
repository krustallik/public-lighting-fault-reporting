/** Canonical current AUSEMIO VO codes for service 2. */
export const AUSEMIO_FAULT_TYPE_OTHER = 'Q99';

export const AUSEMIO_FAULT_TYPE_VALUES = [
  'Q',
  'Q1',
  'Q2',
  'Q3',
  'Q4',
  'Q6',
  'Q10',
  'Q61',
  AUSEMIO_FAULT_TYPE_OTHER,
] as const;

export const AUSEMIO_LOCATION_BLOCK_VALUES = ['Q10', 'Q11', 'Q12'] as const;

export function isOtherFaultType(value: string): boolean {
  return value === AUSEMIO_FAULT_TYPE_OTHER;
}

export function isValidFaultType(value: string): boolean {
  return (AUSEMIO_FAULT_TYPE_VALUES as readonly string[]).includes(value);
}

export function isValidLocationBlock(value: string): boolean {
  return (AUSEMIO_LOCATION_BLOCK_VALUES as readonly string[]).includes(value);
}
