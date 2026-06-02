import type { ReportFormLocale } from './reportFormLocale';

export interface ReportFormMessages {
  locale: {
    label: string;
    sk: string;
    en: string;
  };
  validation: {
    streetRequired: string;
    detailTooLong: string;
    otherFaultTooLong: string;
    failureOnTooLong: string;
    invalidEmail: string;
    invalidPhone: string;
    consentRequired: string;
    invalidFile: string;
    maxFiles: (max: number) => string;
  };
  form: {
    title: string;
    customLocationBanner: string;
    step: (current: number, total: number) => string;
    testModeHint: string;
    selectedCoordinates: string;
    streetLabel: string;
    streetCustomHint: string;
    detailLabel: string;
    detailCustomHint: string;
    locationBlockLabel: string;
    locationBlockPlaceholder: string;
    faultTypeLabel: string;
    faultTypePlaceholder: string;
    otherFaultLabel: string;
    failureOnLabel: string;
    attachmentsLabel: (max: number) => string;
    attachmentsHint: string;
    contactLegend: string;
    phoneLabel: string;
    emailLabel: string;
    consentText: string;
    back: string;
    next: string;
    nextLoading: string;
    submit: string;
    submitting: string;
    submitFailed: string;
    inventoryPrefix: string;
  };
  locationBlocks: Record<'Q8' | 'Q9' | 'Q10', string>;
  faultTypes: Record<
    'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5' | 'Q6' | 'Q7' | 'Q8' | 'Q',
    string
  >;
  customLocationNote: {
    noPoleInDb: string;
    coordinates: (lat: number, lng: number) => string;
  };
}

const sk: ReportFormMessages = {
  locale: {
    label: 'Jazyk formulára / Form language',
    sk: 'SK',
    en: 'EN',
  },
  validation: {
    streetRequired: 'Ulica / miesto poruchy / lokalita je povinná',
    detailTooLong: 'Popis je príliš dlhý',
    otherFaultTooLong: 'Text je príliš dlhý',
    failureOnTooLong: 'Hodnota je príliš dlhá',
    invalidEmail: 'Neplatný e-mail',
    invalidPhone:
      'Neplatné telefónne číslo. Použite +421XXXXXXXXX, 421XXXXXXXXX alebo 09XXXXXXXX.',
    consentRequired: 'Musíte súhlasiť so spracovaním osobných údajov',
    invalidFile: 'Neplatný súbor',
    maxFiles: (max) => `Maximálne ${max} súborov`,
  },
  form: {
    title: 'Formulár nahlásenia poruchy',
    customLocationBanner:
      'Hlásenie na zvolenom mieste mimo evidovaných stĺpov v databáze.',
    step: (current, total) => `Krok ${current} z ${total}`,
    testModeHint:
      'Testovací režim — údaje sa odosielajú len na lokálny backend, nie priamo do AUSEMIO.',
    selectedCoordinates: 'Zvolené súradnice',
    streetLabel: 'Ulica / miesto poruchy / lokalita',
    streetCustomHint:
      'Zadajte skutočnú adresu miesta poruchy (povinné). Súradnice z mapy sa odošlú v popise poruchy.',
    detailLabel: 'Bližší popis / orientačný bod / číslo stĺpa',
    detailCustomHint:
      'Po odoslaní sa na koniec doplnia súradnice z mapy a poznámka, že stĺp nie je v databáze.',
    locationBlockLabel: 'Lokalizácia - Blok (voliteľné)',
    locationBlockPlaceholder: '— vyberte lokalizáciu —',
    faultTypeLabel: 'Typ poruchy (voliteľné)',
    faultTypePlaceholder: '— vyberte typ poruchy —',
    otherFaultLabel: 'Iný druh poruchy (voliteľné)',
    failureOnLabel: 'QR / Failure on (voliteľné)',
    attachmentsLabel: (max) => `Prílohy — max. ${max}`,
    attachmentsHint:
      'Súbory sa zatiaľ ukladajú len v prehliadači a pripravujú sa na budúce odoslanie.',
    contactLegend: 'Kontakt',
    phoneLabel: 'Telefón',
    emailLabel: 'E-mail',
    consentText:
      'Súhlasím so spracovaním osobných údajov za účelom vybavenia hlásenia poruchy verejného osvetlenia.',
    back: 'Späť',
    next: 'Ďalej',
    nextLoading: 'Načítavam polohu…',
    submit: 'Odoslať hlásenie (test)',
    submitting: 'Odosiela sa…',
    submitFailed: 'Odoslanie zlyhalo',
    inventoryPrefix: 'Inventárne číslo',
  },
  locationBlocks: {
    Q8: 'Pred blokom',
    Q9: 'Vedľa bloku',
    Q10: 'Za blokom',
  },
  faultTypes: {
    Q1: 'Svietidlo vôbec nesvieti',
    Q2: 'Svietidlo sa rozsvieti a po určitom čase / niekoľkých minútach zhasne',
    Q3: 'Nesvieti celá skupina svietidiel',
    Q4: 'Poškodený stožiar',
    Q5: 'Odkryté elektrické zariadenie / kabeláž',
    Q6: 'Poškodená pätica / pätka / betónový základ',
    Q7: 'Krivý alebo nahnutý stožiar / výložník / svietidlo',
    Q8: 'Potrebný orez drevín - zarastený stožiar / rozvádzač',
    Q: 'Iný druh poruchy',
  },
  customLocationNote: {
    noPoleInDb:
      'Poznámka: Vybraný stĺp nie je evidovaný v databáze. Občan ručne zvolil polohu na mape.',
    coordinates: (lat, lng) =>
      `Súradnice: ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
  },
};

const en: ReportFormMessages = {
  locale: {
    label: 'Form language / Jazyk formulára',
    sk: 'SK',
    en: 'EN',
  },
  validation: {
    streetRequired: 'Street / fault location is required',
    detailTooLong: 'Description is too long',
    otherFaultTooLong: 'Text is too long',
    failureOnTooLong: 'Value is too long',
    invalidEmail: 'Invalid email address',
    invalidPhone:
      'Invalid phone number. Use +421XXXXXXXXX, 421XXXXXXXXX, or 09XXXXXXXX.',
    consentRequired: 'You must agree to personal data processing',
    invalidFile: 'Invalid file',
    maxFiles: (max) => `Maximum ${max} files`,
  },
  form: {
    title: 'Public lighting fault report form',
    customLocationBanner:
      'Report at a selected location outside street lights recorded in the database.',
    step: (current, total) => `Step ${current} of ${total}`,
    testModeHint:
      'Test mode — data is sent to the local backend only, not directly to AUSEMIO.',
    selectedCoordinates: 'Selected coordinates',
    streetLabel: 'Street / fault location',
    streetCustomHint:
      'Enter the actual fault location address (required). Map coordinates will be sent in the fault description.',
    detailLabel: 'Detailed description / landmark / pole number',
    detailCustomHint:
      'On submit, map coordinates and a note that the pole is not in the database will be appended.',
    locationBlockLabel: 'Location — block (optional)',
    locationBlockPlaceholder: '— select location —',
    faultTypeLabel: 'Fault type (optional)',
    faultTypePlaceholder: '— select fault type —',
    otherFaultLabel: 'Other fault type (optional)',
    failureOnLabel: 'QR / Failure on (optional)',
    attachmentsLabel: (max) => `Attachments — max. ${max}`,
    attachmentsHint:
      'Files are kept in the browser only and prepared for future submission.',
    contactLegend: 'Contact',
    phoneLabel: 'Phone',
    emailLabel: 'Email',
    consentText:
      'I agree to the processing of personal data for handling this public lighting fault report.',
    back: 'Back',
    next: 'Next',
    nextLoading: 'Loading location…',
    submit: 'Submit report (test)',
    submitting: 'Submitting…',
    submitFailed: 'Submission failed',
    inventoryPrefix: 'Inventory number',
  },
  locationBlocks: {
    Q8: 'In front of the block',
    Q9: 'Next to the block',
    Q10: 'Behind the block',
  },
  faultTypes: {
    Q1: 'Luminaire does not light at all',
    Q2: 'Luminaire turns on then goes off after some time / minutes',
    Q3: 'Entire group of luminaires is off',
    Q4: 'Damaged pole',
    Q5: 'Exposed electrical equipment / cabling',
    Q6: 'Damaged socket / base / concrete foundation',
    Q7: 'Crooked or tilted pole / bracket / luminaire',
    Q8: 'Tree trimming needed — overgrown pole / cabinet',
    Q: 'Other type of fault',
  },
  customLocationNote: {
    noPoleInDb:
      'Note: The selected pole is not recorded in the database. The citizen manually chose a location on the map.',
    coordinates: (lat, lng) =>
      `Coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
  },
};

const MESSAGES: Record<ReportFormLocale, ReportFormMessages> = { sk, en };

export function getReportFormMessages(locale: ReportFormLocale): ReportFormMessages {
  return MESSAGES[locale];
}
