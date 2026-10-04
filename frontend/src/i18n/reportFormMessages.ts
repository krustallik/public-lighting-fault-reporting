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
    invalidEmail: string;
    invalidPhone: string;
    consentRequired: string;
    invalidFile: string;
    invalidOption: string;
    maxFileSize: (maxMiB: number) => string;
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
    attachmentsLabel: string;
    attachmentsHint: string;
    contactLegend: string;
    phoneLabel: string;
    emailLabel: string;
    consentCheckbox: string;
    consentPrivacyLink: string;
    consentDataNoticeBefore: string;
    consentDataNoticeLinkLabel: string;
    consentDataNoticeAfter: string;
    back: string;
    backToMap: string;
    next: string;
    nextLoading: string;
    submit: string;
    submitting: string;
    submitFailed: string;
    inventoryPrefix: string;
  };
  locationBlocks: Record<'Q10' | 'Q11' | 'Q12', string>;
  faultTypes: Record<
    'Q' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q6' | 'Q10' | 'Q61' | 'Q99',
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
    invalidEmail: 'Neplatný e-mail',
    invalidPhone:
      'Neplatné telefónne číslo. Použite +421XXXXXXXXX, 421XXXXXXXXX alebo 09XXXXXXXX.',
    consentRequired: 'Musíte súhlasiť so spracovaním osobných údajov',
    invalidFile: 'Neplatný súbor',
    invalidOption: 'Vyberte platnú možnosť VO',
    maxFileSize: (maxMiB) => `Súbor môže mať najviac ${maxMiB} MiB`,
  },
  form: {
    title: 'Formulár nahlásenia poruchy',
    customLocationBanner:
      'Hlásenie na zvolenom mieste mimo evidovaných stĺpov v databáze.',
    step: (current, total) => `Krok ${current} z ${total}`,
    testModeHint:
      'Testovací režim — údaje sa odosielajú len na lokálny backend, nie priamo do AUSEMIO.',
    selectedCoordinates: 'Zvolené súradnice',
    streetLabel: 'Ulica / Miesto poruchy / Lokalita',
    streetCustomHint:
      'Vyberte lokalitu zo zoznamu. Ak sa adresa evidovaného stĺpa nezhoduje presne, vyberte ju ručne.',
    detailLabel: 'Bližší popis / orientačný bod / číslo stožiara',
    detailCustomHint:
      'Po odoslaní sa na koniec doplnia súradnice z mapy a poznámka, že stĺp nie je v databáze.',
    locationBlockLabel: 'Lokalizácia - Blok',
    locationBlockPlaceholder: '— vyberte lokalizáciu —',
    faultTypeLabel: 'Typ poruchy',
    faultTypePlaceholder: '— vyberte typ poruchy —',
    otherFaultLabel: 'Iný druh poruchy',
    attachmentsLabel: 'Prílohy',
    attachmentsHint:
      'Možno vybrať viacero súborov. Každý súbor môže mať najviac 30 MiB.',
    contactLegend: 'Kontakt',
    phoneLabel: 'Tel. kontakt na Vás',
    emailLabel: 'E-mail',
    consentCheckbox: 'Súhlasím so spracovaním osobných údajov na účely lokálneho testu.',
    consentPrivacyLink: 'Podmienky ochrany osobných údajov',
    consentDataNoticeBefore:
      'Testovací formulár sa odosiela iba lokálnemu testovaciemu endpointu; neodosiela sa systému ',
    consentDataNoticeLinkLabel: 'AUSEMIO',
    consentDataNoticeAfter: ' a údaje sa tam neukladajú.',
    back: 'Späť',
    backToMap: 'Späť na mapu',
    next: 'Ďalej',
    nextLoading: 'Načítavam polohu…',
    submit: 'Odoslať na lokálny testovací endpoint',
    submitting: 'Odosiela sa…',
    submitFailed: 'Odoslanie zlyhalo',
    inventoryPrefix: 'Inventárne číslo',
  },
  locationBlocks: {
    Q10: 'Pred blokom',
    Q11: 'Vedľa bloku',
    Q12: 'Za blokom',
  },
  faultTypes: {
    Q: 'Svietidlo vôbec nesvieti',
    Q1: 'Svietidlo sa rozsvieti a po určitom čase / niekoľkých minútach zhasne',
    Q2: 'Nesvieti celá skupina svietidiel',
    Q3: 'Poškodený stožiar',
    Q4: 'Odkryté elektrické zariadenie / kabeláž',
    Q6: 'Poškodená pätica / pätka / betónový základ',
    Q10: 'Krivý alebo nahnutý stožiar / výložník / svietidlo',
    Q61: 'Potrebný orez drevín - zarastený stožiar / rozvádzač',
    Q99: 'Iný druh poruchy',
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
    invalidEmail: 'Invalid email address',
    invalidPhone:
      'Invalid phone number. Use +421XXXXXXXXX, 421XXXXXXXXX, or 09XXXXXXXX.',
    consentRequired: 'You must agree to personal data processing',
    invalidFile: 'Invalid file',
    invalidOption: 'Select a valid VO option',
    maxFileSize: (maxMiB) => `Each file must be no larger than ${maxMiB} MiB`,
  },
  form: {
    title: 'Public lighting fault report form',
    customLocationBanner:
      'Report at a selected location outside street lights recorded in the database.',
    step: (current, total) => `Step ${current} of ${total}`,
    testModeHint:
      'Test mode — data is sent to the local backend only, not directly to AUSEMIO.',
    selectedCoordinates: 'Selected coordinates',
    streetLabel: 'Ulica / Miesto poruchy / Lokalita',
    streetCustomHint:
      'Select a locality. If the inventory address is not an exact match, choose one manually.',
    detailLabel: 'Bližší popis / orientačný bod / číslo stožiara',
    detailCustomHint:
      'On submit, map coordinates and a note that the pole is not in the database will be appended.',
    locationBlockLabel: 'Lokalizácia - Blok',
    locationBlockPlaceholder: '— select location —',
    faultTypeLabel: 'Typ poruchy',
    faultTypePlaceholder: '— select fault type —',
    otherFaultLabel: 'Iný druh poruchy',
    attachmentsLabel: 'Attachments',
    attachmentsHint:
      'You can select multiple files. Each file may be up to 30 MiB.',
    contactLegend: 'Contact',
    phoneLabel: 'Tel. kontakt na Vás',
    emailLabel: 'Email',
    consentCheckbox: 'I agree to personal data processing for this local test.',
    consentPrivacyLink: 'Privacy policy',
    consentDataNoticeBefore:
      'The test form is sent only to the local test endpoint and is not sent to ',
    consentDataNoticeLinkLabel: 'AUSEMIO',
    consentDataNoticeAfter: '; no data is stored there.',
    back: 'Back',
    backToMap: 'Back to map',
    next: 'Next',
    nextLoading: 'Loading location…',
    submit: 'Send to local test endpoint',
    submitting: 'Submitting…',
    submitFailed: 'Submission failed',
    inventoryPrefix: 'Inventory number',
  },
  locationBlocks: {
    Q10: 'Pred blokom',
    Q11: 'Vedľa bloku',
    Q12: 'Za blokom',
  },
  faultTypes: {
    Q: 'Svietidlo vôbec nesvieti',
    Q1: 'Svietidlo sa rozsvieti a po určitom čase / niekoľkých minútach zhasne',
    Q2: 'Nesvieti celá skupina svietidiel',
    Q3: 'Poškodený stožiar',
    Q4: 'Odkryté elektrické zariadenie / kabeláž',
    Q6: 'Poškodená pätica / pätka / betónový základ',
    Q10: 'Krivý alebo nahnutý stožiar / výložník / svietidlo',
    Q61: 'Potrebný orez drevín - zarastený stožiar / rozvádzač',
    Q99: 'Iný druh poruchy',
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
