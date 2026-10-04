# P4a Implementation — VO Form Parity + Local Test Submission

**Status:** implementation and local validation complete; ready for independent result audit. The implementation PR is not merged.
**Evidence date:** 2026-10-04
**Branch:** `feature/p4a-vo-local-test`

The approved scope and acceptance criteria are in the [P4a implementation plan](p4a-vo-form-local-test-plan.md). External AUSEMIO evidence remains canonical in the [contract audit](../ausemio/contract-audit.md) and [public field catalog](../ausemio/ausemio-public-field-catalog-2026-10-03.json); this note does not restate unknown server behavior.

## 1. Scope and boundaries

- Product support is service `2` / VO only. The client has no service selector and `buildReportFormData()` fixes `properties[vyber_sluzby]=2` (`frontend/src/config/ausemioForm.ts`, `frontend/src/utils/buildReportFormData.ts`). Service `16` / CSS is not implemented or emitted; the local endpoint rejects CSS fields and codes (`backend/src/routes/ausemioTest.routes.ts`).
- No live AUSEMIO adapter, production submission, schema/migration change, report persistence, dependency change, or P3 import/export work was added. Package manifests and lockfiles are unchanged.
- The former `/api/reports/send` client call was removed from the public form path. P4a submits only to the gated local endpoint; its echo demonstrates local receipt only, never external acceptance.

## 2. Test-first evidence

The original P4a implementation commit combined the regression tests and implementation. The historical RED output is retained here, but commit-level proof of red-before-green is unavailable; no history rewrite or reconstructed RED commit was made.

For this targeted correction, regression assertions were added and run before their corresponding implementation changes. The RED results showed:

- Frontend markup failures for the old select controls and attachment placement; schema failures for long descriptions/other-fault text and non-Slovak-pattern phone values; API failures for structured 5xx and malformed responses; and missing local-origin guard/report-target transition helpers.
- Backend failures for the old text/phone validation, absent application composition module, and changed legacy parser/service behavior.
- The new multipart field-limit regression first returned `400` instead of the required explicit `413 LOCAL_TEST_RESOURCE_LIMIT`; mapping Multer's `LIMIT_FIELD_VALUE` result fixed that failure. The upload-abort cleanup assertion remained green before implementation because the existing cleanup path already handled that case.

No assertions were weakened to obtain GREEN. Full current results are listed in section 6.

## 3. Implemented frontend behavior

- Canonical public VO codes and Slovak labels are centralized in `frontend/src/config/ausemioForm.ts` and consumed by `frontend/src/config/reportFormOptions.ts` and `frontend/src/i18n/reportFormMessages.ts`. The locality heading remains the exact public `Ulica / Miesto poruchy / Lokalita` in both UI locales. The visible step-1 order is locality → description → block → fault type → conditional other-fault field → required telephone → Continue. `lokalizacia_blok` and `typ_poruchy` are accessible radio groups with no default selection (`frontend/src/pages/ReportFormPage/ReportFormPage.tsx`). The page renders no service selector or CSS branch.
- Optional block/fault fields stay absent when blank; only `Q99` includes `properties[iny_druh_poruchy]`. Leaving `Q99` clears that dependent field. The required telephone is non-empty only and is validated before leaving step 1 (`frontend/src/schemas/reportSchema.ts`); the UI no longer claims a Slovak telephone format. Description and other-fault values have no product-level 2,000-character limit.
- Attachments are absent from step 1 and appear on step 2 as a local/product control. They allow multiple files, have no `accept` filter or client-side count cap, and advertise the confirmed 30 MiB/file client hint. Step-2 email/consent/files order is not asserted as external AUSEMIO order. Local sink resource caps are separate from public-client evidence.
- `frontend/src/utils/buildReportFormData.ts` builds literal VO keys and repeated `files[]`; consent is not serialized. `frontend/src/services/api.ts` has a single report-submit path: `/api/dev/ausemio-test-submit`. A disabled/unavailable sink displays `LOCAL_TEST_TRANSPORT_UNAVAILABLE` and does not try another route.
- The result view uses `LOCAL TEST / SIMULATED` and `local_test_received` only (`frontend/src/pages/ResultPage/ResultPage.tsx`, `frontend/src/types/reportResult.ts`).

## 4. Locality snapshot and autofill

- `frontend/scripts/generateAusemioLocalities.mjs` deterministically emits isolated frontend/backend runtime snapshots from the approved catalog. Product runtime imports generated modules, not `docs/research/`.
- `frontend/src/config/data/ausemioVoLocalities.generated.ts` and `backend/src/config/data/ausemioVoLocalities.generated.ts` each contain the same ordered 928 service-2 choices. Provenance is settings version `2024.11.4`, capture `2026-10-03T17:11:36.434Z`, and source SHA-256 `786bad2f37b0e7cd67e1b73bf03ee04ab9ab4a6d49d518952a3fac5c7a06a5cb`.
- `frontend/tests/unit/ausemioLocalitiesSnapshot.test.ts` asserts the count, source hash/provenance, byte-identical deterministic generation, source order, and equality of both snapshots to the catalog.
- `AutofillPrecedenceTracker` and `findExactUniqueLocality()` live in `frontend/src/utils/autofillPrecedence.ts`. They implement `untouched | auto | user`, exact unique locality matching, and user-edit/manual-clear precedence. `frontend/src/utils/reportTargetSession.ts` defines stable inventory/coordinate identity and reset transition behavior. Tests cover target changes, same-target preservation, and Q99 transitions; local browser QA exercised a synthetic light-point response and verified manual edits and a manual clear survived locale-triggered refetches. Browser QA did not separately navigate between two report targets.

## 5. Local endpoint and upload safety

- `backend/src/app.ts` composes the current Express app without mounting legacy `reportsRoutes`; `backend/src/index.ts` uses this composition. `backend/tests/unit/applicationRoutes.test.ts` verifies that `POST /api/reports/send` is not exposed. Repository searches found no current frontend caller. `backend/src/utils/parseAusemioMultipartBody.ts` and `backend/src/services/reports.service.ts` retain pre-P4a legacy behavior for the historical source path; `backend/tests/unit/legacyReportParser.test.ts` protects it.
- `backend/src/routes/ausemioTest.routes.ts` mounts `POST /api/dev/ausemio-test-submit` only when `NODE_ENV` is `development` or `test` **and** `LOCAL_TEST_SUBMIT_ENABLED=true`. Production remains unmounted regardless of the flag. `.env.example` and `docker-compose.yml` default the flag to false.
- The local route validates service `2`, exact locality membership, optional VO codes, Q99-only other-fault text, and local required values. It rejects unknown/CSS fields, does not invoke report/integration services or the database pool, and contains no outbound HTTP call. Success is an uncached transient echo (`Cache-Control: no-store`) with request fields and filename/MIME/size metadata only.
- Local file defaults are `LOCAL_TEST_MAX_FILE_BYTES=10485760`, `LOCAL_TEST_MAX_FILES=3`, and `LOCAL_TEST_MAX_TOTAL_UPLOAD_BYTES=20971520`. The custom storage streams bytes for accounting without retaining file buffers. Multer also has a **65,536-byte per-field transport parser ceiling**; it is a LOCAL TEST resource guard, can bound unusually long submitted text at transport level, and is not product validation or an AUSEMIO rule. Exceeding a local limit returns explicit `LOCAL_TEST_RESOURCE_LIMIT`, with no fallback transport. Endpoint tests cover file-limit boundaries, cleanup after validation rejection and request abort, and the 65,537-byte field rejection; the active request storage count returns to zero after rejection.
- `frontend/src/utils/localTestSubmissionTransport.ts` rejects production builds, malformed/non-HTTP(S) URLs, and non-loopback hosts before fetch. Only `localhost`, `127.0.0.1`, and normalized IPv6 loopback are allowed in dev/test context. There is no same-origin/external fallback. `frontend/src/services/api.ts` distinguishes unavailable network/404, endpoint errors (including structured 5xx), and malformed responses.
- The full backend bootstrap was not started because `backend/src/index.ts` runs a database connectivity query and `runMigrations()` before listening. Manual endpoint QA used an ephemeral loopback Express harness mounting only the new route (plus a synthetic read-only light-point stub); it did not connect to PostgreSQL or run migrations.

## 6. Validation results

Commands were run with the already-installed package-local Node tools because the host `npm` launcher points to a missing `npm-cli.js` in this environment:

| Validation | Result |
|---|---|
| Frontend unit tests | 12 files, 40 tests passed (`node node_modules/vitest/vitest.mjs run`) |
| Backend unit tests | 7 files, 29 tests passed (`node node_modules/vitest/vitest.mjs run`) |
| Frontend test typecheck | Passed (`node node_modules/typescript/bin/tsc -p tsconfig.test.json`) |
| Backend test typecheck | Passed (`node node_modules/typescript/bin/tsc -p tsconfig.test.json`) |
| Frontend production build | Passed (`tsc -b` + Vite 5.4.21); main JS output is 536.21 kB and above Vite's 500 kB advisory threshold |
| Backend build/typecheck | Passed (`node node_modules/typescript/bin/tsc`) |
| Locality generator check | Passed; 928 VO localities and literal approved SHA-256 verified (`frontend/scripts/generateAusemioLocalities.mjs --check`) |
| `git diff --check` | Passed after final checkpoint update |
| Required GitHub CI | Run `37225792301` succeeded on correction SHA `6d0b56d8f86cff5843593233ee021146d3ef2fd0`; required `frontend` and `backend` jobs are green (as are SQLFluff and dependency-audit jobs). Checkpoint-only follow-up `d9645452b32bdf145f63fd15214e44b7d9078858` also passed `frontend` and `backend` in run `37225974478`; SQLFluff and dependency-audit passed there too. |

Vitest's React static-render tests emit the existing `useLayoutEffect` SSR warning; they pass. No lint script is defined in either package.

## 7. Browser and network evidence

- The earlier synthetic local UI check on 2026-10-04 recorded a 390×844 viewport, 929 locality options including the empty placeholder (928 approved choices), no service selector, canonical labels/codes, `multiple` file input with absent `accept`, field order, Q99 show/clear behavior, required-phone gating, and no horizontal overflow. During this targeted correction the default in-app viewport dimensions were not re-measured.
- A synthetic inventory response (`GET /api/light-points/123`) drove exact `Biela` locality autofill and a synthetic inventory detail. Manual locality/detail edits and a manual locality clear persisted after locale changes/refetches.
- An enabled DB-free loopback run returned `local_test_received` for a synthetic form with two synthetic text files; the browser result stated local-only receipt. After the final field-order adjustment, a second enabled run again returned `local_test_received`. A separate disabled-route run returned 404 and the UI showed `LOCAL_TEST_TRANSPORT_UNAVAILABLE`. The latest QA entered 65,537 synthetic ASCII characters and synthetic contact values into the local form; the loopback endpoint returned `LOCAL_TEST_RESOURCE_LIMIT`, shown in the UI with “No alternate report transport was attempted.” The server-side request ledger contained only local endpoint calls: enabled calls returned 200 or 413; the disabled harness returned 404. There was no `/api/reports/send` request or alternate transport in these runs.
- No AUSEMIO page was opened, no request was sent to AUSEMIO, no production form was submitted, and all local QA values/files were synthetic. Source review confirms the frontend report submit path names only the local route and the new backend endpoint has no outbound transport call. The browser tooling did not provide browser-wide interception/HAR, so the network claim is limited to the observed loopback harness ledger and the source/test-enforced guard; it is not a global packet capture.
- **Observation limit:** the available in-app browser has no network interception/HAR API. An explicit 1280×900 viewport override did not change its 390×844 viewport; a Chrome browser provider and local Playwright package were unavailable. Therefore desktop-width rendering and a browser-wide pre-request AUSEMIO host blocker were not independently demonstrated in this environment. The browser sessions visited only loopback hosts, and the source/route tests enforce the local-only submit path. Re-audit should treat those evidence limits explicitly.

## 8. Files changed

The targeted correction changes the following source/tests in addition to the original P4a files already listed below:

- Backend: `backend/src/app.ts`, `backend/src/index.ts`, `backend/src/routes/ausemioTest.routes.ts`, `backend/src/services/reports.service.ts`, `backend/src/utils/parseAusemioMultipartBody.ts`, `backend/tests/unit/applicationRoutes.test.ts`, `backend/tests/unit/ausemioLocalTestSubmit.test.ts`, `backend/tests/unit/ausemioMapping.test.ts`, `backend/tests/unit/legacyReportParser.test.ts`.
- Frontend: `frontend/src/i18n/reportFormMessages.ts`, `frontend/src/pages/ReportFormPage/ReportFormPage.module.css`, `frontend/src/pages/ReportFormPage/ReportFormPage.tsx`, `frontend/src/schemas/reportSchema.ts`, `frontend/src/services/api.ts`, `frontend/src/utils/localTestSubmissionTransport.ts`, `frontend/src/utils/reportTargetSession.ts`, `frontend/tests/unit/ausemioLocalitiesSnapshot.test.ts`, `frontend/tests/unit/localTestSubmissionApi.test.ts`, `frontend/tests/unit/localTestSubmissionTransport.test.ts`, `frontend/tests/unit/reportFormMarkup.test.ts`, `frontend/tests/unit/reportSchema.test.ts`, `frontend/tests/unit/reportTargetSession.test.ts`.

Generated build metadata such as `frontend/tsconfig.tsbuildinfo` is not part of the correction.

- Backend: `backend/src/routes/ausemioTest.routes.ts`, `backend/src/index.ts`, `backend/src/config/ausemioFormOptions.ts`, `backend/src/config/ausemioMapping.ts`, `backend/src/config/data/ausemioVoLocalities.generated.ts`, `backend/src/services/reports.service.ts`, `backend/src/utils/parseAusemioMultipartBody.ts`, `backend/tests/unit/ausemioLocalTestSubmit.test.ts`, `backend/tests/unit/ausemioMapping.test.ts`.
- Frontend: `frontend/scripts/generateAusemioLocalities.mjs`, `frontend/src/config/ausemioForm.ts`, `frontend/src/config/reportFormOptions.ts`, `frontend/src/config/data/ausemioVoLocalities.generated.ts`, `frontend/src/i18n/reportFormMessages.ts`, `frontend/src/pages/ReportFormPage/ReportFormPage.tsx`, `frontend/src/pages/ResultPage/ResultPage.tsx`, `frontend/src/schemas/reportSchema.ts`, `frontend/src/services/api.ts`, `frontend/src/types/index.ts`, `frontend/src/types/localTestSubmit.ts`, `frontend/src/types/reportResult.ts`, `frontend/src/utils/autofillPrecedence.ts`, `frontend/src/utils/buildReportFormData.ts`, `frontend/src/utils/ausemioPayloadPreview.ts` (removed), and the eight focused frontend unit-test files under `frontend/tests/unit/`.
- Runtime configuration: `.env.example`, `docker-compose.yml`.
- This checkpoint: `docs/research/checkpoints/p4a-implementation.md`.

## 9. Remaining UNKNOWNs and audit boundary

External AUSEMIO email wire key/serialization, consent serialization and server-side requiredness, external multipart normalization, file count/MIME/storage limits, and external success/error response schema remain UNKNOWN as documented in the canonical contract audit. No live adapter is implemented. Desktop-width browser QA, browser-wide request interception, and a full production-network capture remain unverified due the current browser tooling limits above. The implementation is ready for independent result audit and has not been merged.
