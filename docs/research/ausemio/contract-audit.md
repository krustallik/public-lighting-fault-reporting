# AUSEMIO Public Form Contract Audit

**Status:** read-only public-client evidence collected; server contract remains partly unknown
**Evidence date:** 2026-10-03
**Inspected URL:** `https://kosice.ausem.io/#/public/issues/new`
**Purpose:** characterize public frontend contract evidence before any adapter work. No adapter is implemented by this audit.

## Safety boundary and method

- A new anonymous Playwright browser context was used without imported storage state, credentials, cookies, or entered personal data.
- Context-level request interception was registered before navigation/page scripts. Service workers were blocked; observed HTTP request methods were permitted only when `GET` or `HEAD`, and any other method would be aborted before network transmission. WebSocket connections were closed/blocked.
- The page was loaded and inspected without clicking through or submitting the form. No issue was created; no production write was attempted; no CAPTCHA, anti-bot control, or validation was bypassed.
- Main full-page capture: **112 GET, 0 HEAD, 0 non-GET/HEAD network requests, 0 blocked unsafe attempts**. Every observed request method was safe by the installed allowlist. This is a count for that capture; asset/request count can vary between page loads.
- This audit did not save a HAR, cookies, or response bodies as separate repository artifacts. Public URLs and inspected source-map/module names below are the reproducibility references; this Markdown note is the durable evidence summary.

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
| E8 | Browser request interception ledger (in-memory capture summarized above) | Confirms observed methods and absence of escaped unsafe requests for the capture. No standalone capture file was retained. |
| E9 | Local source paths in the comparison section below | Establishes only current repository behavior, not the live external server contract. |
| E10 | Anonymous GET `https://kosice.ausem.io/implementation/all_settings`, refreshed 2026-10-03 | HTTP 200; response was inspected in memory and only the CSS field assignments/options/conditions were retained below. No content hash or full settings dump was saved. Confirms public client configuration only, not server acceptance. |

No content hashes were recorded. Asset names/hashes in URLs identify the inspected public bundle snapshot, but repeat inspection may return different assets/settings.

## Confirmed public read-only evidence

### Page/DOM and form flow

- **CONFIRMED — public read-only evidence (E1):** document title was `AUSEMIO | Košice`; initial screen displayed “Výber služby”, radio choices for `VO – Verejné osvetlenie` and `CSS – Cestná svetelná signalizácia`, and a “ĎALEJ” control. The audit did not activate it.
- **CONFIRMED — public read-only evidence (E1/E5):** inspected form component DOM contains a multiple-file input with an empty/unspecified `accept` attribute, text input controls, an email input, and a GDPR consent checkbox/link. Native `required` attributes were not set on the sampled controls; requiredness is driven by public settings/client rules. Whether the consent checkbox is mandatory for acceptance was not established by interaction.

### Public settings and configured field assignments

`all_settings` response reported configuration version `2024.11.4`, `public_form.enabled=true`, template assignment ID `100`, steps 1 and 2 enabled, step 3 disabled, and 10 field assignments. The following are **CONFIRMED — public read-only evidence (E2)** for that observed settings response:

| Order | Public field key (exact spelling) | Type / options | Requiredness and condition |
|---:|---|---|---|
| 0 | `vyber_sluzby` | Radio; `2` = VO, `16` = CSS | Required |
| 1 | `ulica_miesto_poruchy_lokalita` | Select; 928 configured choices | Required; conditioned on service `2` or `16` |
| 2 | `detail_decription` | Text (key spelling includes `decription`) | Optional; conditioned on service `2` or `16` |
| 3 | `lokalizacia_blok` | Radio; `Q10`, `Q11`, `Q12` | Optional; conditioned on VO service `2` |
| 4 | `typ_poruchy` | Radio; `Q`, `Q1`, `Q2`, `Q3`, `Q4`, `Q6`, `Q10`, `Q61`, `Q99` | Optional; conditioned on VO service `2` |
| 5 | `typ_poruchy_css` | Select; `Q10`, `Q20`, `Q30` | Optional; conditioned on CSS service `16` |
| 6 | `prejazd_pre_chodcov` | Select; `Q1`, `Q2`, `Q4` | Optional; conditioned on CSS fault type `Q10` |
| 7 | `porucha_na_cestnej_svetelnej_signalizacii` (traffic-signal field; earlier summary label: `semafor`) | Multiselect; `Q1`, `Q2`, `Q3`, `Q4` | Optional; shown when `typ_poruchy_css=Q20` |
| 8 | `iny_druh_poruchy` | String | Optional; conditioned on VO fault type `Q99` |
| 9 | `tel_cislo` | String | Required; conditioned on service `2` or `16` |

The public settings also included `doc_max_size=30` and a file-compression dimension setting of `1920` (E2). Public setting contents unrelated to the form contract, such as mail configuration or notice body text, are intentionally omitted.

**Refreshed CSS condition (E10):** the current `all_settings` response still reports CSS fault type `typ_poruchy_css` with `Q10`, `Q20`, `Q30`; the pedestrian-crossing field is conditional on `Q10`. The traffic-signal field's current exact key is `porucha_na_cestnej_svetelnej_signalizacii` (the earlier summary called this concept `semafor`). It is a multiselect with `Q1`–`Q4`, conditioned on `typ_poruchy_css=Q20`. In the settings object's condition map, each traffic-signal option maps to `Q20`. This is **CONFIRMED — public read-only evidence (E10)** about client configuration; whether the server requires, accepts, or applies those values remains **UNKNOWN**.

### Public attachment hints versus server-side unknowns

| Evidence layer | Observed attachment behavior | What it does not establish |
|---|---|---|
| Public client (E1/E2/E5/E10) | Multiple-file input; blank/unspecified `accept`; client checks each file against `doc_max_size=30` using `file.size / 1024 / 1024` (30 MiB); no client-side count limit was found in the inspected component. The public setting also has a compression-dimension value of 1920. | Does not prove server MIME/type, file-count, file-size, compression, or persistence acceptance. |
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

## Local repository behavior and observed drift

These points are **CONFIRMED — repo behavior (E9)** only:

- `frontend/src/config/ausemioForm.ts` and `backend/src/config/ausemioMapping.ts` encode VO service code `2`; backend validation in `backend/src/services/reports.service.ts::validateAusemioFields` rejects any other service.
- Local `frontend/src/config/ausemioForm.ts` and `backend/src/config/ausemioFormOptions.ts` use location-block codes `Q8`, `Q9`, `Q10`; public settings (E2) show `Q10`, `Q11`, `Q12` for the VO block field.
- The local fault options in `frontend/src/config/ausemioForm.ts` / `backend/src/config/ausemioFormOptions.ts` use local Q-code sets and labels that differ from public `typ_poruchy` codes `Q`, `Q1`, `Q2`, `Q3`, `Q4`, `Q6`, `Q10`, `Q61`, `Q99` (E2). No mapping decision is made here.
- `frontend/src/schemas/reportSchema.ts` makes phone optional; `backend/src/services/reports.service.ts::validateAusemioFields` validates and normalizes phone only when supplied. Public settings mark `tel_cislo` required (E2). Local email is required in both frontend schema and backend validator.
- Local UI limit is five files (`frontend/src/config/ausemioForm.ts`, `frontend/src/schemas/reportSchema.ts`); backend upload accepts at most 5 files of at most 10 MiB each (`backend/src/middleware/reportUpload.ts`). Public inspected client settings/component indicate 30 MiB per file and no client-side count cap found (E2/E5). This is a contract difference to resolve through later owner-approved work; no change is performed.
- Local multipart construction is in `frontend/src/utils/buildReportFormData.ts`; the current API parses it and simulates a response through `backend/src/services/reports.service.ts` and `backend/src/services/aussemio.service.ts`. That local simulated path is not evidence of the live server contract.

## Formal client-to-local mapping

The external side below records public client/settings evidence (E2–E7), not server-accepted values. “Exact client field key” means the public settings key or client object key visible in source; exact serialized multipart spelling is kept UNKNOWN where it was not emitted/observed. Local columns cite the implementation's current literal key/value behavior.

| AUSEMIO UI/client concept | Exact client field key | Public value/code and requiredness | Local frontend mapping | Local backend mapping | Status | Evidence source / limit |
|---|---|---|---|---|---|---|
| Service | `vyber_sluzby` (settings field; wire serialization not observed) | `2` VO; `16` CSS; required | Fixed `properties[vyber_sluzby]=2` | Same key; validator accepts only `2` | **MISMATCH** — VO value/key align, CSS service `16` is unsupported locally | E2/E3; `frontend/src/config/ausemioForm.ts`, `backend/src/config/ausemioMapping.ts`, `backend/src/services/reports.service.ts::validateAusemioFields` |
| Street/place of fault | `ulica_miesto_poruchy_lokalita` (settings field) | 928 configured select options; required when service 2 or 16 | `properties[ulica_miesto_poruchy_lokalita]`; local free-text input | Same key; required non-empty by report service | **MISMATCH** — key/requiredness align, local input is free text rather than the configured public option list | E1/E2/E3; `frontend/src/pages/ReportFormPage/ReportFormPage.tsx`, `backend/src/services/reports.service.ts` |
| Detail description | `detail_decription` (literal spelling in settings) | Text; optional for service 2 or 16; public maximum not established | `properties[detail_decription]`; optional, local max 2000 characters | Same key parsed; map suffix appended before simulation | **UNKNOWN** — key/optional status align; public length/normalization acceptance is not established | E2/E3; `frontend/src/schemas/reportSchema.ts`, `backend/src/services/reports.service.ts` |
| VO location block | `lokalizacia_blok` | `Q10`, `Q11`, `Q12`; optional for service 2 | `properties[lokalizacia_blok]`; local options `Q8`, `Q9`, `Q10`, default `Q10` | Same key; validator accepts `Q8`, `Q9`, `Q10` | **MISMATCH** — only `Q10` overlaps | E2/E3/E9; `frontend/src/config/ausemioForm.ts`, `backend/src/config/ausemioFormOptions.ts` |
| VO fault type | `typ_poruchy` | `Q`, `Q1`, `Q2`, `Q3`, `Q4`, `Q6`, `Q10`, `Q61`, `Q99`; optional for service 2 | `properties[typ_poruchy]`; local codes `Q1`–`Q8` and `Q` | Same key; local validator accepts `Q1`–`Q8` and `Q` | **MISMATCH** — shared codes are `Q`, `Q1`–`Q4`, `Q6`; local-only `Q5/Q7/Q8`, public-only `Q10/Q61/Q99` | E2/E3/E9; `frontend/src/config/ausemioForm.ts`, `backend/src/config/ausemioFormOptions.ts` |
| CSS fault type | `typ_poruchy_css` | `Q10`, `Q20`, `Q30`; optional for service 16 | Key exists as `properties[typ_poruchy_css]`, but local body sends empty string and UI has no CSS service flow | Key is parsed but service validator rejects service `16`; no CSS option validation | **MISMATCH** — CSS flow/codes are not implemented locally | E2/E3/E9; `frontend/src/utils/buildReportFormData.ts`, `backend/src/services/reports.service.ts` |
| Pedestrian crossing fault | `prejazd_pre_chodcov` | `Q1`, `Q2`, `Q4`; optional when CSS fault type is `Q10` | Local key is `properties[porucha_na_prechode_pre_chodcov]`; local body sends empty value | Same local key is parsed; no CSS-specific validation | **MISMATCH** — key differs; local always sends blank | E2/E3/E9; local constants in `frontend/src/config/ausemioForm.ts` and `backend/src/config/ausemioMapping.ts` |
| Traffic signal fault | Current public key `porucha_na_cestnej_svetelnej_signalizacii` (earlier summary called it `semafor`) | `Q1`, `Q2`, `Q3`, `Q4`; public client condition is exactly `typ_poruchy_css=Q20` (E10) | Local key is `properties[porucha_na_cestnej_svetelnej_signalizacii]`; local body sends empty value | Same local key is parsed; no CSS-specific validation | **MISMATCH** — key spelling currently aligns, but local flow always sends blank and does not implement CSS-specific validation; external server acceptance is unknown | E3/E9/E10; local constants in `frontend/src/config/ausemioForm.ts` and `backend/src/config/ausemioMapping.ts` |
| Other fault text | `iny_druh_poruchy` | String; optional when VO fault type is `Q99` | `properties[iny_druh_poruchy]`; shown when local fault code is `Q` | Same key parsed; no conditional validator | **MISMATCH** — key aligns, but local conditional code is `Q`, public condition is `Q99` | E2/E3/E9; `frontend/src/pages/ReportFormPage/ReportFormPage.tsx`, `backend/src/utils/parseAusemioMultipartBody.ts` |
| Telephone | `tel_cislo` | String; required for service 2 or 16 | `properties[tel_cislo]`; optional in UI/schema, blank if omitted | Same key; validated/formatted only if present | **MISMATCH** — local phone is optional, public setting says required | E2/E3/E9; `frontend/src/schemas/reportSchema.ts`, `backend/src/services/reports.service.ts::validateAusemioFields` |
| Attachments | Public object property `files`; exact multipart part name is not confirmed | **Public client hint:** multiple input, blank `accept`, 30 MiB/client-checked per file, no client count cap found. **Server-side acceptance:** UNKNOWN for MIME/type/count/size/storage. | **Local frontend:** `image/*` picker hint and max 5 selected files; no frontend per-file size check found. **Local backend:** Multer `.array('files[]')`, max 5 files × 10 MiB/file, with no MIME filter in `reportUpload.ts`. | N/A | **MISMATCH** — only local behavior and public client hints are confirmed; neither establishes external server acceptance or exact wire file-part spelling | E1/E2/E3/E5/E9/E10; `frontend/src/config/ausemioForm.ts`, `frontend/src/schemas/reportSchema.ts`, `frontend/src/pages/ReportFormPage/ReportFormPage.tsx`, `backend/src/middleware/reportUpload.ts` |
| Reporter email | Visible email control; exact outgoing key not verified in the inspected source | Required by public client `field_email` rule | `email`; required by Zod | `email`; required and regex-checked by report service | **UNKNOWN** — client behavior aligns on requiredness; exact external serialized key and server rules were not observed | E1/E3/E4/E9; `frontend/src/schemas/reportSchema.ts`, `backend/src/services/reports.service.ts` |
| Locale | Public action appends `locale`; supported public values were not established | Value comes from client locale; accepted code set **UNKNOWN** | `locale`; local values `sk`, `en` | `locale`; accepts only `sk`, `en` | **UNKNOWN** — request key construction is visible, allowed public values/server behavior are not | E3/E7/E9; `frontend/src/i18n/reportFormLocale.ts`, `backend/src/config/ausemioMapping.ts` |
| GDPR/consent | Checkbox is in DOM; request field key/assignment **UNKNOWN** | Consent presence is visible; requiredness/serialization **UNKNOWN** | `consent` required locally; explicitly excluded from `buildReportFormData` | No consent field in report field parser/validator | **UNKNOWN** — external serialization/enforcement not established | E1/E3/E9; `frontend/src/schemas/reportSchema.ts`, `frontend/src/utils/buildReportFormData.ts` |

### Mock-only adapter test matrix

All rows below are proposed future adapter tests with synthetic fixtures and a fake transport. They must not send network traffic. They characterize an adapter only after implementation is separately authorized; they do not establish live server acceptance.

| Scenario | Synthetic fixture / assertion | Layer and expected limit |
|---|---|---|
| Simulated result remains simulated | Drive the local report flow with synthetic input and a fake transport; assert the repository response stays `status: 'simulated'`. Explicitly assert that a local synthetic reference/result is not described as external AUSEMIO acceptance or issue creation. | Repo characterization only; a mocked or simulated result never proves an external write or acceptance. AUSEMIO production submission remains prohibited. |
| VO base mapping | Service `2`, selected public street value, optional detail, locale; assert exact agreed field keys and unchanged code values against an evidence fixture | Unit/adapter contract; do not replace user-entered street text with assumptions about server IDs |
| Required-field mismatch | Missing telephone, email, street, or service; compare local validation with public-client metadata and require an explicit mapping decision for divergence | Unit/adapter validation; server requiredness remains unknown |
| VO location/fault enumerations | Try public `Q10/Q11/Q12`, VO codes `Q/Q1/Q2/Q3/Q4/Q6/Q10/Q61/Q99`, and local-only `Q8/Q9/Q5/Q7` as synthetic values | Unit mapping table; asserts explicit accepted mapping/unsupported cases, not production validation |
| Conditional “other fault” | Public `typ_poruchy=Q99` with `iny_druh_poruchy`; compare local `Q` branch | Unit conditional mapping; mismatch must remain visible until owner-approved decision |
| CSS and nested conditional fields | Service `16`; `typ_poruchy_css=Q10` makes the public pedestrian-crossing field eligible, and `typ_poruchy_css=Q20` makes the current public traffic-signal field (`porucha_na_cestnej_svetelnej_signalizacii`, earlier summary label `semafor`) eligible; synthetic child codes are crossing `Q1/Q2/Q4` and signal `Q1`–`Q4` | Public condition is **CONFIRMED — public read-only evidence (E10)**; local CSS behavior is unmapped and remains gated. Neither public configuration nor a mock proves server-side acceptance. |
| Local versus public attachment boundaries | Synthetic file sets with counts `0`, `1`, `5`, `6`; sizes `0`, `10 MiB`, `10 MiB + 1 byte`, `30 MiB`, `30 MiB + 1 byte`; synthetic MIME values in and outside `image/*`. Assert local max-5 count, backend 10 MiB/file, and frontend `image/*` picker hint separately from public-client hints: multiple, blank `accept`, 30 MiB/client threshold, no public client count cap found. | Local limits are **CONFIRMED — repo behavior (E9)**; public client hints are **CONFIRMED — public read-only evidence (E5/E10)**; external server-side file acceptance is **UNKNOWN**. Do not probe it by submitting a file. |
| Locale/email/consent | Synthetic locale variants, email, consent presence/absence; assert only fields whose mapping is explicitly decided | Unit/mock only; public server enforcement remains unknown |
| Success/error response parsing | Synthetic 2xx, validation-style error, server error, malformed body, timeout; ensure no retry unless later explicitly specified | Adapter unit contract; fake response only; actual external response shapes remain unknown |
| Unsafe method/network guard | Inject a fake transport and assert test adapter has no production base URL and submits only to mock; test failures on unintended network access | Unit/integration safety check; no call to production endpoint |

P3 owner-decision gate still applies to import semantics; it does not authorize choosing AUSEMIO report semantics. No live adapter or external write is implemented by this test matrix.

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

The public client-side contract is sufficiently evidenced for the formal mapping and proposed mock-only matrix above. It is **not** sufficient to claim server acceptance, exact resolved endpoint, production request headers/body, or success/error response contract. Any work depending on those facts must use an official safe non-production endpoint or remain gated; if only a production write could confirm them, mark **OWNER APPROVAL REQUIRED** and stop.
