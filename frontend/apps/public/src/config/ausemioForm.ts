/** Public-client VO values used by the product's local test submission form. */

export const AUSEMIO_SERVICE_VO = '2' as const;
export const AUSEMIO_SERVICE_LABEL = 'VO - Verejné osvetlenie';

export const AUSEMIO_LOCATION_BLOCKS = [
  { value: 'Q10', label: 'Pred blokom' },
  { value: 'Q11', label: 'Vedľa bloku' },
  { value: 'Q12', label: 'Za blokom' },
] as const;

export const AUSEMIO_FAULT_TYPE_OTHER = 'Q99' as const;

export const AUSEMIO_FAULT_TYPES = [
  { value: 'Q', label: 'Svietidlo vôbec nesvieti' },
  {
    value: 'Q1',
    label: 'Svietidlo sa rozsvieti a po určitom čase / niekoľkých minútach zhasne',
  },
  { value: 'Q2', label: 'Nesvieti celá skupina svietidiel' },
  { value: 'Q3', label: 'Poškodený stožiar' },
  { value: 'Q4', label: 'Odkryté elektrické zariadenie / kabeláž' },
  { value: 'Q6', label: 'Poškodená pätica / pätka / betónový základ' },
  {
    value: 'Q10',
    label: 'Krivý alebo nahnutý stožiar / výložník / svietidlo',
  },
  {
    value: 'Q61',
    label: 'Potrebný orez drevín - zarastený stožiar / rozvádzač',
  },
  { value: AUSEMIO_FAULT_TYPE_OTHER, label: 'Iný druh poruchy' },
] as const;

export const AUSEMIO_PUBLIC_FILE_MAX_BYTES = 30 * 1024 * 1024;

/** Literal local multipart keys retained from the confirmed public client form. */
export const AUSEMIO_FIELDS = {
  service: 'properties[vyber_sluzby]',
  location: 'properties[ulica_miesto_poruchy_lokalita]',
  detailDescription: 'properties[detail_decription]',
  locationBlock: 'properties[lokalizacia_blok]',
  faultType: 'properties[typ_poruchy]',
  otherFault: 'properties[iny_druh_poruchy]',
  phone: 'properties[tel_cislo]',
  files: 'files[]',
  email: 'email',
  locale: 'locale',
} as const;

export const AUSEMIO_SUBMIT_LOCALES = ['sk', 'en'] as const;
export type AusemioSubmitLocale = (typeof AUSEMIO_SUBMIT_LOCALES)[number];
