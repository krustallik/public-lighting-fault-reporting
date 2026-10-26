# VO / service 2 integration boundary

**Status:** internal preparation only. No production AUSEMIO adapter or active report-send route exists in this package. The existing local test sink remains the only public submit path.

**Repository baseline:** `aae32aa4170a3b8709b8b6c674b0dbf06a637aa8`

**Fresh public-client capture:** 2026-10-16 17:04:45.848 UTC
**Scope:** AUSEMIO service `2` / VO. Service `16` / CSS is outside product scope.

## Read-only public evidence

The canonical page `https://kosice.ausem.io/#/public/issues/new` returned HTTP 200 in an anonymous Microsoft Edge / Playwright context. The capture script at [`guarded-readonly-capture.mjs`](guarded-readonly-capture.mjs) installs the request route before page creation/navigation, allows only GET/HEAD to the exact `https://kosice.ausem.io` origin, blocks every other origin/method, blocks service workers and form submission, and disables beacon, WebSocket, and EventSource paths. Browser fetch/XHR guards also allow only same-origin GET/HEAD. No cookies, headers, raw response bodies, query strings, or signed storage paths are retained.

Capture ledger: **104 allowed GET, 0 HEAD, 1 blocked third-party GET, 0 unsafe method attempts**. The blocked request was `https://www.gstatic.com/charts/loader.js`. No unsafe method reached the origin. The only UI changes were selecting the VO radio and Q99 radio to reveal its conditional field; no personal data, file, submit, `submit()`, or `requestSubmit()` was entered or invoked.

The sanitized capture recorded these asset hashes (raw bundles and settings were not saved):

| Public resource | Bytes | SHA-256 |
|---|---:|---|
| `/implementation/all_settings` | 75,206 | `453ecbc086113c517ce205a0359cd87d439b67f3262f540aa5393677f4bfd047` |
| `/vite/assets/application-eyamT7CZ.js` | 1,707,688 | `044e50674dae1bf1e7d225af6d86a9c9c4ed8a0e2e846a17875d94ef404ecb38` |
| `/vite/assets/PublicIssuesNew-D4z9SGrg.js` | 10,593 | `2b01d31bceae39ac520425666ce04aa58e579a385277d5999c0f55e70e2d2b6b` |
| `/vite/assets/RulesMixin-BVL4IKk_.js` | 3,090 | `ce1e8455073200232255cb7beebf2b624741fe3e72a56b16ae2af68a46b22006` |
| `/vite/assets/InputFile-nPU3sKmB.js` | 5,903 | `ff5ecbadc95d627893d7b6d7dba2d1e069ab72e01ddd3931b2d9acb9210f4ca7` |
| `/vite/assets/jsonToFormData-dkDHiHqn.js` | 1,583 | `41447a77db0ef19f5df4c7db3355016109dcbea9b8a7f818c956ede0dcb871f7` |

The form bundle hashes match the 2026-10-03 capture. The settings body changed from the prior 74,678-byte snapshot, so the current settings were parsed in memory again. The current public settings report version `2024.11.4`, public form enabled, template assignment `100`, 10 field assignments, and 928 locality options.

### Current public VO mapping

These facts are confirmed from the current public settings and rendered UI. They describe client configuration, not server acceptance:

| Order | Public client key | Current public value / behavior |
|---:|---|---|
| 0 | `vyber_sluzby` | required; `2` = VO |
| 1 | `ulica_miesto_poruchy_lokalita` | required; 928 locality choices; shown for service 2 |
| 2 | `detail_decription` | optional text; shown for service 2 |
| 3 | `lokalizacia_blok` | optional; `Q10` Pred blokom, `Q11` Vedľa bloku, `Q12` Za blokom |
| 4 | `typ_poruchy` | optional; `Q`, `Q1`, `Q2`, `Q3`, `Q4`, `Q6`, `Q10`, `Q61`, `Q99` with labels in the public field catalog |
| 8 | `iny_druh_poruchy` | optional text revealed when `typ_poruchy=Q99` |
| 9 | `tel_cislo` | required telephone field |

The current Q99 rendered state displays its additional text input. The file control is multiple and has a blank `accept`; public settings provide `doc_max_size=30` and compression dimension `1920`. The previous source audit interprets the public component's 30 MiB per-file client check; current server file rules and count limits remain unknown. Public email and consent controls are visible on the contact step, but neither an external email field key nor consent serialization is confirmed.

## Confirmed local behavior and mapping boundary

- The public app builds local `FormData` in [`frontend/apps/public/src/utils/buildReportFormData.ts`](../../../frontend/apps/public/src/utils/buildReportFormData.ts). It fixes service `2`, trims the locality/description/optional values, uses literal field keys from `frontend/apps/public/src/config/ausemioForm.ts`, appends repeated local `files[]`, then `email`, `locale`, and a separate `reportTarget` JSON field. It does not serialize consent.
- The active server endpoint is `/api/dev/ausemio-test-submit`, mounted only when `NODE_ENV` is `development` or `test` and `LOCAL_TEST_SUBMIT_ENABLED=true` in [`backend/src/routes/ausemioTest.routes.ts`](../../../backend/src/routes/ausemioTest.routes.ts). It validates the service-2 form, consumes the one-time email-verification capability when enabled, records only anonymous recurrence metadata in `fault_report_history`, and returns only `local_test_received` plus a file count. It does not call AUSEMIO or persist citizen-provided content or attachments.
- For an explicitly selected inventory light, [`backend/src/services/faultReportHistory.service.ts`](../../../backend/src/services/faultReportHistory.service.ts) reads only prior rows for that `light_point_id`, constructs operator-facing `additionalInfo` in memory, and stores the generated notes with allowed metadata. The local HTTP response omits the operator payload. The admin history API exposes metadata/automatic notes only and is behind admin authorization. Manual/custom/device targets produce no recurrence notes.
- OTP challenge state is PostgreSQL-backed. `consumeSubmissionVerification()` is atomic/single-use and bound to the normalized email and intent. The local endpoint's successful response is a simulated local receipt only.
- [`backend/src/integrations/ausemio/voSubmissionBoundary.ts`](../../../backend/src/integrations/ausemio/voSubmissionBoundary.ts) defines a typed internal `CanonicalVoReportDraft`, validates/maps the existing local fields using the shared VO lists, and carries attachment metadata without binary bytes or an assumed upstream part name. The local test route reuses its mapper for local validation and attachment counting. The transport port itself is not wired into application composition or invoked by that route; the module contains no HTTP client, endpoint, headers, API key, database writes, or production activation flag.
- A test-only [`FakeVoSubmissionTransport`](../../../backend/tests/support/FakeVoSubmissionTransport.ts) exercises the injected transport port in memory. A resolved call means only that the fake port returned. All outcomes preserve `externalAcceptance: 'unknown'`; no HTTP status, accepted issue ID, or AUSEMIO response semantics are represented.

Canonical mapping is tested with independent literal fixtures in `backend/tests/unit/voSubmissionBoundary.test.ts`, `frontend/tests/unit/buildReportFormData.test.ts`, and `backend/tests/unit/ausemioLocalTestSubmit.test.ts`. The expected literals are authored in tests rather than imported from the mapping under test. These tests establish repository behavior and literal public-client correspondence only.

## Confirmed, inferred, and unknown contract

| Classification | Facts |
|---|---|
| **Confirmed — public client** | Service-2 public keys, option values/labels, requiredness and Q99 condition in the table above; public client source constructs a `files` collection, appends locale, and configures a multipart POST to relative `public_issues`. No submit was executed. |
| **Confirmed — repository** | Current frontend emits the local field names listed in the boundary module; backend local validation and local simulated receipt behavior are implemented and tested; no active AUSEMIO HTTP adapter exists. |
| **Inferred only** | The public client's relative URL probably resolves through its app API configuration. Its absolute destination and the relationship between public multipart part names and local names are not established. |
| **Unknown** | Server-side field acceptance, exact multipart field/array/file part names, email and consent fields, upload size/count/MIME rules, auth/CSRF requirements, absolute endpoint, request headers, accepted/error status and body, external reference semantics, and target-coordinate/asset-ID handling. |

The repository's unused `AUSEMIO_BASE_URL` default is `https://kosice.ausemio.io/public_issues`, while this read-only capture used the public page origin `https://kosice.ausem.io`. This host/configuration discrepancy is unresolved; the configured URL is not evidence of a working server endpoint and must be confirmed from an approved contract before any future adapter uses it.

The local `files[]`, `email`, `locale`, `reportTarget`, and bracketed property names are not asserted as external wire names. The local sink remains a test-only simulated receipt and its result must never be presented as AUSEMIO acceptance.

## OTP, timeout, retry, and idempotency

The current OTP capability is consumed before the local sink returns its receipt. A future external write can succeed at AUSEMIO while the response is lost; the capability would already be consumed, and resending the same report may create a duplicate. The new boundary classifies a returned transport, transport rejection, timeout, or ambiguous result, but it deliberately marks external acceptance unknown in every case.

No OTP semantics or persistence were changed. Safe external retry cannot be decided until AUSEMIO documents an idempotency/deduplication contract or the owner approves another recovery approach that does not create an authoritative local citizen-report database. Do not auto-retry an ambiguous write. The fake tests do not demonstrate upstream idempotency or acceptance.

## Geocoding and coordinates

- `NOMINATIM_AUTO_GEOCODE` governs the older inventory light-point address enrichment in `backend/src/services/lightPoints.service.ts`; the owner confirmed it remains false. The geocode maintenance script also refuses `NODE_ENV=production`.
- `GEOAPIFY_ENABLED` governs the separate public report-address suggestion path. The owner confirmed Geoapify report-time address suggestions remain enabled in production; `ReportFormPage.tsx` calls that path for custom/device coordinate targets, while service-area validation remains local and authoritative. This package does not change that behavior.
- `backend/src/domain/reportTarget.ts` validates numeric coordinate ranges and Košice service-area membership. For an inventory light-point ID, PostgreSQL coordinates are canonical and client-supplied coordinates are ignored. Custom/device targets are validated from submitted numeric coordinates. This validation does not send an AUSEMIO request.

No geocoding decision is open in this package: inventory-side Nominatim remains off, Geoapify report-time suggestions remain active under the existing product decision, and coordinate/service-area validation is unchanged.

## External facts and activation prerequisites

Before implementing or activating an external adapter, obtain an official safe non-production contract or owner-approved test environment that documents: absolute endpoint and authentication; field and multipart serialization for VO-only requests; email/consent handling; whether inventory IDs or coordinates are required; attachment rules; response/error semantics and stable external reference; and idempotency or deduplication behavior. Confirm the safe test environment is not production. If only a production write can establish a fact, stop without testing it.

No activation flag, live provider call, external submission, production/VPS DB mutation, migration, or LaTeX change is part of this package. PostgreSQL verification used only the local disposable test container described below.

## Verification evidence

On 2026-10-16, local frontend `npm run coverage` passed: 35 files, 253 tests, **94.63% lines / 87.45% branches**. Frontend typecheck and production build passed with the same synthetic CARTO build values used by CI. Backend `npm run build` and `npm run typecheck:tests` passed. The local Windows backend coverage run against disposable PostGIS covered 49 files, 443 passed, and 19 skipped; it reported **74.91% lines / 86.15% branches**, below the line gate because PostgreSQL 16 `pg_dump` is unavailable on this host and Phase B backup integration tests were consequently skipped.

At then-current PR head `cedf2150cfe267b7aadaeb5228b82331ace14194`, [GitHub Actions CI run](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/38940078548) completed successfully. Its independent frontend/backend coverage jobs reported **frontend 94.63% lines / 87.45% branches** and **backend 87.13% lines / 85.25% branches**; backend ran the disposable PostgreSQL integration and coverage suite. Its browser E2E ran after the process-egress containment job passed, including disposable PostgreSQL OTP persistence and reset checks. This CI run used no real AUSEMIO or Resend calls. Later package commits only refreshed validation evidence documentation; application, test, and config code remained unchanged. The local Windows coverage shortfall above is an environment limitation; the Linux CI run is the evidence that the configured backend threshold passes.
