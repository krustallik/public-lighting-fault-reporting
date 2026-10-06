import type { ReportFormLocale } from './reportFormLocale';

export interface ReportFormMessages {
  locale: {
    label: string;
    sk: string;
    en: string;
  };
  validation: {
    streetRequired: string;
    localityChooseCanonical: string;
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
    faultTypeLabel: string;
    otherFaultLabel: string;
    attachmentsLabel: string;
    attachmentsHint: string;
    contactLegend: string;
    phoneLabel: string;
    phoneHint: string;
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
    deviceTargetBanner: string;
    manualTargetBanner: string;
    languageFieldLabel: string;
    errorSummary: string;
    localityPlaceholder: string;
    localityNoMatches: string;
    addressCoordinates: string;
    addressSuggestionLoading: string;
    addressSuggestionButton: string;
    addressSuggestionApplied: string;
    addressSuggestionPreserved: string;
    addressSuggestionEmpty: string;
    addressSuggestionUnavailable: string;
    addressSuggestionPrivacyNotice: string;
    addressAutocompleteHint: string;
    addressAutocompleteLoading: string;
    addressAutocompleteEmpty: string;
    addressAutocompleteUnavailable: string;
    addressAutocompleteApplied: string;
    addressAutocompleteChoose: string;
    copyCoordinates: string;
    coordinatesCopied: string;
    coordinatesCopyFallback: string;
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
  map: {
    regionLabel: string;
    hint: string;
    continueWithoutMap: string;
    resumeSelectedLocation: string;
    selectedLocationHidden: string;
    languageControlLabel: string;
    slovakLanguageLabel: string;
    englishLanguageLabel: string;
    lightThemeLabel: string;
    darkThemeLabel: string;
    toggleThemeLabel: string;
    recenterLabel: string;
    recenterBlocked: string;
    recenterStatus: string;
    locationFailure: string;
    locationMessages: Record<'requesting' | 'denied' | 'timeout' | 'unsupported' | 'unavailable', string>;
    targetRequiredNotice: string;
    pointsFailure: string;
    tilesFailure: string;
    tilesNotConfigured: string;
    dataUseSummary: string;
    dataUseNotice: string;
    zoomIn: string;
    zoomOut: string;
    fallbackPointsTitle: string;
    fallbackPointsHint: string;
    fallbackPointsSearch: string;
    fallbackPointsCount: (count: number) => string;
    mapFailure: string;
    addressUnavailable: string;
    pointType: string;
    pointAddress: string;
    pointStatus: string;
    statusValues: Record<'active' | 'inactive' | 'maintenance', string>;
    choosePoint: string;
    customMarkerAlt: string;
    deviceMarkerAlt: string;
    targetCustomSummary: string;
    targetDeviceSummary: string;
    targetManualSummary: string;
    coordinateError: string;
    geolocationStatus: string;
  };
  confirmation: {
    title: string;
    coordinates: string;
    deviceNote: string;
    manualNote: string;
    cancel: string;
    confirm: string;
    hideAndInspectMap: string;
  };
  result: {
    fallbackTitle: string;
    fallbackEmpty: string;
    fallbackHint: string;
    successTitle: string;
    failureTransport: string;
    failureGeneric: string;
    statusAccessibleLabel: string;
    localTestBadge: string;
    successMessage: string;
    endpointResult: string;
    statusLocalTestReceived: string;
    explanation: string;
    failureExplanation: string;
    backToMap: string;
    newTest: string;
  };
}

const sk: ReportFormMessages = {
  locale: {
    label: 'Jazyk formulára',
    sk: 'SK',
    en: 'EN',
  },
  validation: {
    streetRequired: 'Ulica / miesto poruchy / lokalita je povinná',
    localityChooseCanonical: 'Napíšte názov a vyberte ho z návrhov ako platnú lokalitu.',
    invalidEmail: 'Neplatný e-mail',
    invalidPhone: 'Zadajte číslo v medzinárodnom formáte, napr. +421901234567 (8 až 15 číslic).',
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
    faultTypeLabel: 'Typ poruchy',
    otherFaultLabel: 'Iný druh poruchy',
    attachmentsLabel: 'Prílohy',
    attachmentsHint:
      'Možno vybrať viacero súborov. Každý súbor môže mať najviac 30 MiB.',
    contactLegend: 'Kontakt',
    phoneLabel: 'Tel. kontakt na Vás',
    phoneHint: 'Zadajte medzinárodné číslo s + a kódom krajiny, napr. +421901234567. Povolených je 8 až 15 číslic; krajina sa nedoplní automaticky.',
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
    deviceTargetBanner: 'Výslovne ste vybrali polohu zariadenia ako cieľ hlásenia.',
    manualTargetBanner: 'Miesto hlásenia zadáte ručne vo formulári.',
    languageFieldLabel: 'Jazyk odoslaného formulára: slovenčina (sk)',
    errorSummary: 'Skontrolujte označené polia a opravte chyby.',
    localityPlaceholder: 'Začnite písať názov lokality…',
    localityNoMatches: 'Nenašli sa zhody. Vyberte kanonickú lokalitu z návrhov.',
    addressCoordinates: 'Zvolené súradnice',
    addressSuggestionLoading: 'Hľadám adresu…',
    addressSuggestionButton: 'Navrhnúť adresu pre vybrané súradnice',
    addressSuggestionApplied: 'Adresa bola navrhnutá pre zvolené súradnice. Skontrolujte ju a upravte.',
    addressSuggestionPreserved: 'Vaše ručne zadané údaje zostali zachované.',
    addressSuggestionEmpty: 'Adresa sa nenašla. Adresu a lokalitu môžete zadať ručne.',
    addressSuggestionUnavailable: 'Návrh adresy pre zvolené súradnice nie je dostupný. Adresu a lokalitu môžete zadať ručne.',
    addressSuggestionPrivacyNotice: 'Ak je Geoapify aktivovaný, kliknutím odošlete vybrané súradnice a jazyk formulára na návrh adresy.',
    addressAutocompleteHint: 'Voliteľná textová pomoc: ak je Geoapify aktivovaný, po zadaní aspoň troch znakov sa odošle tento text a jazyk formulára. Výber zmení len toto pole; môžete pokračovať ručne.',
    addressAutocompleteLoading: 'Hľadajú sa textové návrhy…',
    addressAutocompleteEmpty: 'Nenašli sa návrhy. Pokračujte ručným zadaním.',
    addressAutocompleteUnavailable: 'Textové návrhy nie sú dostupné. Popis môžete zadať ručne.',
    addressAutocompleteApplied: 'Textový návrh bol vložený do popisu. Skontrolujte ho a upravte.',
    addressAutocompleteChoose: 'Vybrať textový návrh',
    copyCoordinates: 'Kopírovať súradnice',
    coordinatesCopied: 'Súradnice boli skopírované.',
    coordinatesCopyFallback: 'Súradnice sú zobrazené vyššie a môžete ich skopírovať ručne.',
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
  map: {
    regionLabel: 'Mapa Košíc a evidovaných svetelných bodov',
    hint: 'Vyberte evidovaný svetelný bod alebo kliknite na mapu a označte vlastné miesto.',
    continueWithoutMap: 'Pokračovať bez výberu bodu na mape',
    resumeSelectedLocation: 'Pokračovať s vybraným miestom',
    selectedLocationHidden: 'Vybrané miesto zostáva označené. Môžete prezrieť mapu a potom znovu otvoriť potvrdenie.',
    languageControlLabel: 'Jazyk rozhrania',
    slovakLanguageLabel: 'Slovenčina',
    englishLanguageLabel: 'Angličtina',
    lightThemeLabel: 'Svetlá mapa',
    darkThemeLabel: 'Tmavá mapa',
    toggleThemeLabel: 'Prepnúť tému mapy',
    recenterLabel: 'Vycentrovať mapu na polohu zariadenia',
    recenterBlocked: 'Vycentrovanie podľa polohy je vypnuté do schválenia mapových podmienok.',
    recenterStatus: 'Mapa bola vycentrovaná. Poloha nie je vybraná ako cieľ hlásenia.',
    locationFailure: 'Poloha zariadenia nie je dostupná.',
    locationMessages: {
      requesting: 'Zisťuje sa poloha zariadenia…',
      denied: 'Poloha nie je povolená.',
      timeout: 'Poloha sa nepodarila zistiť.',
      unsupported: 'Poloha nie je podporovaná.',
      unavailable: 'Poloha zariadenia nie je dostupná.',
    },
    targetRequiredNotice: 'Výber miesta sa po obnovení stránky stratil. Vyberte miesto znova.',
    pointsFailure: 'Evidované body sa nepodarilo načítať. Môžete pokračovať bez bodu na mape.',
    tilesFailure: 'Podklad mapy nie je dostupný. Pokračovanie vo formulári zostáva možné.',
    tilesNotConfigured: 'Podklad mapy nie je zapnutý pre toto nasadenie. Môžete pokračovať bez bodu na mape.',
    dataUseSummary: 'Ako sa používa poloha a text',
    dataUseNotice: 'Pri vstupe prehliadač jednorazovo požiada o polohu; tá môže zmeniť iba výrez mapy a cieľ vyberiete osobitne. Povolenie prehliadača nie je súhlasom s odoslaním polohy tretej strane. Ak sa aktivuje CARTO, požiadavky na dlaždice prezradia zobrazený výrez a odošlú bežné HTTP metadáta. Ak sa aktivuje Geoapify, vybrané súradnice a jazyk sa odošlú až po kliknutí na návrh adresy; textové návrhy odošlú text z poľa bližšieho popisu a jazyk formulára. Manuálne zadanie zostáva dostupné. Finálne oznámenie vyžaduje kvalifikované právne posúdenie.',
    zoomIn: 'Priblížiť mapu',
    zoomOut: 'Oddialiť mapu',
    fallbackPointsTitle: 'Vybrať evidovaný svetelný bod',
    fallbackPointsHint: 'Mapa nie je dostupná. Vyhľadajte evidovaný bod alebo pokračujte ručne.',
    fallbackPointsSearch: 'Hľadať podľa adresy alebo inventárneho čísla',
    fallbackPointsCount: (count) => `Počet nájdených bodov: ${count}`,
    mapFailure: 'Mapu sa nepodarilo zobraziť. Môžete pokračovať bez bodu na mape.',
    addressUnavailable: 'Adresa nie je k dispozícii',
    pointType: 'Typ',
    pointAddress: 'Adresa',
    pointStatus: 'Stav',
    statusValues: { active: 'Aktívny', inactive: 'Neaktívny', maintenance: 'Údržba' },
    choosePoint: 'Vybrať tento svetelný bod',
    customMarkerAlt: 'Vlastné miesto na mape',
    deviceMarkerAlt: 'Poloha zariadenia — vybrať ako cieľ',
    targetCustomSummary: 'Vami vybrané miesto na mape.',
    targetDeviceSummary: 'Poloha vášho zariadenia.',
    targetManualSummary: 'Miesto zadáte ručne vo formulári.',
    coordinateError: 'Zadajte platnú zemepisnú šírku a dĺžku.',
    geolocationStatus: 'Stav polohy zariadenia',
  },
  confirmation: {
    title: 'Potvrďte miesto hlásenia',
    coordinates: 'Súradnice',
    deviceNote: 'Poloha zariadenia sa použije ako cieľ hlásenia až po tomto potvrdení.',
    manualNote: 'Lokalitu a bližší popis zadáte vo formulári.',
    cancel: 'Zrušiť',
    confirm: 'Potvrdiť miesto',
    hideAndInspectMap: 'Skryť a prezrieť mapu',
  },
  result: {
    fallbackTitle: 'Výsledok lokálneho testu',
    fallbackEmpty: 'Nie sú dostupné údaje lokálneho testu.',
    fallbackHint: 'Vyberte miesto na mape a pokračujte do formulára. Odoslanie je určené iba pre lokálny testovací endpoint.',
    successTitle: 'LOCAL TEST / SIMULATED',
    failureTransport: 'Lokálny testovací endpoint nie je dostupný',
    failureGeneric: 'Lokálny test nebol dokončený',
    statusAccessibleLabel: 'Stav lokálneho testu',
    localTestBadge: 'LOCAL TEST',
    successMessage: 'Požiadavku prijal iba lokálny testovací endpoint; do AUSEMIO sa neodoslala.',
    endpointResult: 'Výsledok lokálneho endpointu: ',
    statusLocalTestReceived: 'prijaté iba lokálnym testovacím endpointom',
    explanation: 'Požiadavku prijal iba POST /api/dev/ausemio-test-submit. Nebola odoslaná do AUSEMIO/DPMK a nepotvrdzuje prijatie externým systémom. Prechodná požiadavka a minimálne potvrdenie sú viditeľné v DevTools → Network.',
    failureExplanation: 'Nepoužil sa žiadny náhradný spôsob odoslania.',
    backToMap: 'Späť na mapu',
    newTest: 'Nový lokálny test',
  },
};

const en: ReportFormMessages = {
  locale: {
    label: 'Form language',
    sk: 'SK',
    en: 'EN',
  },
  validation: {
    streetRequired: 'Street / fault location is required',
    localityChooseCanonical: 'Type a name and select a valid canonical locality from the suggestions.',
    invalidEmail: 'Invalid email address',
    invalidPhone: 'Enter an international number such as +421901234567 (8–15 digits).',
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
    streetLabel: 'Street / fault location / locality',
    streetCustomHint:
      'Search and select a canonical locality. If the inventory address is not an exact match, choose one manually.',
    detailLabel: 'Additional description / landmark / pole number',
    detailCustomHint:
      'On submit, map coordinates and a note that the pole is not in the database will be appended.',
    locationBlockLabel: 'Location relative to block',
    faultTypeLabel: 'Fault type',
    otherFaultLabel: 'Other type of fault',
    attachmentsLabel: 'Attachments',
    attachmentsHint:
      'You can select multiple files. Each file may be up to 30 MiB.',
    contactLegend: 'Contact',
    phoneLabel: 'Phone number',
    phoneHint: 'Enter an international number with + and its country code, e.g. +421901234567. Use 8–15 digits; a country code is never added automatically.',
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
    deviceTargetBanner: 'You explicitly selected your device location as the report target.',
    manualTargetBanner: 'Enter the report location manually in the form.',
    languageFieldLabel: 'Form submission language: English (en)',
    errorSummary: 'Check the highlighted fields and correct the errors.',
    localityPlaceholder: 'Start typing a locality…',
    localityNoMatches: 'No matches. Select a canonical locality from the suggestions.',
    addressCoordinates: 'Selected coordinates',
    addressSuggestionLoading: 'Looking up address…',
    addressSuggestionButton: 'Suggest address for selected coordinates',
    addressSuggestionApplied: 'An address was suggested for the selected coordinates. Review and edit it.',
    addressSuggestionPreserved: 'Your manually entered information was kept.',
    addressSuggestionEmpty: 'No address was found. You can enter the address and locality manually.',
    addressSuggestionUnavailable: 'Address suggestion for the selected coordinates is unavailable. Enter the address and locality manually.',
    addressSuggestionPrivacyNotice: 'If Geoapify is activated, clicking this button sends the selected coordinates and form language for an address suggestion.',
    addressAutocompleteHint: 'Optional text assistance: if Geoapify is activated, this text and the form language are sent after you enter at least three characters. Choosing a suggestion changes only this field; you can continue manually.',
    addressAutocompleteLoading: 'Looking for text suggestions…',
    addressAutocompleteEmpty: 'No suggestions found. Continue by entering the description manually.',
    addressAutocompleteUnavailable: 'Text suggestions are unavailable. You can enter the description manually.',
    addressAutocompleteApplied: 'The text suggestion was inserted in the description. Review and edit it.',
    addressAutocompleteChoose: 'Select text suggestion',
    copyCoordinates: 'Copy coordinates',
    coordinatesCopied: 'Coordinates copied.',
    coordinatesCopyFallback: 'Coordinates are shown above; copy them manually if needed.',
  },
  locationBlocks: {
    Q10: 'In front of the block',
    Q11: 'Beside the block',
    Q12: 'Behind the block',
  },
  faultTypes: {
    Q: 'Street light does not turn on',
    Q1: 'Street light turns on and goes out after some time or a few minutes',
    Q2: 'An entire group of street lights is out',
    Q3: 'Damaged pole',
    Q4: 'Exposed electrical equipment or wiring',
    Q6: 'Damaged socket, pole base or concrete foundation',
    Q10: 'Bent or leaning pole, bracket or luminaire',
    Q61: 'Trees need trimming; pole or cabinet is overgrown',
    Q99: 'Other type of fault',
  },
  customLocationNote: {
    noPoleInDb:
      'Note: The selected pole is not recorded in the database. The citizen manually chose a location on the map.',
    coordinates: (lat, lng) =>
      `Coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
  },
  map: {
    regionLabel: 'Map of Košice and recorded street lights',
    hint: 'Select an existing light point or click the map to mark a location.',
    continueWithoutMap: 'Continue without selecting a point on the map',
    resumeSelectedLocation: 'Continue with selected location',
    selectedLocationHidden: 'The selected location remains marked. Inspect the map, then reopen its confirmation to continue.',
    languageControlLabel: 'Interface language',
    slovakLanguageLabel: 'Slovak',
    englishLanguageLabel: 'English',
    lightThemeLabel: 'Light map',
    darkThemeLabel: 'Dark map',
    toggleThemeLabel: 'Switch map theme',
    recenterLabel: 'Center map on device location',
    recenterBlocked: 'Re-centering from location is disabled until map terms are approved.',
    recenterStatus: 'Map centered. The location has not been selected as a report target.',
    locationFailure: 'Device location is unavailable.',
    locationMessages: {
      requesting: 'Getting device location…',
      denied: 'Location access was denied.',
      timeout: 'Could not get the location in time.',
      unsupported: 'Device location is not supported.',
      unavailable: 'Device location is unavailable.',
    },
    targetRequiredNotice: 'The selected location was lost after the page was reloaded. Select it again.',
    pointsFailure: 'Recorded points could not be loaded. You can continue without a map point.',
    tilesFailure: 'Map tiles are unavailable. You can still continue to the form.',
    tilesNotConfigured: 'Map tiles are not enabled for this deployment. You can continue without a map point.',
    dataUseSummary: 'How location and text are used',
    dataUseNotice: 'On entry, the browser asks once for location; it may change only the map viewport, and you select a target separately. Browser permission is not consent to send location to a third party. If CARTO is activated, tile requests reveal the displayed viewport and send ordinary HTTP metadata. If Geoapify is activated, selected coordinates and form language are sent only after you click the address-suggestion button; text suggestions send the description text and form language. Manual entry remains available. Final notice wording requires qualified legal review.',
    zoomIn: 'Zoom in on map',
    zoomOut: 'Zoom out on map',
    fallbackPointsTitle: 'Choose a recorded street light',
    fallbackPointsHint: 'The map is unavailable. Search for a recorded point or continue manually.',
    fallbackPointsSearch: 'Search by address or inventory number',
    fallbackPointsCount: (count) => `Matching points: ${count}`,
    mapFailure: 'The map could not be displayed. You can continue without a map point.',
    addressUnavailable: 'Address unavailable',
    pointType: 'Type',
    pointAddress: 'Address',
    pointStatus: 'Status',
    statusValues: { active: 'Active', inactive: 'Inactive', maintenance: 'Maintenance' },
    choosePoint: 'Select this light point',
    customMarkerAlt: 'Custom map location',
    deviceMarkerAlt: 'Device location — select as report target',
    targetCustomSummary: 'Location selected on the map.',
    targetDeviceSummary: 'Your device location.',
    targetManualSummary: 'Enter the location manually in the form.',
    coordinateError: 'Enter valid latitude and longitude.',
    geolocationStatus: 'Device location status',
  },
  confirmation: {
    title: 'Confirm report location',
    coordinates: 'Coordinates',
    deviceNote: 'Your device location becomes the report target only after this confirmation.',
    manualNote: 'Enter the locality and additional description in the form.',
    cancel: 'Cancel',
    confirm: 'Confirm location',
    hideAndInspectMap: 'Hide and inspect map',
  },
  result: {
    fallbackTitle: 'Local test result',
    fallbackEmpty: 'Local test information is unavailable.',
    fallbackHint: 'Choose a location on the map and continue to the form. Submission is only for the local test endpoint.',
    successTitle: 'LOCAL TEST / SIMULATED',
    failureTransport: 'Local test endpoint is unavailable',
    failureGeneric: 'Local test was not completed',
    statusAccessibleLabel: 'Local test status',
    localTestBadge: 'LOCAL TEST',
    successMessage: 'The request was received only by the local test endpoint; it was not sent to AUSEMIO.',
    endpointResult: 'Local endpoint result: ',
    statusLocalTestReceived: 'received by the local test endpoint only',
    explanation: 'This request was received only by POST /api/dev/ausemio-test-submit. It was not sent to AUSEMIO/DPMK and does not establish acceptance by an external system. The transient request and minimal receipt are visible in DevTools → Network.',
    failureExplanation: 'No alternate submission transport was attempted.',
    backToMap: 'Back to map',
    newTest: 'New local test',
  },
};

const MESSAGES: Record<ReportFormLocale, ReportFormMessages> = { sk, en };

export function getReportFormMessages(locale: ReportFormLocale): ReportFormMessages {
  return MESSAGES[locale];
}
