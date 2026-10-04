# P4a — VO Form Parity + Local Test Submission Endpoint

**Artifact type:** Canonical implementation plan
**Status:** Planning only; implementation is not authorized by this artifact.
**Product scope:** AUSEMIO service `2` only — VO / Verejné osvetlenie.
**External evidence:** [`contract-audit.md`](../ausemio/contract-audit.md) and [`ausemio-public-field-catalog-2026-10-03.json`](../ausemio/ausemio-public-field-catalog-2026-10-03.json). The P2b note is canonical for capture provenance and limitations; this plan does not duplicate its research.

## 1. Accepted owner decisions and boundaries

- The product supports only service `2` / VO. Service `2` is fixed in the outgoing local form payload and is never shown as a selectable field. The first visible product field is locality.
- For product-relevant VO fields, the confirmed public-client order, Slovak labels, codes, requiredness, and conditions are canonical. Replace obsolete local option codes directly; do not translate them back into historical local values for compatibility.
- Automatically filled values stay visible and editable. A user edit or manual clear takes priority over subsequent automation for the rest of that form session.
- Generated comments, duplicate assistance, and conditional operator notes are deferred. P4a is the core form skeleton only.
- P4a has no live AUSEMIO transport. During development, form submit uses only the local test endpoint below. A local echo does not establish AUSEMIO server acceptance.
- Service `16` / CSS remains confirmed external-form evidence and OUT OF PRODUCT SCOPE. No CSS UI, mapping, or payload is implemented; retain only a negative test that the product never emits CSS fields/codes.

This plan does not change the external server UNKNOWNs recorded in the canonical contract audit.

## 2. Service-2 VO acceptance contract

The order below is the public settings assignment order, excluding the hidden fixed service field. Labels and client metadata come from the approved public catalog and contract audit. “Required” describes confirmed public-client/settings behavior only; it is not a server-acceptance claim.

| Public order | Public field / literal key | Exact Slovak label and public values | Requiredness | Condition / P4a behavior |
|---:|---|---|---|---|
| 0 (hidden) | `vyber_sluzby` → `properties[vyber_sluzby]` | `2` → `VO - Verejné osvetlenie` | Required in public settings | Hardcoded `2`; no visible selector. Not user-editable. |
| 1 | `ulica_miesto_poruchy_lokalita` → `properties[ulica_miesto_poruchy_lokalita]` | `Ulica / Miesto poruchy / Lokalita`; 928 locality choices, where each captured option’s value and label are the locality text | Required | Visible first; active for service `2`; no default. |
| 2 | `detail_decription` → `properties[detail_decription]` | `Bližší popis / orientačný bod / číslo stožiara`; free text | Optional | Visible for service `2`; no captured length constraint or default. Keep the literal public spelling `detail_decription`. |
| 3 | `lokalizacia_blok` → `properties[lokalizacia_blok]` | `Lokalizácia - Blok`: `Q10` → `Pred blokom`; `Q11` → `Vedľa bloku`; `Q12` → `Za blokom` | Optional | Visible for service `2`; public default is null. Use public codes directly. |
| 4 | `typ_poruchy` → `properties[typ_poruchy]` | Captured label token: `$t$Typ Poruchy`. Options: `Q` → `Svietidlo vôbec nesvieti`; `Q1` → `Svietidlo sa rozsvieti a po určitom čase / niekoľkých minútach zhasne`; `Q2` → `Nesvieti celá skupina svietidiel`; `Q3` → `Poškodený stožiar`; `Q4` → `Odkryté elektrické zariadenie / kabeláž`; `Q6` → `Poškodená pätica / pätka / betónový základ`; `Q10` → `Krivý alebo nahnutý stožiar / výložník / svietidlo`; `Q61` → `Potrebný orez drevín - zarastený stožiar / rozvádzač`; `Q99` → `Iný druh poruchy` | Optional | Visible for service `2`; public default is null. Use public codes directly. The captured assignment label is a translation token; do not claim a separately retained resolved heading string. |
| 8 | `iny_druh_poruchy` → `properties[iny_druh_poruchy]` | `Iný druh poruchy`; free text | Optional | Visible only when `typ_poruchy=Q99`. On leaving `Q99`, clear the hidden dependent value under an explicit conditional-form rule; this cleanup is not autofill. |
| 9 | `tel_cislo` → `properties[tel_cislo]` | `Tel. kontakt na Vás`; telephone text input | Required | Visible for service `2`. Public evidence confirms requiredness, not a specific telephone regex or normalization rule. |

The form-field order for the confirmed settings assignments is therefore: locality → description → location block → fault type → conditional other-fault field → telephone. Email, consent, and file controls were observed in the public DOM but are outside the ten ordered settings assignments; their exact relative UI placement is not established as an assignment-order contract.

### Email, consent, and attachments boundary

| Item | Confirmed public-client evidence | P4a rule / unknown boundary |
|---|---|---|
| Email | Public email control exists; client `field_email` rule requires a nonempty value and checks email syntax. | Local endpoint may accept the current local `email` field. The exact outgoing AUSEMIO email key and serialization are UNKNOWN; do not assert them as external contract. |
| Consent | Consent checkbox/link exists in the public DOM. | External requiredness, key, and serialization are UNKNOWN. Consent may remain a local product gate. Do not add it to external-contract assertions or multipart unless evidence later establishes that contract. |
| Attachments | Public client allows multiple files, has blank/unspecified `accept`, checks a 30 MiB per-file threshold, and has no client count cap found. | These are client hints only. External server count, MIME/type, size acceptance, storage, and transformation remain UNKNOWN. Local upload safety limits are specified separately below. |

Do not add CSS keys `typ_poruchy_css`, `porucha_na_prechode_pre_chodcov`, or `porucha_na_cestnej_svetelnej_signalizacii` or CSS codes to the product form payload. Reject those keys in the strict local VO endpoint rather than treating empty legacy placeholders as CSS support.

## 3. Obsolete defaults and strict payload semantics

P4a prohibits silent fallback to `lokalizacia_blok=Q10`, `typ_poruchy=Q`, or any historical optional local choice unless the user selected that value. The only fixed form value is the owner-approved hidden service `2`; UI locale remains the explicit current form locale.

This rule applies across the frontend FormData builder, backend parsing/validation, and all preview/echo paths. The existing `backend/src/utils/parseAusemioMultipartBody.ts` injects defaults for service, location block, fault type, and locale; the new local path must not reuse its optional-field defaults. Its parser may be separately refactored only if tests preserve the old endpoint’s documented boundary; P4a must not hide a missing optional selection by manufacturing `Q10` or `Q`.

Test-first cases must assert:

- empty optional block and fault remain empty or absent in the local payload, never `Q10`/`Q`;
- backend parser preserves absence/empty input without optional-code defaults;
- preview/echo shows what arrived, without semantic replacement;
- no hidden fallback changes the meaning of a report;
- `Q99` is the only selection that reveals the conditional other-fault field.

## 4. Runtime locality snapshot

The product bundle must not import files from `docs/research/` at runtime. Use a reproducible data flow:

`approved research catalog → deterministic generator → reviewed frontend runtime snapshot → provenance/hash consistency test`

Proposed paths:

- generator: `frontend/scripts/generateAusemioLocalities.mjs`;
- generated runtime module: `frontend/src/config/data/ausemioVoLocalities.generated.ts`;
- consistency test: `frontend/tests/unit/ausemioLocalitiesSnapshot.test.ts`.

The generator reads the approved 2026-10-03 catalog, filters choices applicable to service `2`, preserves source order and exact value/label strings, and produces byte-stable output without hand-editing 928 entries. Generated metadata records settings version `2024.11.4`, capture timestamp `2026-10-03T17:11:36.434Z`, source catalog path, source SHA-256 `786bad2f37b0e7cd67e1b73bf03ee04ab9ab4a6d49d518952a3fac5c7a06a5cb`, and resulting choice count. The test compares runtime values/order/count and embedded provenance to the approved source catalog. The generated frontend module is the only locality source imported by product runtime.

Do not generate or change this snapshot during this planning checkpoint.

## 5. Autofill precedence

Track source per autofill-capable field as `untouched | auto | user`.

- Automation may set `untouched` and may update an `auto` value when the source data changes.
- On every user `change`/selection event, mark that field `user` immediately. A user clear is also `user`.
- Automation must not replace a `user` value for the remainder of the current form session, including after a locale change, refetch, or dependency rerender.
- Do not infer locality from an address unless it exactly and uniquely matches one catalog entry. Otherwise leave the required locality for user selection.
- Conditional cleanup is separate: when the user changes away from `Q99`, explicitly clear hidden `iny_druh_poruchy`; do not describe that dependency rule as automation or allow a later autofill to restore it.

Use a small field-source helper/ref or equivalent React Hook Form integration; no general-purpose state framework is needed. Executable unit tests cover all three states, async/refetch updates, locale changes, explicit edit, and manual clear. Component/browser checks verify the helper is wired to real inputs.

## 6. Local test endpoint and fail-closed transport

### Endpoint design

Use `POST /api/dev/ausemio-test-submit`. It accepts the same local multipart body emitted by the form, including literal VO field keys and repeated `files[]`. It validates service exactly `2`, required local form values, valid public VO codes when selected, locality against the generated runtime snapshot, and rejects CSS fields/codes. It must preserve empty/absent optional values and must not use the existing parser defaults.

Enable route mounting only when **both** conditions hold:

1. `NODE_ENV` is `development` or `test`;
2. an explicit flag such as `LOCAL_TEST_SUBMIT_ENABLED=true` is set.

`NODE_ENV=development` alone is insufficient. An unset flag is disabled. Production always disables the route regardless of the flag. Unit/integration tests may mount the route through an explicit test harness, while a separate gate test verifies production and unset-flag behavior.

The handler returns a structured transient echo of received field names/values and file metadata only (filename, MIME type, size). It returns no raw file bytes, target URL, external reference, or acceptance claim. Use `Cache-Control: no-store` and a status such as `local_test_received`. No DB lookup, `integration_logs`, DB write, persistent payload logging, file persistence, AUSEMIO transport, or other outbound HTTP belongs in this route’s call graph. The local route must not call `backend/src/services/reports.service.ts`, `backend/src/services/aussemio.service.ts`, `backend/src/services/ausemioMapper.ts`, or a light-point DB lookup.

### Local resource ceiling versus public-client behavior

Public parity remains: `multiple`, blank/unspecified `accept`, 30 MiB client-side per-file threshold, no public client count cap found. Do not retain current `image/*`, max-five, or 10 MiB/file settings as visible AUSEMIO parity rules.

The dev sink may enforce explicit process-protection ceilings independently. If it has a file-count or aggregate-RAM cap, define it under clearly named `LOCAL_TEST_*` settings, never reuse the product parity constants as if they came from AUSEMIO. Keep the public file picker behavior independent. Surface a local-test-specific error when the sink cap is exceeded and document the UX consequence: a selection allowed by the public client may be rejected by the local inspection sink. Use memory-only upload or temporary files with deterministic cleanup on success and every error path; never persist bytes. Test both per-file and aggregate/count boundaries at the configured local limits.

### Disabled transport behavior

The frontend has one report-submit target: `/api/dev/ausemio-test-submit`. It must not fall back to `/api/reports/send`, an AUSEMIO URL, or any other transport. If the local route is disabled or unavailable, show an explicit “submission transport unavailable / local test disabled” state and stop. Until a separate approved production-integration checkpoint, no other report transport exists.

The result uses `LOCAL TEST / SIMULATED` and `local_test_received`; it has no external reference code, “accepted/submitted” wording, or production target URL. The current Result page and preview must be updated accordingly. Network response inspection is sufficient; no extra debug UI is required.

## 7. Test-first acceptance matrix

All automated values are synthetic. Add/update tests before implementation and require them to fail against the current behavior where appropriate.

| Layer | Required cases |
|---|---|
| Frontend config/schema | Exact public VO codes/Slovak option labels; 928-locality runtime list; locality and telephone required; public optional fields; email local/client validation; consent remains outside external contract; Q99 condition; no CSS values. |
| Form/UI | No visible service selector; service `2` fixed; locality first; ordered public assignment fields; exact option values/labels; Q99 show/hide; user-editable autofill; edit and clear survive later automation, locale change, and refetch. |
| FormData | Hidden `properties[vyber_sluzby]=2`; literal VO keys; no optional `Q10`/`Q` fallback; no CSS keys/codes; repeated `files[]`; optional empty fields preserved; local `email` does not assert an external key; consent absent unless future evidence changes scope. |
| Locality provenance | Deterministic generation; same source yields byte-identical module; source hash/version/date/count recorded; runtime list/order matches approved catalog. |
| Backend endpoint | Gated mount; valid multipart echo; file metadata correct and no bytes; malformed payload response deterministic; service other than `2` rejected; CSS keys/codes rejected; no optional defaults; no DB/pool query, `integration_logs`, persistent log/file write, or outbound HTTP. |
| Transport and result | Frontend only targets local route; disabled route fails closed; no `/api/reports/send` fallback; no AUSEMIO URL/base-URL fallback; response/result says `LOCAL TEST / SIMULATED`; no “accepted/submitted” external wording or production target URL. |
| Upload cleanup/privacy | Synthetic files only; no contents in response or logs; memory buffers or temporary files deterministically cleared for success, validation failure, and upload-limit failure; endpoint response is no-store. |

Current tests use Vitest with Node environment in `frontend/vitest.config.ts` and `backend/vitest.config.ts`. Start with the existing frontend `reportSchema.test.ts` and `buildReportFormData.test.ts`, and backend `ausemioMapping.test.ts`; update obsolete expectations before product code. The current suite has no browser-interaction harness or Supertest dependency. Prefer pure helper tests for source precedence and existing `react-dom/server` for static structure only. Static rendering does not prove interactions. Do not add a new dependency without a concrete gap justification; use browser/manual QA below for actual interaction unless later audit requires automated DOM interaction coverage. Backend multipart integration can use Node 20 built-in `fetch`/`FormData` against an ephemeral loopback server.

## 8. Browser/manual QA

Use only a local development stack and synthetic report/contact/file data. Check desktop and mobile viewport, direct entry from both map-point and custom-coordinate routes, first visible locality field, order and labels, required/optional validation, Q99 show/hide/clear, editable autofill, manual edit/clear persistence after locale change/refetch, upload feedback, and the result message.

In DevTools Network inspect one multipart `POST /api/dev/ausemio-test-submit`, its field names/values and metadata-only response. Confirm the disabled-endpoint case displays transport unavailable and issues no fallback. Browser QA must install an AUSEMIO-host block/detector before page code runs; any attempted `kosice.ausem.io` or production submit URL is a failed check before transmission.

## 9. External-network safety and release gate

**P4a release blocker: zero production AUSEMIO traffic.** Tests and manual QA must demonstrate:

- frontend submit target is only the configured local API origin and `/api/dev/ausemio-test-submit`;
- a disabled/unavailable local sink fails closed, with zero fallback to `/api/reports/send` or AUSEMIO;
- the backend endpoint has no outbound HTTP transport dependency and no production base URL in its response/call path;
- test network guards fail before transmission for `kosice.ausem.io`, any production AUSEMIO submit URL, or other disallowed outbound calls;
- browser QA blocks/detects production AUSEMIO requests before they reach the network.

No production submit, live adapter, CAPTCHA/validation bypass, or external acceptance experiment is part of P4a.

## 10. Operational and documentation boundaries

**PostgreSQL operational limitation (P2 baseline):** the full backend bootstrap in `backend/src/index.ts` runs a database connectivity query and migrations before listening. The P4a endpoint call graph itself must not use PostgreSQL. The current local development stack may still require PostgreSQL as a process-start prerequisite. Do not perform a broad bootstrap refactor in P4a; if this prevents manual endpoint testing, raise a separate targeted decision.

P4a completion evidence belongs in a new checkpoint note recording accepted decisions, changed files, generated locality snapshot provenance, form and endpoint acceptance results, CI/manual QA evidence, zero-AUSEMIO-traffic validation, and remaining server UNKNOWNs. Do not duplicate P2b field research; link to the canonical contract audit and catalog above. Explicitly state that local echo proves only local receipt, never AUSEMIO acceptance.

## 11. Ordered implementation sequence

1. Add/update frontend config/schema/FormData tests for canonical VO codes, requiredness, no CSS, and no optional defaults; observe red failures before implementation.
2. Add locality generator and deterministic snapshot test; review generated diff/provenance without hand-editing choices.
3. Add and test the minimal `untouched | auto | user` precedence helper, including manual clear and refetch/locale cases.
4. Update frontend VO fields/order/labels/validation, editable auto values, local payload builder, and remove CSS/default fallbacks from the active form path.
5. Add backend multipart tests first, then the separately gated local endpoint with strict parser, metadata-only echo, no persistence/transport, and deterministic upload cleanup.
6. Switch frontend submit to the local endpoint only; implement fail-closed disabled behavior and local-only result copy/types.
7. Run frontend/backend tests, test typechecks, and builds; verify all required CI checks. Do not add implementation dependencies without justification.
8. Perform synthetic browser/manual QA with pre-network AUSEMIO blocking, capture evidence, then write the P4a checkpoint note.

## 12. Remaining decisions and explicit unknowns

No additional owner decision blocks the core form and local endpoint under the decisions above. If an inventory/custom-map location cannot be matched exactly to one public locality entry, require user selection; do not invent a fuzzy mapping. Requiring a different automatic locality mapping later needs separate owner direction.

Public email outgoing key, consent serialization/requiredness, exact multipart encoding, external server-side validation/file acceptance, resolved production endpoint, and external success/error schema remain UNKNOWN. They block any future live AUSEMIO integration, not the P4a local test endpoint.
