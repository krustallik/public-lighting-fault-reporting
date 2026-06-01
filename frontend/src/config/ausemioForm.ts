/** AUSEMIO Košice form values used on the public report page (test mode). */

export const AUSEMIO_SERVICE_VO = '2' as const;
export const AUSEMIO_SERVICE_LABEL = 'VO - Verejné osvetlenie';

export const AUSEMIO_LOCATION_BLOCKS = [
  { value: 'Q8', label: 'Pred blokom' },
  { value: 'Q9', label: 'Vedľa bloku' },
  { value: 'Q10', label: 'Za blokom' },
] as const;

/** AUSEMIO `properties[typ_poruchy]` codes for VO (verejné osvetlenie). */
export const AUSEMIO_FAULT_TYPE_OTHER = 'Q' as const;

export const AUSEMIO_FAULT_TYPES = [
  { value: 'Q1', label: 'Svietidlo vôbec nesvieti' },
  {
    value: 'Q2',
    label: 'Svietidlo sa rozsvieti a po určitom čase / niekoľkých minútach zhasne',
  },
  { value: 'Q3', label: 'Nesvieti celá skupina svietidiel' },
  { value: 'Q4', label: 'Poškodený stožiar' },
  { value: 'Q5', label: 'Odkryté elektrické zariadenie / kabeláž' },
  { value: 'Q6', label: 'Poškodená pätica / pätka / betónový základ' },
  {
    value: 'Q7',
    label: 'Krivý alebo nahnutý stožiar / výložník / svietidlo',
  },
  {
    value: 'Q8',
    label: 'Potrebný orez drevín - zarastený stožiar / rozvádzač',
  },
  { value: AUSEMIO_FAULT_TYPE_OTHER, label: 'Iný druh poruchy' },
] as const;

export function isOtherFaultType(value: string): boolean {
  return value === AUSEMIO_FAULT_TYPE_OTHER;
}

export const MAX_REPORT_FILES = 5;
