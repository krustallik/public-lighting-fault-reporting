# AUSEMIO Public Form Contract Audit

**Status:** P2b exhaustive public-client matrix recorded; ready for independent audit. Server contract remains partly unknown.
**Evidence date:** 2026-10-03
**Inspected URL:** `https://kosice.ausem.io/#/public/issues/new`
**Purpose:** characterize public frontend contract evidence before any adapter work. No adapter is implemented by this audit.

## Owner product scope

The local product supports **only AUSEMIO service `2` — VO / Verejné osvetlenie**. Service `16` — CSS / Cestná svetelná signalizácia — is **CONFIRMED PUBLIC CLIENT / OUT OF PRODUCT SCOPE**. Its public form fields and branches remain documented below as external-form evidence, but CSS is not a local missing feature, mismatch, or defect; it is not implemented or included in P4 production mapping or required P4 contract tests. The only planned P4 CSS-related check is negative: ensure the local product does not generate a service-`16`/CSS payload.

## Safety boundary and method

- Each P2b capture used a new anonymous Playwright context with no imported storage state, credentials, owner cookies, or entered personal data. Playwright `1.62.1` ran Edge/Chromium `154.0.4258.53` on 2026-10-03.
- Context-level routing was installed before navigation and page scripts. Only `GET`/`HEAD` to `kosice.ausem.io` could reach the network. Other origins and methods were aborted by the route before transmission. Service workers were blocked; an init script also blocked form `submit/requestSubmit`, unsafe `fetch`/XHR, beacon, WebSocket, and EventSource paths.
- Full settings/assets capture at **2026-10-03 17:14:34.914 UTC / 19:14:34 Europe/Bratislava**: **111 GET, 0 HEAD; HTTP 200 and 302 responses observed; 0 unsafe method attempts; 0 non-GET/HEAD transmissions**. One third-party `GET` for `www.gstatic.com/charts/loader.js` was blocked before network because only the AUSEMIO origin was allowlisted.
- Fresh branch captures at **17:34:23.009 UTC / 19:34:23** (VO `2`, including `Q99`) and **17:34:25.495 UTC / 19:34:25** (CSS `16`, selecting `Q10`, `Q20`, and `Q30`) each observed **104 GET, 0 HEAD; HTTP 200 and 302 responses observed; 0 unsafe attempts and 0 unsafe transmissions**. One third-party GET was blocked in each fresh context.
- Source-map GET/hash capture at **17:19:46.275 UTC / 19:19:46** observed **110 GET, 0 HEAD; HTTP 200 and 302 responses observed; 0 unsafe method attempts or transmissions**; the same unrelated third-party GET was blocked before network.
- The form was never submitted and the final submit control was never activated. Branch inspection changed only public selection controls using enumerated service/fault codes. No issue was created; no real or synthetic reporter details/files were entered; no CAPTCHA, anti-bot control, or server-side validation was bypassed.
- No HAR, cookies, tokens, session IDs, response headers, raw settings bodies, raw source-map bodies, or standalone request ledger were retained. The normalized public field catalog preserves the 10 field assignments and option/condition data; unrelated settings and notice text are excluded. The historical capture is only partially reproducible from the saved summary, catalog, and hashes; do not reconstruct missing evidence retroactively.

## Evidence labels

- **CONFIRMED — repo behavior:** directly visible in this application's source.
- **CONFIRMED — public read-only evidence:** observed in the anonymous public DOM, GET response metadata, or publicly served JavaScript/source map.
- **INFERRED:** follows from public client construction but the exact resulting network contract was not observed by issuing a write.
- **UNKNOWN:** cannot be established from inspected public code/GET evidence.
- **OWNER APPROVAL REQUIRED:** an answer would require a production write. Stop at that boundary; do not attempt it. A safe official test endpoint could provide a separate non-production research path.

## Evidence artifact index

| ID | Artifact / source | Observed use and limitation |
|---|---|---|
| E1 | Public route `https://kosice.ausem.io/#/public/issues/new` | Anonymous page load returned successfully and showed the initial service-selection screen. No user input or submit. |
| E2 | GET `https://kosice.ausem.io/implementation/all_settings` | Public JSON settings response used to inspect configuration version, service options, field assignments, conditions, and attachment settings. It is mutable public data, not a server acceptance guarantee. |
| E3 | GET source map `https://kosice.ausem.io/vite/assets/PublicIssuesNew-D4z9SGrg.js.map` | Maps to `../../../app/javascript/_functions/pages/public_issues/PublicIssuesNew.vue`; used for payload/action construction and response handling. |
| E4 | GET source map `https://kosice.ausem.io/vite/assets/RulesMixin-BVL4IKk_.js.map` | Maps to `../../../app/javascript/_generic/mixins/RulesMixin.js`; used for visible client-side field/email required validation rules. |
| E5 | GET source map `https://kosice.ausem.io/vite/assets/InputFile-nPU3sKmB.js.map` | Maps to `../../../app/javascript/_generic/pages/components/inputs/InputFile.vue`; used for multiple-file UI and client-side file-size check. |
| E6 | GET source map `https://kosice.ausem.io/vite/assets/ActionsMixin-DoWsI6DN.js.map` | Maps to `../../../app/javascript/_generic/mixins/ActionsMixin.js`; used for client success/rejection flow. |
| E7 | GET source map `https://kosice.ausem.io/vite/assets/jsonToFormData-dkDHiHqn.js.map` and public `application-eyamT7CZ.js.map` | Used to inspect JSON-to-FormData utility and public Axios/Vue setup. No body was produced or sent by this audit. |
| E8 | Browser request interception ledger (historical, in-memory only) | Its sanitized summary is recorded above, but the raw/standalone ledger was not retained. This limits independent replay of the historical capture. Future captures must retain a sanitized verification script and request ledger. |
| E9 | Local source paths in the comparison section below | Establishes only current repository behavior, not the live external server contract. |
| E10 | Anonymous GET `https://kosice.ausem.io/implementation/all_settings`, refreshed 2026-10-03 | HTTP 200; response was inspected in memory and only the CSS field assignments/options/conditions were retained below. No content hash or full settings dump was saved. Confirms public client configuration only, not server acceptance. |
| E11 | Fresh anonymous GET `https://kosice.ausem.io/implementation/all_settings` at 2026-10-03 17:14:34 UTC | HTTP 200, 74,678 bytes, SHA-256 `c4bbd5c5a42192c29a163bb1634112428dc85aa9f72a0239d45e94692a412b7d`; config version `2024.11.4`. Normalized capture excludes unrelated settings. |
| E12 | `ausemio-public-field-catalog-2026-10-03.json` | Sanitized projection of the 10 public field assignments, all options/conditions, and the complete 928-choice location catalog. Its embedded GET capture timestamp is 2026-10-03 17:11:36.434 UTC; 121,568 bytes; SHA-256 `786bad2f37b0e7cd67e1b73bf03ee04ab9ab4a6d49d518952a3fac5c7a06a5cb`. E11 is a separate later settings GET/hash capture. |
| E13 | Public bundle and source-map GETs | Relevant module IDs, lengths, SHA-256 hashes, and mapped source paths are listed below. No source-map bodies were persisted. |
| E14 | Fresh anonymous UI branch states at 17:34 UTC | VO service `2` shows the VO field group; VO fault `Q99` reveals `iny_druh_poruchy`; public CSS `Q10` and `Q20` show their corresponding child fields; CSS `Q30` shows neither. All are public-client rendering observations; service `16` is out of local product scope. |

E1–E10 contain historical P2 evidence, including captures whose raw settings/source-map bodies and request ledger were not retained. E11–E14 add timestamps, sanitized hashes, normalized field data, and branch summaries, but do not make the full historical capture independently replayable. This is a documented P2 limitation; missing raw evidence is not reconstructed retroactively. Future captures must retain a sanitized verification script and request ledger. Public assets/settings are mutable and must be rechecked before a later adapter decision.

## Confirmed public read-only evidence

### Page/DOM and form flow

- **CONFIRMED — public read-only evidence (E1):** document title was `AUSEMIO | Košice`; initial screen displayed “Výber služby”, radio choices for `VO – Verejné osvetlenie` and `CSS – Cestná svetelná signalizácia`, and a “ĎALEJ” control. The audit did not activate it.
- **CONFIRMED — public read-only evidence (E1/E5):** inspected form component DOM contains a multiple-file input with an empty/unspecified `accept` attribute, text input controls, an email input, and a GDPR consent checkbox/link. Native `required` attributes were not set on the sampled controls; requiredness is driven by public settings/client rules. Whether the consent checkbox is mandatory for acceptance was not established by interaction.

### Public settings and configured field assignments

`all_settings` response E11 reported configuration version `2024.11.4`, `public_form.enabled=true`, template assignment ID `100`, step 1 and 2 enabled, step 3 disabled, and 10 ordered field assignments. Each row below is **CONFIRMED — public read-only evidence** from the normalized settings response and public UI state. “Next state” describes client visibility only; it does not assert server validation or acceptance.

### P2b exhaustive public-client variant/state matrix

| Order | Service / previous state | Visible field and exact key | Input type / selection mode | Allowed code/value → visible label | Default | Client requiredness | Condition → next visible state | Evidence/status |
|---:|---|---|---|---|---|---|---|---|
| 0 | Initial service chooser | `vyber_sluzby` | Radio, single | `2` → VO – Verejné osvetlenie; `16` → CSS – Cestná svetelná signalizácia | `null` | Required in settings; no radio selected on initial DOM | No condition; `2` reveals VO fields, `16` reveals public CSS fields | E11/E14; **CONFIRMED PUBLIC CLIENT**; `16` is **OUT OF PRODUCT SCOPE** |
| 1 | Service `2` or `16` | `ulica_miesto_poruchy_lokalita` | Select, single | 928 locality labels; every option is conditioned for service codes `2` and `16`; full option/condition catalog is E12 | `null` | Required in settings | `vyber_sluzby` is `2` or `16`; visible for both service branches | E11/E12/E14; **CONFIRMED PUBLIC CLIENT** |
| 2 | Service `2` or `16` | `detail_decription` (literal spelling) | Text, free text | No enumerated values | `null` | Optional in settings | `vyber_sluzby` is `2` or `16`; visible for both service branches | E11/E12/E14; **CONFIRMED PUBLIC CLIENT**; no field length limit found |
| 3 | Service `2` (VO) | `lokalizacia_blok` | Radio, single | `Q10` → Pred blokom; `Q11` → Vedľa bloku; `Q12` → Za blokom | `null` | Optional in settings | `vyber_sluzby=2` | E11/E12/E14; **CONFIRMED PUBLIC CLIENT** |
| 4 | Service `2` (VO) | `typ_poruchy` | Radio, single | `Q` → Svietidlo vôbec nesvieti; `Q1` → Svietidlo sa rozsvieti a po určitom čase / niekoľkých minútach zhasne; `Q2` → Nesvieti celá skupina svietidiel; `Q3` → Poškodený stožiar; `Q4` → Odkryté elektrické zariadenie / kabeláž; `Q6` → Poškodená pätica / pätka / betónový základ; `Q10` → Krivý alebo nahnutý stožiar / výložník / svietidlo; `Q61` → Potrebný orez drevín - zarastený stožiar / rozvádzač; `Q99` → Iný druh poruchy | `null` | Optional in settings | `vyber_sluzby=2`; choosing `Q99` reveals row 8 | E11/E12/E14; **CONFIRMED PUBLIC CLIENT** |
| 5 | Service `16` (CSS) | `typ_poruchy_css` | Select, single | `Q10` → Porucha na prechode pre chodcov; `Q20` → Porucha na cestnej svetelnej signalizácií; `Q30` → Dopravná nehoda - poškodenie | `null` | Optional in settings | `vyber_sluzby=16`; `Q10` reveals row 6, `Q20` reveals row 7, `Q30` has no configured child field | E11/E12/E14; **CONFIRMED PUBLIC CLIENT / OUT OF PRODUCT SCOPE** |
| 6 | CSS fault `Q10` | `porucha_na_prechode_pre_chodcov` | Select, multiselect | `Q1` → Nesvieti zelené svetlo; `Q2` → Nesvieti červené svetlo; `Q4` → Poškodené zariadenie | `null` | Optional in settings | `typ_poruchy_css=Q10` | E11/E12/E14; **CONFIRMED PUBLIC CLIENT / OUT OF PRODUCT SCOPE** |
| 7 | CSS fault `Q20` | `porucha_na_cestnej_svetelnej_signalizacii` | Select, multiselect | `Q1` → Nesvieti zelené svetlo; `Q2` → Nesvieti oranžové svetlo; `Q3` → Nesvieti červené svetlo; `Q4` → Poškodené zariadenie | `null` | Optional in settings | `typ_poruchy_css=Q20` | E11/E12/E14; **CONFIRMED PUBLIC CLIENT / OUT OF PRODUCT SCOPE** |
| 8 | VO fault `Q99` | `iny_druh_poruchy` | String, free text | No enumerated values | `null` | Optional in settings | `typ_poruchy=Q99` | E11/E12/E14; **CONFIRMED PUBLIC CLIENT** |
| 9 | Service `2` or `16` | `tel_cislo` | String; telephone contact | No enumerated values | `null` | Required in settings | `vyber_sluzby=2` or `16` | E11/E12/E14; **CONFIRMED PUBLIC CLIENT** |

The initial public chooser and each selected service branch were observed in isolated UI state. Fresh service `2` with VO fault `Q99` showed the `Iný druh poruchy` input. A separate fresh service `16` state showed no VO “other fault” input; selecting CSS `Q10` showed the pedestrian-crossing field, `Q20` showed the traffic-signal field, and `Q30` showed no conditional child. A same-session transition from VO `Q99` to CSS retained the prior visible “other fault” control until a fresh page state; treat this only as **INFERRED — possible client state carry-over**, not a server rule or a confirmed defect.

The public form also contains an email input and GDPR consent control in the rendered DOM, but neither appears among these 10 configured assignments. The public `RulesMixin` has a required email rule (`field_email`) and an email pattern check. Its outgoing field key and service/step serialization were not established. Consent key, client requiredness, and serialization are **UNKNOWN**. Initial DOM controls do not have native HTML `required` attributes; observed requiredness comes from client settings/rules. Every normalized field assignment has a null default. No explicit min/max/length or pattern constraint was found for the configured description/other-fault text; the inspected client rule bundle establishes required/email validation, not further server rules.

No explicit latitude/longitude field is present in the 10 assignments or observed service screens. The observed location input is the static 928-choice locality select; the description field is free text. This is limited to the inspected public form client and does not establish any hidden server field or endpoint behavior. No explicit default field value was found in the normalized assignments; initial service selection is blank.

The public settings also included `doc_max_size=30` and a file-compression dimension setting of `1920` (E11). Public setting contents unrelated to the contract, such as mail configuration or notice body text, are intentionally omitted. The complete set of 928 location choices and assignment conditions is in [E12](ausemio-public-field-catalog-2026-10-03.json).

### Public attachment hints versus server-side unknowns

| Evidence layer | Observed attachment behavior | What it does not establish |
|---|---|---|
| Public client (E1/E5/E11/E13) | Multiple-file input; blank/unspecified `accept`; client checks each file against `doc_max_size=30` using `file.size / 1024 / 1024` (30 MiB); no client-side count limit was found in the inspected component. The public setting also has a compression-dimension value of 1920. | Does not prove server MIME/type, file-count, file-size, compression, or persistence acceptance. |
| Local app (E9) | Frontend input advertises `image/*`; frontend schema caps selected files at 5 (`frontend/src/config/ausemioForm.ts::MAX_REPORT_FILES`, `frontend/src/schemas/reportSchema.ts::createReportFilesSchema`). Backend Multer accepts at most 5 files and 10 MiB per file (`backend/src/middleware/reportUpload.ts`); no report-upload MIME filter is configured there. No frontend per-file size validation was found in the inspected flow. | Describes only local UI/schema/middleware behavior, not external server policy. |
| External server | Not inspected with a write or server-side documentation. | Server-side MIME/type/count/size rules and whether files are retained or transformed remain **UNKNOWN**. A real production write is prohibited; if only such a write can confirm acceptance, mark **OWNER APPROVAL REQUIRED** and stop. |

### Client-side field, file, request, and response logic

- **CONFIRMED — public read-only evidence (E3):** `PublicIssuesNew.vue::save()` constructs an object from the form's `edit_object` plus `files: safeFiles`, converts it through `jsonToFormData(..., { showLeafArrayIndexes: false })`, appends `locale`, and configures an Axios action with `method: "post"`, relative `url: "public_issues"`, and `Content-Type: multipart/form-data`. This is source-code construction only; the audit did not execute `save()`.
- **CONFIRMED — public read-only evidence (E3/E7):** keys in `edit_object` derive from field assignment keys listed above; the file property is named `files`; `locale` is appended separately. Exact encoded representation for every field/array was not observed on the wire because no request body was generated or submitted.
- **INFERRED:** resolving relative `public_issues` likely uses the app's Axios base URL/current origin configuration. The exact absolute destination URL was not determined from the inspected module/source map; actual resolved endpoint/network request remains **UNKNOWN**.
- **CONFIRMED — public read-only evidence (E4):** `RulesMixin` exposes a required rule that accepts a nonempty value, nonempty arrays, or string `"0"`; `field_email` rejects empty values and applies an email regex. Required field assignments/settings include service, location, and telephone. This documents client validation metadata/rules, not server validation.
- **CONFIRMED — public read-only evidence (E5):** `InputFile.vue` permits multiple files and compares `file.size / 1024 / 1024` to `doc_max_size`; with observed setting 30, the client-side per-file threshold is 30 MiB using the component's binary divisor. No maximum file count was found in the inspected component. The live server's count, MIME/type, and size acceptance is **UNKNOWN**. DOM `accept` was empty; this does not prove the server accepts every file type.
- **CONFIRMED — public read-only evidence (E3/E6):** `ActionsMixin.runAction` resolves success on an Axios success response, and routes rejected responses to configured custom error or the generic error-message handler. The submit action config includes a success message. Axios defaults inspected use a 2xx `validateStatus`; the exact application-level response schema, server status codes, and message formats are **UNKNOWN** because no write response was observed.
- **CONFIRMED — public read-only evidence (E7):** inspected Vue setup assigns Axios to the application HTTP client. No form-specific CSRF header was found in the inspected save action. Axios package defaults identify `XSRF-TOKEN` / `X-XSRF-TOKEN` names; whether cookies or an XSRF header are present/applied to a real request is **UNKNOWN**. No CSRF token/cookie was captured or reused.

### Captured public bundles and source-map hashes (E13)

Hashes were calculated in memory from public GET responses; raw bundles/maps and response headers were not saved. These identify the inspected 2026-10-03 client snapshot and are reproducibility evidence, not a guarantee that the public site has not changed.

| Public asset | Bytes | SHA-256 | Mapped source identifier(s) |
|---|---:|---|---|
| `/vite/assets/PublicIssuesNew-D4z9SGrg.js` | 10,593 | `2b01d31bceae39ac520425666ce04aa58e579a385277d5999c0f55e70e2d2b6b` | `../../../app/javascript/_functions/pages/public_issues/PublicIssuesNew.vue` |
| `/vite/assets/RulesMixin-BVL4IKk_.js` | 3,090 | `ce1e8455073200232255cb7beebf2b624741fe3e72a56b16ae2af68a46b22006` | `../../../app/javascript/_generic/mixins/RulesMixin.js` |
| `/vite/assets/InputFile-nPU3sKmB.js` | 5,903 | `ff5ecbadc95d627893d7b6d7dba2d1e069ab72e01ddd3931b2d9acb9210f4ca7` | `../../../app/javascript/_generic/pages/components/inputs/InputFile.vue` |
| `/vite/assets/ActionsMixin-DoWsI6DN.js` | 1,261 | `e36db3000de13df99cfd3f0b1096d050f6cab265a7db7ac816b0dfa3cd6648ac` | `../../../app/javascript/_generic/mixins/ActionsMixin.js` |
| `/vite/assets/jsonToFormData-dkDHiHqn.js` | 1,583 | `41447a77db0ef19f5df4c7db3355016109dcbea9b8a7f818c956ede0dcb871f7` | `../../../node_modules/json-form-data/src/jsonToFormData.js` |
| `/vite/assets/application-eyamT7CZ.js` | 1,707,688 | `044e50674dae1bf1e7d225af6d86a9c9c4ed8a0e2e846a17875d94ef404ecb38` | App bundle; source map includes the English and Slovak translation modules |
| `/vite/assets/PublicIssuesNew-D4z9SGrg.js.map` | 16,640 | `12a0fba2346e1b000cc7e919e61fdc77671b6cf269539c573ed8563b268f7ab3` | Public issue form Vue module |
| `/vite/assets/RulesMixin-BVL4IKk_.js.map` | 9,109 | `51d2fab920117bf7eb34e82ec5ef6469acd74a1b938625f5e6786f03c16d8ac0` | `RulesMixin.js` |
| `/vite/assets/InputFile-nPU3sKmB.js.map` | 16,101 | `1d771d0ac3f572fdbbb57ce8d4233eb5f9623fef88ee452c0365b6833abcbfa5` | `InputFile.vue` |
| `/vite/assets/ActionsMixin-DoWsI6DN.js.map` | 4,613 | `7a55410122a9b56ff1fe23f40daee591adcb2bfc885960efcd1d41fcc57c6f18` | `ActionsMixin.js` |
| `/vite/assets/jsonToFormData-dkDHiHqn.js.map` | 6,449 | `6fc063883f64a6ad3efa77042262d11c1bc6d51a8c4407829a66d09d69b722e4` | `jsonToFormData.js` |
| `/vite/assets/application-eyamT7CZ.js.map` | 6,132,290 | `e4b38cbb6226ececc4727ae8c69cc302322116c4b5a1b58635577d39429958f9` | Includes `translations/sk.js` and `translations/en.js` |

The rendered interface exposes an `EN / SK` language switch; the public action appends a `locale` value. The inspected source map contains the `sk.js`/`en.js` translation modules. The exact on-wire locale values and server-accepted set remain **UNKNOWN** until a safe server contract is available.

## Local repository behavior and observed drift

These points are **CONFIRMED — repo behavior (E9)** only:

- `frontend/src/config/ausemioForm.ts` and `backend/src/config/ausemioMapping.ts` encode VO service code `2`; backend validation in `backend/src/services/reports.service.ts::validateAusemioFields` rejects any other service. This matches the accepted service-`2`-only product scope; it is not a defect for external CSS service `16` to be rejected.
- Local `frontend/src/config/ausemioForm.ts` and `backend/src/config/ausemioFormOptions.ts` use location-block codes `Q8`, `Q9`, `Q10`; public settings (E2) show `Q10`, `Q11`, `Q12` for the VO block field.
- The local fault options in `frontend/src/config/ausemioForm.ts` / `backend/src/config/ausemioFormOptions.ts` use local Q-code sets and labels that differ from public `typ_poruchy` codes `Q`, `Q1`, `Q2`, `Q3`, `Q4`, `Q6`, `Q10`, `Q61`, `Q99` (E2). No mapping decision is made here.
- `frontend/src/schemas/reportSchema.ts` makes phone optional; `backend/src/services/reports.service.ts::validateAusemioFields` validates and normalizes phone only when supplied. Public settings mark `tel_cislo` required (E2). Local email is required in both frontend schema and backend validator.
- Local UI limit is five files (`frontend/src/config/ausemioForm.ts`, `frontend/src/schemas/reportSchema.ts`); backend upload accepts at most 5 files of at most 10 MiB each (`backend/src/middleware/reportUpload.ts`). Public inspected client settings/component indicate 30 MiB per file and no client-side count cap found (E2/E5). This is a contract difference to resolve through later owner-approved work; no change is performed.
- Local multipart construction is in `frontend/src/utils/buildReportFormData.ts`; the current API parses it and simulates a response through `backend/src/services/reports.service.ts` and `backend/src/services/aussemio.service.ts`. That local simulated path is not evidence of the live server contract.

## Formal client-to-local mapping

The external side below records public client/settings evidence (E2–E7), not server-accepted values. “Exact client field key” means the public settings key or client object key visible in source; exact serialized multipart spelling is kept UNKNOWN where it was not emitted/observed. Local columns cite the implementation's current literal key/value behavior.

| AUSEMIO UI/client concept | Exact client field key | Public value/code and requiredness | Local frontend mapping | Local backend mapping | Status | Evidence source / limit |
|---|---|---|---|---|---|---|
| Service | `vyber_sluzby` (settings field; wire serialization not observed) | `2` VO; `16` CSS; required | Fixed `properties[vyber_sluzby]=2` | Same key; validator accepts only `2` | **CONFIRMED PUBLIC CLIENT / OUT OF PRODUCT SCOPE** for `16`: local support is intentionally service `2` only; CSS is not a missing feature or defect. | E2/E3; `frontend/src/config/ausemioForm.ts`, `backend/src/config/ausemioMapping.ts`, `backend/src/services/reports.service.ts::validateAusemioFields` |
| Street/place of fault | `ulica_miesto_poruchy_lokalita` (settings field) | 928 configured select options; required when service 2 or 16 | `properties[ulica_miesto_poruchy_lokalita]`; local free-text input | Same key; required non-empty by report service | **MISMATCH** — key/requiredness align, local input is free text rather than the configured public option list | E1/E2/E3; `frontend/src/pages/ReportFormPage/ReportFormPage.tsx`, `backend/src/services/reports.service.ts` |
| Detail description | `detail_decription` (literal spelling in settings) | Text; optional for service 2 or 16; public maximum not established | `properties[detail_decription]`; optional, local max 2000 characters | Same key parsed; map suffix appended before simulation | **UNKNOWN** — key/optional status align; public length/normalization acceptance is not established | E2/E3; `frontend/src/schemas/reportSchema.ts`, `backend/src/services/reports.service.ts` |
| VO location block | `lokalizacia_blok` | `Q10`, `Q11`, `Q12`; optional for service 2 | `properties[lokalizacia_blok]`; local options `Q8`, `Q9`, `Q10`, default `Q10` | Same key; validator accepts `Q8`, `Q9`, `Q10` | **MISMATCH** — only `Q10` overlaps | E2/E3/E9; `frontend/src/config/ausemioForm.ts`, `backend/src/config/ausemioFormOptions.ts` |
| VO fault type | `typ_poruchy` | `Q`, `Q1`, `Q2`, `Q3`, `Q4`, `Q6`, `Q10`, `Q61`, `Q99`; optional for service 2 | `properties[typ_poruchy]`; local codes `Q1`–`Q8` and `Q` | Same key; local validator accepts `Q1`–`Q8` and `Q` | **MISMATCH** — shared codes are `Q`, `Q1`–`Q4`, `Q6`; local-only `Q5/Q7/Q8`, public-only `Q10/Q61/Q99` | E2/E3/E9; `frontend/src/config/ausemioForm.ts`, `backend/src/config/ausemioFormOptions.ts` |
| CSS fault type | `typ_poruchy_css` | `Q10`, `Q20`, `Q30`; optional for service 16 | Local product is fixed to service `2`; it is not a CSS product flow | Backend accepts product service `2` only | **CONFIRMED PUBLIC CLIENT / OUT OF PRODUCT SCOPE** — not a local mismatch, missing feature, or defect | E2/E3/E9; `frontend/src/utils/buildReportFormData.ts`, `backend/src/services/reports.service.ts` |
| Pedestrian crossing fault | `porucha_na_prechode_pre_chodcov` | `Q1`, `Q2`, `Q4`; multiselect; optional when CSS fault type is `Q10` | Local product is fixed to service `2`; CSS child values are not part of product scope | Product scope is service `2` only | **CONFIRMED PUBLIC CLIENT / OUT OF PRODUCT SCOPE** — not a local mismatch, missing feature, or defect | E2/E3/E9; local constants in `frontend/src/config/ausemioForm.ts` and `backend/src/config/ausemioMapping.ts` |
| Traffic signal fault | `porucha_na_cestnej_svetelnej_signalizacii` | `Q1`, `Q2`, `Q3`, `Q4`; public client condition is `typ_poruchy_css=Q20` | Local product is fixed to service `2`; CSS child values are not part of product scope | Product scope is service `2` only | **CONFIRMED PUBLIC CLIENT / OUT OF PRODUCT SCOPE** — not a local mismatch, missing feature, or defect | E3/E9/E10; local constants in `frontend/src/config/ausemioForm.ts` and `backend/src/config/ausemioMapping.ts` |
| Other fault text | `iny_druh_poruchy` | String; optional when VO fault type is `Q99` | `properties[iny_druh_poruchy]`; shown when local fault code is `Q` | Same key parsed; no conditional validator | **MISMATCH** — key aligns, but local conditional code is `Q`, public condition is `Q99` | E2/E3/E9; `frontend/src/pages/ReportFormPage/ReportFormPage.tsx`, `backend/src/utils/parseAusemioMultipartBody.ts` |
| Telephone | `tel_cislo` | String; required for service 2 or 16 | `properties[tel_cislo]`; optional in UI/schema, blank if omitted | Same key; validated/formatted only if present | **MISMATCH** — local phone is optional, public setting says required | E2/E3/E9; `frontend/src/schemas/reportSchema.ts`, `backend/src/services/reports.service.ts::validateAusemioFields` |
| Attachments | Public object property `files`; exact multipart part name is not confirmed | **Public client hint:** multiple input, blank `accept`, 30 MiB/client-checked per file, no client count cap found. **Server-side acceptance:** UNKNOWN for MIME/type/count/size/storage. | **Local frontend:** `image/*` picker hint and max 5 selected files; no frontend per-file size check found. **Local backend:** Multer `.array('files[]')`, max 5 files × 10 MiB/file, with no MIME filter in `reportUpload.ts`. | N/A | **MISMATCH** — only local behavior and public client hints are confirmed; neither establishes external server acceptance or exact wire file-part spelling | E1/E2/E3/E5/E9/E10; `frontend/src/config/ausemioForm.ts`, `frontend/src/schemas/reportSchema.ts`, `frontend/src/pages/ReportFormPage/ReportFormPage.tsx`, `backend/src/middleware/reportUpload.ts` |
| Reporter email | Visible email control; exact outgoing key not verified in the inspected source | Required by public client `field_email` rule | `email`; required by Zod | `email`; required and regex-checked by report service | **UNKNOWN** — client behavior aligns on requiredness; exact external serialized key and server rules were not observed | E1/E3/E4/E9; `frontend/src/schemas/reportSchema.ts`, `backend/src/services/reports.service.ts` |
| Locale | Public action appends `locale`; supported public values were not established | Value comes from client locale; accepted code set **UNKNOWN** | `locale`; local values `sk`, `en` | `locale`; accepts only `sk`, `en` | **UNKNOWN** — request key construction is visible, allowed public values/server behavior are not | E3/E7/E9; `frontend/src/i18n/reportFormLocale.ts`, `backend/src/config/ausemioMapping.ts` |
| GDPR/consent | Checkbox is in DOM; request field key/assignment **UNKNOWN** | Consent presence is visible; requiredness/serialization **UNKNOWN** | `consent` required locally; explicitly excluded from `buildReportFormData` | No consent field in report field parser/validator | **UNKNOWN** — external serialization/enforcement not established | E1/E3/E9; `frontend/src/schemas/reportSchema.ts`, `frontend/src/utils/buildReportFormData.ts` |

### VO code-to-label crosswalk (owner decision required before P4 mapping tests)

This crosswalk is limited to product service `2`. Public labels/codes are from E11/E12; local labels/codes are from `frontend/src/config/ausemioForm.ts` and `backend/src/config/ausemioFormOptions.ts`. It records candidates only and does not approve or implement a mapping. `SAME` means literal code and meaning align; `COLLISION` means a shared literal code has a different meaning; `MISSING LOCAL` means a public literal code is absent locally; `LOCAL-ONLY` means a local literal code is absent publicly; `REQUIRES OWNER DECISION` means a semantically plausible mapping would cross codes and must not be assumed.

| Public field | Public code | Public Slovak label | Local code | Local label | Semantic relation |
|---|---|---|---|---|---|
| `lokalizacia_blok` | `Q10` | Pred blokom | `Q10` | Za blokom | **COLLISION** |
| `lokalizacia_blok` | `Q10` | Pred blokom | `Q8` | Pred blokom | **REQUIRES OWNER DECISION** |
| `lokalizacia_blok` | `Q11` | Vedľa bloku | `Q9` | Vedľa bloku | **REQUIRES OWNER DECISION** |
| `lokalizacia_blok` | `Q12` | Za blokom | `Q10` | Za blokom | **REQUIRES OWNER DECISION** |
| `lokalizacia_blok` | — | — | `Q8` | Pred blokom | **LOCAL-ONLY** literal code; candidate public semantic code is `Q10` |
| `lokalizacia_blok` | — | — | `Q9` | Vedľa bloku | **LOCAL-ONLY** literal code; candidate public semantic code is `Q11` |
| `typ_poruchy` | `Q` | Svietidlo vôbec nesvieti | `Q` | Iný druh poruchy | **COLLISION** |
| `typ_poruchy` | `Q` | Svietidlo vôbec nesvieti | `Q1` | Svietidlo vôbec nesvieti | **REQUIRES OWNER DECISION** |
| `typ_poruchy` | `Q1` | Svietidlo sa rozsvieti a po určitom čase / niekoľkých minútach zhasne | `Q1` | Svietidlo vôbec nesvieti | **COLLISION** |
| `typ_poruchy` | `Q1` | Svietidlo sa rozsvieti a po určitom čase / niekoľkých minútach zhasne | `Q2` | Svietidlo sa rozsvieti a po určitom čase / niekoľkých minútach zhasne | **REQUIRES OWNER DECISION** |
| `typ_poruchy` | `Q2` | Nesvieti celá skupina svietidiel | `Q2` | Svietidlo sa rozsvieti a po určitom čase / niekoľkých minútach zhasne | **COLLISION** |
| `typ_poruchy` | `Q2` | Nesvieti celá skupina svietidiel | `Q3` | Nesvieti celá skupina svietidiel | **REQUIRES OWNER DECISION** |
| `typ_poruchy` | `Q3` | Poškodený stožiar | `Q3` | Nesvieti celá skupina svietidiel | **COLLISION** |
| `typ_poruchy` | `Q3` | Poškodený stožiar | `Q4` | Poškodený stožiar | **REQUIRES OWNER DECISION** |
| `typ_poruchy` | `Q4` | Odkryté elektrické zariadenie / kabeláž | `Q4` | Poškodený stožiar | **COLLISION** |
| `typ_poruchy` | `Q4` | Odkryté elektrické zariadenie / kabeláž | `Q5` | Odkryté elektrické zariadenie / kabeláž | **REQUIRES OWNER DECISION** |
| `typ_poruchy` | `Q6` | Poškodená pätica / pätka / betónový základ | `Q6` | Poškodená pätica / pätka / betónový základ | **SAME** |
| `typ_poruchy` | `Q10` | Krivý alebo nahnutý stožiar / výložník / svietidlo | — | — | **MISSING LOCAL** literal code; candidate semantic code is local `Q7` |
| `typ_poruchy` | `Q10` | Krivý alebo nahnutý stožiar / výložník / svietidlo | `Q7` | Krivý alebo nahnutý stožiar / výložník / svietidlo | **REQUIRES OWNER DECISION** |
| `typ_poruchy` | `Q61` | Potrebný orez drevín - zarastený stožiar / rozvádzač | — | — | **MISSING LOCAL** literal code; candidate semantic code is local `Q8` |
| `typ_poruchy` | `Q61` | Potrebný orez drevín - zarastený stožiar / rozvádzač | `Q8` | Potrebný orez drevín - zarastený stožiar / rozvádzač | **REQUIRES OWNER DECISION** |
| `typ_poruchy` | `Q99` | Iný druh poruchy | — | — | **MISSING LOCAL** literal code; candidate semantic code is local `Q` |
| `typ_poruchy` | `Q99` | Iný druh poruchy | `Q` | Iný druh poruchy | **REQUIRES OWNER DECISION** |
| `typ_poruchy` | — | — | `Q5` | Odkryté elektrické zariadenie / kabeláž | **LOCAL-ONLY** literal code; candidate public semantic code is `Q4` |
| `typ_poruchy` | — | — | `Q7` | Krivý alebo nahnutý stožiar / výložník / svietidlo | **LOCAL-ONLY** literal code; candidate public semantic code is `Q10` |
| `typ_poruchy` | — | — | `Q8` | Potrebný orez drevín - zarastený stožiar / rozvádzač | **LOCAL-ONLY** literal code; candidate public semantic code is `Q61` |

The repeated rows distinguish exact-code collisions from label-aligned candidates; they are not duplicate accepted mappings. Public/local matching labels with different codes still require an owner decision before P4 tests freeze a transformation. CSS remains outside this crosswalk and outside product scope.

### Mock-only adapter test matrix

All rows below are proposed future **VO service-`2` only** adapter tests with synthetic fixtures and a fake transport, gated by explicit approval of the VO crosswalk. They must not send network traffic and do not establish live server acceptance. CSS service `16` is not a P4 implementation target or required contract-test branch.

| Scenario | Synthetic fixture / assertion | Layer and expected limit |
|---|---|---|
| Simulated result remains simulated | Drive the local report flow with synthetic input and a fake transport; assert the repository response stays `status: 'simulated'`. Explicitly assert that a local synthetic reference/result is not described as external AUSEMIO acceptance or issue creation. | Repo characterization only; a mocked or simulated result never proves an external write or acceptance. AUSEMIO production submission remains prohibited. |
| Literal VO public key fixture | Use only service-`2` keys `vyber_sluzby`, `ulica_miesto_poruchy_lokalita`, `detail_decription`, `lokalizacia_blok`, `typ_poruchy`, `iny_druh_poruchy`, and `tel_cislo`; separately test `files` and `locale`. Do not derive expected strings from the mapping under test. Keep email/consent outgoing keys unknown. | Fake transport/local serialization only. Exact public multipart part spelling for fields/files and email/consent is not wire-confirmed. |
| VO base mapping | Service `2`, one of the 928 public locality choices, optional `detail_decription`, and locale; assert only owner-approved mappings against E12 | Unit/adapter contract; no inferred location IDs or unapproved code translation |
| VO required-field characterization | Exercise missing telephone, email, locality, or service `2`; distinguish public-client requiredness from local validation and leave unknown server rules unresolved | Service `2` only; fake/local validation; no CSS branch tests |
| VO location/fault crosswalk | Cover all 928 locality labels, public `lokalizacia_blok` Q10/Q11/Q12 and `typ_poruchy` Q/Q1/Q2/Q3/Q4/Q6/Q10/Q61/Q99 using literal fixtures; freeze transformation assertions only after the crosswalk's owner decision | Test-first gate: the crosswalk above is evidence, not an approved mapping. CSS is excluded. |
| Conditional “other fault” | Service `2`; verify public `typ_poruchy=Q99` reveals optional `iny_druh_poruchy`; test local behavior using the owner-approved crosswalk | Public visibility is **CONFIRMED PUBLIC CLIENT** (E11/E12/E14); the code transformation remains undecided. |
| Service-16 negative guard | Assert the local product always generates service `2` and never emits a service-`16`/CSS payload or CSS option values; do not construct a CSS implementation fixture | Required product-scope guard only; service `16` remains **OUT OF PRODUCT SCOPE**, not a missing feature. Empty legacy placeholders must not be described as CSS support. |
| Local versus public attachment boundaries | Synthetic file sets with counts `0`, `1`, `5`, `6`; sizes `0`, `10 MiB`, `10 MiB + 1 byte`, `30 MiB`, `30 MiB + 1 byte`; synthetic MIME values in and outside `image/*`. Assert local max-5 count, backend 10 MiB/file, and frontend `image/*` picker hint separately from public-client hints: multiple, blank `accept`, 30 MiB/client threshold, no public client count cap found. | Local limits are **CONFIRMED — repo behavior (E9)**; public client hints are **CONFIRMED — public read-only evidence (E5/E11/E13)**; external server-side file acceptance is **UNKNOWN**. Do not probe it by submitting a file. |
| Locale/email/consent | Exercise only mock values. Assert that UI offers EN/SK and the client appends `locale`; retain allowed external locale values, email key, and consent key as unknown until separately evidenced. | Unit/mock only; public server enforcement remains unknown. No real contact data. |
| Success/error response parsing | Synthetic 2xx, validation-style error, server error, malformed body, timeout; ensure no retry unless later explicitly specified | Adapter unit contract; fake response only; actual external response shapes remain unknown |
| Unsafe method/network guard | Inject a fake transport and assert test adapter has no production base URL and submits only to mock; test failures on unintended network access | Unit/integration safety check; no call to production endpoint |

P3 owner-decision gate still applies to import semantics; it does not authorize choosing AUSEMIO report semantics. The VO code-to-label crosswalk requires its own owner approval before mapping tests encode a transformation. No CSS implementation/tests beyond the negative guard, live adapter, or external write are part of this P4 specification.

## Unknowns and approval boundary

| Question | Classification | Evidence limit / next safe evidence |
|---|---|---|
| Exact absolute API URL after resolving relative `public_issues` | INFERRED / UNKNOWN | Client config/source inspected, no request executed; inspect additional public initialization/config sources or an official non-production endpoint. |
| Actual wire encoding for all nested/array properties and headers on submit | UNKNOWN | Source helper identifies construction but no submit/body was produced. A mocked/local adapter fixture can characterize local serialization; external acceptance requires a safe test endpoint. |
| Server-side requiredness, validation, file acceptance, issue creation side effects | UNKNOWN | Public client settings/rules do not prove server behavior. Do not probe by POSTing. |
| Actual success response body/status, error response body/status, issue reference semantics | UNKNOWN — **OWNER APPROVAL REQUIRED** if only production write can confirm | Use a safe official test/staging endpoint if owner confirms it exists. If resolution requires production write, stop until a separate explicit owner authorization; never infer success from the client's configured message. |
| GDPR consent acceptance/enforcement and legal sufficiency | UNKNOWN | Checkbox/link observed but no interaction, server response, or legal-source analysis in this checkpoint. |
| Server-side MIME/count/size constraints and whether file compression occurs before upload | UNKNOWN | Client component only exposes local size check and multiple input; actual server rules are unobserved. |
| CSRF/cookie/header application on a submit | UNKNOWN | No form-specific CSRF header in inspected action; no unsafe request, cookie replay, or token capture. |
| Whether live settings remain current after this evidence date | UNKNOWN beyond 2026-10-03 capture | Settings/assets are public and mutable; re-check read-only before any future contract decision. |

Production write permission is **not granted** by this research. No issue (real or test) may be created and no POST/PUT/PATCH/DELETE may be sent to the production origin without separate explicit owner authorization. No adapter implementation is part of P2.

## Evidence sufficiency for next checkpoint

The product-relevant VO public-client contract is sufficiently evidenced for the candidate crosswalk and proposed mock-only matrix above, subject to owner approval of code semantics. Public CSS evidence remains documented as **OUT OF PRODUCT SCOPE**. The evidence is **not** sufficient to claim server acceptance, exact resolved endpoint, production request headers/body, or success/error response contract. Any work depending on those facts must use an official safe non-production endpoint or remain gated; if only a production write could confirm them, mark **OWNER APPROVAL REQUIRED** and stop.
