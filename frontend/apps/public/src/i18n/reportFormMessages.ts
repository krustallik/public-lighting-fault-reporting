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
    attachmentsSaving: string;
    attachmentsRestoring: string;
    attachmentsRestoreFailed: string;
    attachmentsSaveFailed: string;
    draftStorageNotice: string;
    draftStorageFailed: string;
    contactLegend: string;
    phoneLabel: string;
    phoneHint: string;
    emailLabel: string;
    emailVerificationLegend: string;
    emailVerificationChecking: string;
    emailVerificationHint: string;
    emailVerificationSend: string;
    emailVerificationResend: string;
    emailVerificationRequestCountdown: (seconds: number) => string;
    emailVerificationResendCountdown: (seconds: number) => string;
    emailVerificationCodeLabel: string;
    emailVerificationVerify: string;
    emailVerificationVerified: string;
    emailVerificationContinue: string;
    emailVerificationSent: string;
    emailVerificationExpired: string;
    emailVerificationStatusUnavailable: string;
    emailVerificationCodeInvalid: string;
    emailVerificationRateLimited: string;
    emailVerificationGenericError: string;
    reviewTitle: string;
    reviewEmail: string;
    reviewLocation: string;
    reviewPhone: string;
    reviewFinalHint: string;
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
    submissionRetryPending: string;
    submissionRetryUnavailable: string;
    retrySubmission: string;
    locationValidationFailed: string;
    locationValidationUnavailable: string;
    inventoryPrefix: string;
    deviceTargetBanner: string;
    manualTargetBanner: string;
    languageFieldLabel: string;
    errorSummary: string;
    localityPlaceholder: string;
    localityNoMatches: string;
    addressCoordinates: string;
    automaticAddressOnSubmit: string;
    automaticAddressQualifier: string;
    inventoryAddressLoading: string;
    inventoryAddressResolved: string;
    inventoryAddressManualHint: string;
    inventoryAddressLookupFailed: string;
    editInventoryLocality: string;
    copyCoordinates: string;
    copyCoordinatesShort: string;
    coordinatesCopied: string;
    coordinatesCopyFallback: string;
  };
  locationBlocks: Record<'Q10' | 'Q11' | 'Q12', string>;
  faultTypes: Record<
    'Q' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q6' | 'Q10' | 'Q61' | 'Q99',
    string
  >;
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
    recenterShortLabel: string;
    recenterBlocked: string;
    recenterStatus: string;
    locationFailure: string;
    locationMessages: Record<'requesting' | 'denied' | 'timeout' | 'unsupported' | 'unavailable', string>;
    targetRequiredNotice: string;
    pointsFailure: string;
    tilesFailure: string;
    tilesNotConfigured: string;
    liveTilesLoading: string;
    liveTilesUnavailable: string;
    liveTilesMisconfigured: string;
    zoomIn: string;
    zoomOut: string;
    fallbackPointsTitle: string;
    fallbackPointsHint: string;
    fallbackPointsSearch: string;
    fallbackPointsCount: (count: number) => string;
    mapFailure: string;
    mapUnavailableTitle: string;
    mapUnavailableDescription: string;
    openManualReport: string;
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
    checkingTarget: string;
    targetOutsideServiceArea: string;
    targetValidationUnavailable: string;
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
    attachmentCleanupRetryNotice: string;
    attachmentCleanupManualNotice: string;
    addressEnrichmentWarning: string;
    addressNotFoundWarning: string;
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
      'Hlásenie sa týka vlastného miesta označeného na mape, nie konkrétneho bodu vybraného z evidencie.',
    step: (current, total) => `Krok ${current} z ${total}`,
    testModeHint:
      'Testovací režim — údaje sa odosielajú len na lokálny backend, nie priamo do AUSEMIO.',
    selectedCoordinates: 'Zvolené súradnice',
    streetLabel: 'Ulica / Miesto poruchy / Lokalita',
    streetCustomHint:
      'Vyberte lokalitu zo zoznamu. Ak sa adresa evidovaného stĺpa nezhoduje presne, vyberte ju ručne.',
    detailLabel: 'Bližší popis / orientačný bod / číslo stožiara',
    detailCustomHint:
      'Súradnice vybraného miesta sa k hláseniu pridajú automaticky. Nemusíte ich uvádzať znova.',
    locationBlockLabel: 'Lokalizácia - Blok',
    faultTypeLabel: 'Typ poruchy',
    otherFaultLabel: 'Iný druh poruchy',
    attachmentsLabel: 'Prílohy',
    attachmentsHint:
      'Možno vybrať viacero súborov. Každý súbor môže mať najviac 30 MiB.',
    attachmentsSaving: 'Ukladajú sa prílohy do tohto prehliadača…',
    attachmentsRestoring: 'Obnovujú sa prílohy rozpracovanej žiadosti…',
    attachmentsRestoreFailed: 'Prílohy sa nepodarilo obnoviť. Pred pokračovaním ich vyberte znova.',
    attachmentsSaveFailed: 'Prílohy sa nepodarilo bezpečne uložiť do tohto prehliadača. Po obnovení stránky ich budete musieť vybrať znova.',
    draftStorageNotice: 'Rozpracovaná žiadosť sa uchováva v tomto prehliadači. Po 30 dňoch nečinnosti vyprší a jej lokálne údaje sa vyčistia pri ďalšom otvorení aplikácie; po odoslaní sa odstráni.',
    draftStorageFailed: 'Rozpracovanú žiadosť sa nepodarilo uložiť do tohto prehliadača. Obnovenie stránky môže vymazať zadané údaje.',
    contactLegend: 'Kontakt',
    phoneLabel: 'Tel. kontakt na Vás',
    phoneHint: 'Zadajte medzinárodné číslo s + a kódom krajiny, napr. +421901234567. Povolených je 8 až 15 číslic; krajina sa nedoplní automaticky.',
    emailLabel: 'E-mail',
    emailVerificationLegend: 'Overenie e-mailu',
    emailVerificationChecking: 'Načítavam nastavenie overenia e-mailu…',
    emailVerificationHint: 'Na túto adresu pošleme jednorazový kód. Kód platí 10 minút.',
    emailVerificationSend: 'Poslať kód',
    emailVerificationResend: 'Poslať kód znova',
    emailVerificationRequestCountdown: (seconds) => `Kód si môžete vyžiadať o ${seconds} s.`,
    emailVerificationResendCountdown: (seconds) => `Ďalší kód môžete vyžiadať o ${seconds} s.`,
    emailVerificationCodeLabel: 'Jednorazový kód',
    emailVerificationVerify: 'Overiť e-mail',
    emailVerificationVerified: 'E-mail je overený.',
    emailVerificationContinue: 'Pokračovať na kontrolu',
    emailVerificationSent: 'Kód bol odoslaný. Skontrolujte poštu a zadajte ho nižšie.',
    emailVerificationExpired: 'Platnosť kódu vypršala. Vyžiadajte si nový kód.',
    emailVerificationStatusUnavailable: 'Nastavenie overenia sa nepodarilo načítať. Obnovte stránku a skúste znova.',
    emailVerificationCodeInvalid: 'Kód je nesprávny alebo už použitý. Skontrolujte ho a skúste znova.',
    emailVerificationRateLimited: 'Príliš veľa požiadaviek. Počkajte a skúste neskôr.',
    emailVerificationGenericError: 'Overenie e-mailu je dočasne nedostupné.',
    reviewTitle: 'Skontrolujte hlásenie',
    reviewEmail: 'Overený e-mail',
    reviewLocation: 'Miesto poruchy',
    reviewPhone: 'Telefón',
    reviewFinalHint: 'V lokálnej histórii sa uchová iba čas, typ a poloha poruchy. Váš popis, telefón a prílohy sa do tejto histórie neukladajú. Pri zapnutom overení e-mailu server dočasne uchováva chránené technické odtlačky na overenie a obmedzenie požiadaviek. Hlásenie sa do AUSEMIO neodosiela.',
    consentCheckbox: 'Rozumiem spracovaniu údajov iba na účely lokálneho testu.',
    consentPrivacyLink: 'Podmienky ochrany osobných údajov',
    consentDataNoticeBefore:
      'Testovací formulár sa odosiela iba lokálnemu testovaciemu endpointu; neodosiela sa systému ',
    consentDataNoticeLinkLabel: 'AUSEMIO',
    consentDataNoticeAfter: '; lokálna história uchová iba čas, typ a polohu poruchy, nie váš popis, telefón ani prílohy. Pri zapnutom overení e-mailu sa technické odtlačky uchovávajú dočasne.',
    back: 'Späť',
    backToMap: 'Späť na mapu',
    next: 'Ďalej',
    nextLoading: 'Načítavam polohu…',
    submit: 'Odoslať na lokálny testovací endpoint',
    submitting: 'Odosiela sa…',
    submitFailed: 'Odoslanie zlyhalo',
    submissionRetryPending: 'Výsledok predchádzajúceho pokusu nie je potvrdený. Údaje zostávajú uzamknuté; zopakujte odoslanie toho istého hlásenia.',
    submissionRetryUnavailable: 'Toto hlásenie nemožno bezpečne zopakovať, pretože uložený pokus vypršal alebo sa nedá obnoviť. Pred vytvorením nového hlásenia si overte, či predchádzajúce už nebolo prijaté.',
    retrySubmission: 'Zopakovať odoslanie hlásenia',
    locationValidationFailed: 'Vybrané miesto nie je možné použiť. Vráťte sa na mapu a vyberte miesto v oblasti služby.',
    locationValidationUnavailable: 'Vybrané miesto sa teraz nepodarilo overiť. Hlásenie nebolo odoslané; skúste to znova alebo vyberte iné miesto.',
    inventoryPrefix: 'Inventárne číslo',
    deviceTargetBanner: 'Výslovne ste vybrali polohu zariadenia ako cieľ hlásenia.',
    manualTargetBanner: 'Miesto hlásenia zadáte ručne vo formulári.',
    languageFieldLabel: 'Jazyk odoslaného formulára: slovenčina (sk)',
    errorSummary: 'Skontrolujte označené polia a opravte chyby.',
    localityPlaceholder: 'Začnite písať názov lokality…',
    localityNoMatches: 'Nenašli sa zhody. Vyberte kanonickú lokalitu z návrhov.',
    addressCoordinates: 'Zvolené súradnice',
    automaticAddressOnSubmit: 'Podľa zvolených súradníc sa pri odoslaní automaticky doplní orientačná adresa.',
    automaticAddressQualifier: '* Automaticky určená adresa môže byť nepresná.',
    inventoryAddressLoading: 'Načítava sa adresa evidovaného svetelného bodu…',
    inventoryAddressResolved: 'Lokalita bola určená z adresy evidovaného svetelného bodu.',
    inventoryAddressManualHint: 'Adresa evidovaného bodu sa nedá jednoznačne priradiť k zoznamu lokalít. Vyberte lokalitu zo zoznamu.',
    inventoryAddressLookupFailed: 'Adresu evidovaného bodu sa nepodarilo automaticky určiť. Vyberte lokalitu zo zoznamu.',
    editInventoryLocality: 'Upraviť lokalitu',
    copyCoordinates: 'Kopírovať súradnice',
    copyCoordinatesShort: 'Kopírovať',
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
    recenterShortLabel: 'Moja poloha',
    recenterBlocked: 'Vycentrovanie podľa polohy zariadenia momentálne nie je dostupné.',
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
    pointsFailure: 'Evidované svetelné body sú momentálne nedostupné. Miesto môžete označiť priamo na mape.',
    tilesFailure: 'Podklad mapy nie je dostupný. Pokračovanie vo formulári zostáva možné.',
    tilesNotConfigured: 'Podklad mapy nie je zapnutý pre toto nasadenie. Môžete pokračovať bez bodu na mape.',
    liveTilesLoading: 'Načítavajú sa živé dlaždice CARTO…',
    liveTilesUnavailable: 'Živé dlaždice CARTO sa nenačítali. Skontrolujte lokálny kľúč a jeho obmedzenia.',
    liveTilesMisconfigured: 'LIVE_PROVIDER_UAT očakáva živý podklad CARTO, ale ten nie je nakonfigurovaný.',
    zoomIn: 'Priblížiť mapu',
    zoomOut: 'Oddialiť mapu',
    fallbackPointsTitle: 'Vybrať evidovaný svetelný bod',
    fallbackPointsHint: 'Mapa nie je dostupná. Vyhľadajte evidovaný bod alebo pokračujte ručne.',
    fallbackPointsSearch: 'Hľadať podľa adresy alebo inventárneho čísla',
    fallbackPointsCount: (count) => `Počet nájdených bodov: ${count}`,
    mapFailure: 'Mapu sa nepodarilo zobraziť. Môžete pokračovať bez bodu na mape.',
    mapUnavailableTitle: 'Mapa momentálne nie je dostupná',
    mapUnavailableDescription: 'Pokračujte vo formulári a zadajte miesto poruchy ručne.',
    openManualReport: 'Otvoriť formulár a zadať miesto ručne',
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
    checkingTarget: 'Overuje sa, či sa vybrané miesto nachádza v Košiciach…',
    targetOutsideServiceArea: 'Toto miesto je mimo územia Košíc. Vyberte miesto v meste.',
    targetValidationUnavailable: 'Miesto sa teraz nepodarilo overiť. Skúste výber znova.',
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
    successMessage: 'Lokálny test uložil iba metadáta o čase, type a polohe poruchy; žiadne hlásenie sa do AUSEMIO neodoslalo.',
    attachmentCleanupRetryNotice: 'Hlásenie je uložené iba v lokálnej histórii, ale odstránenie príloh z tohto prehliadača sa nepodarilo. Aplikácia sa ich pokúsi odstrániť pri ďalšom otvorení.',
    attachmentCleanupManualNotice: 'Prehliadač nepotvrdil odstránenie príloh ani uloženie požiadavky na opakovanie. Súbory alebo lokálny koncept môžu zostať v tomto prehliadači; na ich odstránenie vymažte lokálne údaje tejto stránky v nastaveniach prehliadača.',
    addressEnrichmentWarning: 'Služba na automatické určenie adresy je momentálne nedostupná. Adresu sa nepodarilo doplniť, lokálna história však zaznamenala čas, typ a zvolené súradnice; do AUSEMIO sa nič neodoslalo.',
    addressNotFoundWarning: 'Automatickú adresu sa nepodarilo určiť. Lokálna história zaznamenala čas, typ a zvolené súradnice; do AUSEMIO sa nič neodoslalo.',
    endpointResult: 'Výsledok lokálneho endpointu: ',
    statusLocalTestReceived: 'uložené iba v lokálnej histórii metadát',
    explanation: 'Lokálny test uchováva iba čas, poruchu a polohu potrebné na lokálne overenie. Opis, kontaktné údaje a súbory sa neuchovávajú. Nič sa neposlalo do AUSEMIO/DPMK a nejde o potvrdenie prijatia externým systémom.',
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
      'This report uses a location marked on the map, not a specific point selected from the inventory.',
    step: (current, total) => `Step ${current} of ${total}`,
    testModeHint:
      'Test mode — data is sent to the local backend only, not directly to AUSEMIO.',
    selectedCoordinates: 'Selected coordinates',
    streetLabel: 'Street / fault location / locality',
    streetCustomHint:
      'Search and select a canonical locality. If the inventory address is not an exact match, choose one manually.',
    detailLabel: 'Additional description / landmark / pole number',
    detailCustomHint:
      'The selected location coordinates are added to the report automatically. You do not need to enter them again.',
    locationBlockLabel: 'Location relative to block',
    faultTypeLabel: 'Fault type',
    otherFaultLabel: 'Other type of fault',
    attachmentsLabel: 'Attachments',
    attachmentsHint:
      'You can select multiple files. Each file may be up to 30 MiB.',
    attachmentsSaving: 'Saving attachments in this browser…',
    attachmentsRestoring: 'Restoring attachments for this unfinished report…',
    attachmentsRestoreFailed: 'Attachments could not be restored. Select them again before continuing.',
    attachmentsSaveFailed: 'Attachments could not be safely saved in this browser. Select them again if you reload the page.',
    draftStorageNotice: 'This unfinished report is stored in this browser. After 30 days without activity, it expires and its local data is cleared the next time you open the app; it is removed after submission.',
    draftStorageFailed: 'This unfinished report could not be saved in this browser. Reloading may clear the entered data.',
    contactLegend: 'Contact',
    phoneLabel: 'Phone number',
    phoneHint: 'Enter an international number with + and its country code, e.g. +421901234567. Use 8–15 digits; a country code is never added automatically.',
    emailLabel: 'Email',
    emailVerificationLegend: 'Email verification',
    emailVerificationChecking: 'Checking the email verification setting…',
    emailVerificationHint: 'We will send a one-time code to this address. The code is valid for 10 minutes.',
    emailVerificationSend: 'Send code',
    emailVerificationResend: 'Resend code',
    emailVerificationRequestCountdown: (seconds) => `You can request a code in ${seconds}s.`,
    emailVerificationResendCountdown: (seconds) => `You can request another code in ${seconds}s.`,
    emailVerificationCodeLabel: 'One-time code',
    emailVerificationVerify: 'Verify email',
    emailVerificationVerified: 'Email verified.',
    emailVerificationContinue: 'Continue to review',
    emailVerificationSent: 'Code sent. Check your inbox and enter it below.',
    emailVerificationExpired: 'The code expired. Request a new code.',
    emailVerificationStatusUnavailable: 'Could not check the verification setting. Refresh the page and try again.',
    emailVerificationCodeInvalid: 'The code is invalid or already used. Check it and try again.',
    emailVerificationRateLimited: 'Too many requests. Wait and try again later.',
    emailVerificationGenericError: 'Email verification is temporarily unavailable.',
    reviewTitle: 'Review your report',
    reviewEmail: 'Verified email',
    reviewLocation: 'Fault location',
    reviewPhone: 'Phone',
    reviewFinalHint: 'Local fault history retains only the fault time, type and location. Your description, phone number and attachments are not stored in that history. When email verification is enabled, the server temporarily keeps protected technical digests for verification and rate limiting. No report is sent to AUSEMIO.',
    consentCheckbox: 'I understand the data is processed only for this local test.',
    consentPrivacyLink: 'Privacy policy',
    consentDataNoticeBefore:
      'The test form is sent only to the local test endpoint and is not sent to ',
    consentDataNoticeLinkLabel: 'AUSEMIO',
    consentDataNoticeAfter: '; local history retains only the fault time, type and location, not your description, phone number or attachments. When email verification is enabled, technical digests are kept temporarily.',
    back: 'Back',
    backToMap: 'Back to map',
    next: 'Next',
    nextLoading: 'Loading location…',
    submit: 'Send to local test endpoint',
    submitting: 'Submitting…',
    submitFailed: 'Submission failed',
    submissionRetryPending: 'The previous attempt has no confirmed result. Your report stays locked; retry this same report to resolve it.',
    submissionRetryUnavailable: 'This report cannot be retried safely because its saved attempt expired or could not be restored. Check whether the previous report was accepted before creating a new one.',
    retrySubmission: 'Retry this report',
    locationValidationFailed: 'The selected location cannot be used. Return to the map and choose a location inside the service area.',
    locationValidationUnavailable: 'The selected location could not be verified. The report was not submitted; try again or choose another location.',
    inventoryPrefix: 'Inventory number',
    deviceTargetBanner: 'You explicitly selected your device location as the report target.',
    manualTargetBanner: 'Enter the report location manually in the form.',
    languageFieldLabel: 'Form submission language: English (en)',
    errorSummary: 'Check the highlighted fields and correct the errors.',
    localityPlaceholder: 'Start typing a locality…',
    localityNoMatches: 'No matches. Select a canonical locality from the suggestions.',
    addressCoordinates: 'Selected coordinates',
    automaticAddressOnSubmit: 'An approximate address will be added automatically from the selected coordinates when you submit.',
    automaticAddressQualifier: '* The automatically determined address may be inaccurate.',
    inventoryAddressLoading: 'Loading the recorded light point address…',
    inventoryAddressResolved: 'The locality was resolved from the recorded light point address.',
    inventoryAddressManualHint: 'The recorded address could not be matched unambiguously to the locality list. Choose a locality from the list.',
    inventoryAddressLookupFailed: 'The recorded light point address could not be resolved automatically. Choose a locality from the list.',
    editInventoryLocality: 'Change locality',
    copyCoordinates: 'Copy coordinates',
    copyCoordinatesShort: 'Copy',
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
    recenterShortLabel: 'My location',
    recenterBlocked: 'Centering the map on the device location is currently unavailable.',
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
    pointsFailure: 'Recorded light points are temporarily unavailable. You can still mark a location directly on the map.',
    tilesFailure: 'Map tiles are unavailable. You can still continue to the form.',
    tilesNotConfigured: 'Map tiles are not enabled for this deployment. You can continue without a map point.',
    liveTilesLoading: 'Live CARTO tiles are loading…',
    liveTilesUnavailable: 'Live CARTO tiles did not load. Check the local key and its restrictions.',
    liveTilesMisconfigured: 'LIVE_PROVIDER_UAT expects live CARTO tiles, but the map is not configured for them.',
    zoomIn: 'Zoom in on map',
    zoomOut: 'Zoom out on map',
    fallbackPointsTitle: 'Choose a recorded street light',
    fallbackPointsHint: 'The map is unavailable. Search for a recorded point or continue manually.',
    fallbackPointsSearch: 'Search by address or inventory number',
    fallbackPointsCount: (count) => `Matching points: ${count}`,
    mapFailure: 'The map could not be displayed. You can continue without a map point.',
    mapUnavailableTitle: 'The map is currently unavailable',
    mapUnavailableDescription: 'Continue to the form and enter the fault location manually.',
    openManualReport: 'Open the form and enter the location manually',
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
    checkingTarget: 'Checking whether the selected location is inside Košice…',
    targetOutsideServiceArea: 'This location is outside Košice. Choose a location within the city.',
    targetValidationUnavailable: 'The location could not be checked. Please try selecting it again.',
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
    successMessage: 'The local test saved only the fault time, type and location metadata; no report was sent to AUSEMIO.',
    attachmentCleanupRetryNotice: 'The report is saved in local history only, but this browser could not remove its attachments. The app will retry when it is opened again.',
    attachmentCleanupManualNotice: 'The browser could not confirm attachment removal or save a retry request. Files or the local draft may remain in this browser; clear this site’s local browser data to remove them.',
    addressEnrichmentWarning: 'The automatic address service is temporarily unavailable. The address could not be added, but local history recorded the time, type and selected coordinates; nothing was sent to AUSEMIO.',
    addressNotFoundWarning: 'An automatic address could not be determined. Local history recorded the time, type and selected coordinates; nothing was sent to AUSEMIO.',
    endpointResult: 'Local endpoint result: ',
    statusLocalTestReceived: 'saved in local metadata history only',
    explanation: 'The local test keeps only the time, fault and location metadata needed for local review. The description, contact details and files are not retained. Nothing was sent to AUSEMIO/DPMK, and this does not establish acceptance by an external system.',
    failureExplanation: 'No alternate submission transport was attempted.',
    backToMap: 'Back to map',
    newTest: 'New local test',
  },
};

const MESSAGES: Record<ReportFormLocale, ReportFormMessages> = { sk, en };

export function getReportFormMessages(locale: ReportFormLocale): ReportFormMessages {
  const messages = MESSAGES[locale];
  if (import.meta.env.VITE_REPORT_SUBMISSION_MODE !== 'local-persistence') return messages;

  if (locale === 'sk') {
    return {
      ...messages,
      form: {
        ...messages.form,
        testModeHint: 'Produkčný webový režim — hlásenie sa uloží iba do lokálnej databázy; neposiela sa do AUSEMIO ani oficiálne mestu.',
        consentCheckbox: 'Rozumiem, že hlásenie sa uloží lokálne a nepovažuje sa za oficiálne prijaté mestom.',
        consentDataNoticeBefore: 'Hlásenie sa odošle do lokálnej databázy prevádzkovateľa; neodošle sa do systému ',
        consentDataNoticeAfter: '; toto nie je oficiálne prijatie mestom. Trvalá história obsahuje iba čas, typ a miesto poruchy, nie váš popis, telefón ani prílohy.',
        submit: 'Uložiť hlásenie lokálne',
        submitFailed: 'Hlásenie sa nepodarilo uložiť lokálne',
      },
      result: {
        ...messages.result,
        fallbackTitle: 'Lokálne uloženie hlásenia',
        fallbackHint: 'Vyberte miesto na mape a pokračujte vo formulári. Hlásenie sa uloží iba do lokálnej databázy.',
        successTitle: 'Hlásenie uložené lokálne — nie je oficiálne prijaté',
        failureGeneric: 'Hlásenie sa nepodarilo uložiť',
        localTestBadge: 'LOKÁLNE ULOŽENÉ',
        successMessage: 'Do PostgreSQL sa uložil čas, typ a miesto poruchy. Popis, kontaktné údaje a prílohy sa do trvalej histórie neukladajú.',
        statusLocalTestReceived: 'uložené na serveri v lokálnej databáze',
        explanation: 'Záznam je uložený iba v lokálnej databáze na serveri. Nebol odoslaný do AUSEMIO a mesto nepotvrdilo jeho prijatie.',
        newTest: 'Nové hlásenie',
      },
    };
  }

  return {
    ...messages,
    form: {
      ...messages.form,
      testModeHint: 'Production-like website mode — the report is stored only in the local database; it is not sent to AUSEMIO or officially submitted to the city.',
      consentCheckbox: 'I understand that this report is stored locally and is not officially accepted by the city.',
      consentDataNoticeBefore: 'The report is sent to the operator’s local database and is not sent to ',
      consentDataNoticeAfter: '; this is not an official city receipt. Persistent history stores only the fault time, type and location, not your description, phone number or attachments.',
      submit: 'Save report locally',
      submitFailed: 'Report could not be saved locally',
    },
    result: {
      ...messages.result,
      fallbackTitle: 'Local report storage',
      fallbackHint: 'Choose a location on the map and continue. The report is stored only in the local database.',
      successTitle: 'Report stored locally — not officially accepted',
      failureGeneric: 'Report could not be stored',
      localTestBadge: 'STORED LOCALLY',
      successMessage: 'The fault time, type and location were saved to PostgreSQL. The description, contact details and attachments are not stored in permanent history.',
      statusLocalTestReceived: 'stored on the server in its local database',
      explanation: 'This record is stored only in the server’s local database. It was not sent to AUSEMIO, and the city has not acknowledged it.',
      newTest: 'New report',
    },
  };
}
