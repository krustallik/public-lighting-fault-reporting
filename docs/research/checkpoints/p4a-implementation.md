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

Before production implementation, the new/updated executable assertions ran against the existing behavior:

- Frontend RED: 14 failing and 6 passing assertions across 10 test files. Failures demonstrated obsolete block/fault codes and labels, implicit `Q10`/`Q` payload defaults, old file count/type limits, missing locality snapshot/autofill support, the old `/api/reports/send` transport, and accepted-result wording.
- Backend endpoint RED: the new route tests could not load the not-yet-created `ausemioTest.routes` module. The canonical mapping tests separately produced two expected failures for obsolete parser defaults/codes.
- No assertions were weakened to obtain GREEN. The implementation added the local endpoint, canonical mappings, and optional-field absence behavior, then reran the suites.

## 3. Implemented frontend behavior

- Canonical public VO codes and Slovak labels are centralized in `frontend/src/config/ausemioForm.ts` and consumed by `frontend/src/config/reportFormOptions.ts` and `frontend/src/i18n/reportFormMessages.ts`. The locality heading remains the exact public `Ulica / Miesto poruchy / Lokalita` in both UI locales. The visible VO core order is locality → description → block → fault type → conditional other-fault field → required telephone; the attachments control follows these fields. `frontend/src/pages/ReportFormPage/ReportFormPage.tsx` renders no service selector or CSS branch.
- Optional block/fault fields stay absent when blank; only `Q99` includes `properties[iny_druh_poruchy]`. Leaving `Q99` clears that dependent field. The required telephone is validated before leaving step 1 (`frontend/src/schemas/reportSchema.ts`).
- The file picker allows multiple files, has no `accept` filter or client-side count cap, and advertises the confirmed 30 MiB/file client hint. Local sink caps are separate server-side limits.
- `frontend/src/utils/buildReportFormData.ts` builds literal VO keys and repeated `files[]`; consent is not serialized. `frontend/src/services/api.ts` has a single report-submit path: `/api/dev/ausemio-test-submit`. A disabled/unavailable sink displays `LOCAL_TEST_TRANSPORT_UNAVAILABLE` and does not try another route.
- The result view uses `LOCAL TEST / SIMULATED` and `local_test_received` only (`frontend/src/pages/ResultPage/ResultPage.tsx`, `frontend/src/types/reportResult.ts`).

## 4. Locality snapshot and autofill

- `frontend/scripts/generateAusemioLocalities.mjs` deterministically emits isolated frontend/backend runtime snapshots from the approved catalog. Product runtime imports generated modules, not `docs/research/`.
- `frontend/src/config/data/ausemioVoLocalities.generated.ts` and `backend/src/config/data/ausemioVoLocalities.generated.ts` each contain the same ordered 928 service-2 choices. Provenance is settings version `2024.11.4`, capture `2026-10-03T17:11:36.434Z`, and source SHA-256 `786bad2f37b0e7cd67e1b73bf03ee04ab9ab4a6d49d518952a3fac5c7a06a5cb`.
- `frontend/tests/unit/ausemioLocalitiesSnapshot.test.ts` asserts the count, source hash/provenance, byte-identical deterministic generation, source order, and equality of both snapshots to the catalog.
- `AutofillPrecedenceTracker` and `findExactUniqueLocality()` live in `frontend/src/utils/autofillPrecedence.ts`. They implement `untouched | auto | user`, exact unique locality matching, and user-edit/manual-clear precedence. Unit tests cover helper transitions; local browser QA exercised a synthetic light-point response and verified manual edits and a manual clear survived locale-triggered refetches.

## 5. Local endpoint and upload safety

- `backend/src/routes/ausemioTest.routes.ts` mounts `POST /api/dev/ausemio-test-submit` only when `NODE_ENV` is `development` or `test` **and** `LOCAL_TEST_SUBMIT_ENABLED=true`. Production remains unmounted regardless of the flag. `.env.example` and `docker-compose.yml` default the flag to false.
- The route validates service `2`, exact locality membership, optional VO codes, Q99-only other-fault text, and the local required values. It rejects unknown/CSS fields, does not invoke report/integration services or the database pool, and contains no outbound HTTP call. Success is an uncached transient echo (`Cache-Control: no-store`) with request fields and filename/MIME/size metadata only.
- Local-only defaults are `LOCAL_TEST_MAX_FILE_BYTES=10485760`, `LOCAL_TEST_MAX_FILES=3`, and `LOCAL_TEST_MAX_TOTAL_UPLOAD_BYTES=20971520`. They are enforced in the development/test multipart sink; the custom storage streams bytes for accounting without retaining file buffers. `LOCAL_TEST_RESOURCE_LIMIT` is explicit and there is no fallback transport. The endpoint tests exercise each exact boundary and +1 case and assert request storage cleanup after success and rejection.
- The full backend bootstrap was not started because `backend/src/index.ts` runs a database connectivity query and `runMigrations()` before listening. Manual endpoint QA used an ephemeral loopback Express harness mounting only the new route (plus a synthetic read-only light-point stub); it did not connect to PostgreSQL or run migrations.

## 6. Validation results

Commands were run with the already-installed package-local Node tools because the host `npm` launcher points to a missing `npm-cli.js` in this environment:

| Validation | Result |
|---|---|
| Frontend unit tests | 10 files, 24 tests passed (`node node_modules/vitest/vitest.mjs run`) |
| Backend unit tests | 5 files, 23 tests passed (`node node_modules/vitest/vitest.mjs run`) |
| Frontend test typecheck | Passed (`node node_modules/typescript/bin/tsc -p tsconfig.test.json`) |
| Backend test typecheck | Passed (`node node_modules/typescript/bin/tsc -p tsconfig.test.json`) |
| Frontend production build | Passed (`tsc -b` + Vite 5.4.21); the main JS output is above Vite's 500 kB advisory threshold (535.78 kB minified) |
| Backend build/typecheck | Passed (`node node_modules/typescript/bin/tsc`) |
| `git diff --check` | Passed after review |

Vitest's React static-render tests emit the existing `useLayoutEffect` SSR warning; they pass. No lint script is defined in either package.

## 7. Browser and network evidence

- Synthetic local UI checks were performed on 2026-10-04 at the in-app browser's 390×844 viewport. The form showed 929 locality options including the empty placeholder (928 approved choices), no service selector, canonical labels/codes, `multiple` file input with absent `accept`, exact field order, Q99 show/clear behavior, and required-phone gating. The rendered document width was 375 px against a 375 px client width; no horizontal overflow was observed.
- A synthetic inventory response (`GET /api/light-points/123`) drove exact `Biela` locality autofill and a synthetic inventory detail. Manual locality/detail edits and a manual locality clear persisted after locale changes/refetches.
- An enabled DB-free loopback run returned `local_test_received` for a synthetic form with two synthetic text files; the browser result stated local-only receipt. After the final field-order adjustment, a second enabled run again returned `local_test_received`. A separate disabled-route run returned 404 and the UI showed `LOCAL_TEST_TRANSPORT_UNAVAILABLE`. The server-side request ledger contained local test calls only: the enabled harness saw `POST /api/dev/ausemio-test-submit` → 200; the disabled harness saw the same path → 404. There was no `/api/reports/send` request or alternate transport in either run.
- No AUSEMIO page was opened, no production request or form submission was made, and all submitted QA values/files were synthetic. Source review confirms the frontend report submit path names only the local route and the new backend endpoint has no outbound transport call.
- **Observation limit:** the available in-app browser has no network interception/HAR API. An explicit 1280×900 viewport override did not change its 390×844 viewport; a Chrome browser provider and local Playwright package were unavailable. Therefore desktop-width rendering and a browser-wide pre-request AUSEMIO host blocker were not independently demonstrated in this environment. The browser sessions visited only loopback hosts, and the source/route tests enforce the local-only submit path. Re-audit should treat those evidence limits explicitly.

## 8. Files changed

- Backend: `backend/src/routes/ausemioTest.routes.ts`, `backend/src/index.ts`, `backend/src/config/ausemioFormOptions.ts`, `backend/src/config/ausemioMapping.ts`, `backend/src/config/data/ausemioVoLocalities.generated.ts`, `backend/src/services/reports.service.ts`, `backend/src/utils/parseAusemioMultipartBody.ts`, `backend/tests/unit/ausemioLocalTestSubmit.test.ts`, `backend/tests/unit/ausemioMapping.test.ts`.
- Frontend: `frontend/scripts/generateAusemioLocalities.mjs`, `frontend/src/config/ausemioForm.ts`, `frontend/src/config/reportFormOptions.ts`, `frontend/src/config/data/ausemioVoLocalities.generated.ts`, `frontend/src/i18n/reportFormMessages.ts`, `frontend/src/pages/ReportFormPage/ReportFormPage.tsx`, `frontend/src/pages/ResultPage/ResultPage.tsx`, `frontend/src/schemas/reportSchema.ts`, `frontend/src/services/api.ts`, `frontend/src/types/index.ts`, `frontend/src/types/localTestSubmit.ts`, `frontend/src/types/reportResult.ts`, `frontend/src/utils/autofillPrecedence.ts`, `frontend/src/utils/buildReportFormData.ts`, `frontend/src/utils/ausemioPayloadPreview.ts` (removed), and the eight focused frontend unit-test files under `frontend/tests/unit/`.
- Runtime configuration: `.env.example`, `docker-compose.yml`.
- This checkpoint: `docs/research/checkpoints/p4a-implementation.md`.

## 9. Remaining UNKNOWNs and audit boundary

External AUSEMIO email wire key/serialization, consent serialization and server-side requiredness, external multipart normalization, file count/MIME/storage limits, and external success/error response schema remain UNKNOWN as documented in the canonical contract audit. No live adapter is implemented. Desktop-width browser QA, browser-wide request interception, and a full production-network capture remain unverified due the current browser tooling limits above. The implementation is ready for independent result audit and has not been merged.
