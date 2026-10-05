# Test Hardening Plan — Public VO Form and P4a Local Submit

- **Artifact type:** Proposed test/research plan
- **Status:** Planning/research only. No tests, dependencies, CI configuration, or application behavior were changed.
- **Repository baseline:** `master` at `66f2aa6b030979990c2a9eb469fc5d920251a311`
- **Evidence date:** 2026-10-05 (Europe/Bratislava)
**Product boundary:** Service `2` / VO only. Local submission is a gated echo; this plan does not propose live AUSEMIO submission.

This plan builds on the closed P4a implementation checkpoint in [`p4a-implementation.md`](p4a-implementation.md), and is a proposal for independent review. The external AUSEMIO contract remains documented in [`../ausemio/contract-audit.md`](../ausemio/contract-audit.md). No AUSEMIO page or service was accessed while preparing this plan.

## 1. Current test inventory and coverage baseline

### 1.1 Test files

The repository currently has 12 frontend test files (40 cases) and 7 backend test files (29 cases). All are Vitest unit or loopback HTTP tests; there is no browser E2E test suite.

| Test file | Cases | What current assertions establish | Boundary / gap |
|---|---:|---|---|
| `frontend/tests/unit/ausemioLocalitiesSnapshot.test.ts` | 1 | Catalog hash, 928 choices, capture metadata, generation determinism, and each checked-in snapshot matching generator output. | The expected hash is computed over raw text bytes. On this Windows checkout the test fails under `core.autocrlf=true`; it does not itself exercise the CLI `--check` path or directly assert cross-runtime LF/CRLF behavior. |
| `frontend/tests/unit/ausemioVoContract.test.ts` | 3 | Fixed service `2`, the exact block/fault code arrays, selected Slovak labels/headings, and the locality heading in English context. | Most expectations are against imported config/message values; no user selection or complete rendered EN form is exercised. |
| `frontend/tests/unit/autofillPrecedence.test.ts` | 2 | Untouched/auto/user source precedence, user clear as an explicit edit, exact unique locality match, duplicate rejection, and non-normalized near matches. | Exercises helpers directly, not React events or asynchronous responses. |
| `frontend/tests/unit/buildReportFormData.test.ts` | 3 | Literal fields and key order for a representative case, service `2`, trimming/blank omission, no CSS/consent/legacy target fields, Q99-only other-fault data, and repeated file order. | Uses three constructed values; it does not table-test every code or assert every file's MIME/size metadata at the endpoint. |
| `frontend/tests/unit/localTestSubmissionApi.test.ts` | 5 | One local POST, no second attempt for 404, structured 400/503 errors, and malformed JSON response handling. | Does not cover a rejected fetch `TypeError`, 413, malformed success schemas, malformed structured error bodies, or every response status branch. |
| `frontend/tests/unit/localTestSubmissionTransport.test.ts` | 8 | Allows `localhost`, `127.0.0.1`, and `::1` in development; rejects external/AUSEMIO host, production build/mode, and malformed URL before fetch. | It does not explicitly cover test mode, other runtime modes, `ftp/file/ws`, credentials, query/hash, or separate unsafe URL branches. |
| `frontend/tests/unit/reportFormMarkup.test.ts` | 2 | Server-rendered markup includes the current codes, no default radio choice or service selector, selected labels/order, and file input placement/multiple/no-accept hints. | Uses SSR markup regex/string comparisons; the file-placement test slices source text. Neither proves real interaction, focus, browser order, or accessibility tree behavior. |
| `frontend/tests/unit/reportSchema.test.ts` | 6 | Required locality/email/consent/phone, step-1 phone requirement, long text and arbitrary non-empty phone acceptance, selected valid/invalid examples, multiple files, and public 30 MiB/file client hint. | Only some literals and validation partitions are exercised; no complete error-message/UI lifecycle, whitespace matrix, Unicode matrix, or local 10 MiB sink boundary here. |
| `frontend/tests/unit/reportTargetSession.test.ts` | 4 | Helper-level A→B reset, same-target preservation, coordinate identity, and Q99 clear predicate. | No mounted component, URL transition, in-flight request, file input, step, or displayed error behavior is tested. |
| `frontend/tests/unit/resultPageLocalTestSemantics.test.ts` | 1 | SSR success copy says local receipt and avoids external-acceptance wording/reference. | Only a success state in static rendering; no failure status, locale variation, direct navigation, or actual API-to-route navigation. |
| `frontend/tests/unit/slovakPhone.test.ts` | 3 | Frontend helper normalization and synthetic invalid sentinel behavior. | The public VO form intentionally accepts any non-empty phone; these helper tests do not establish current form behavior. |
| `frontend/tests/unit/sortImportPreviewRows.test.ts` | 2 | Import preview sorting order and input immutability. | Unrelated to public VO form or P4a local submit. |
| `backend/tests/unit/applicationRoutes.test.ts` | 2 | Real loopback `createApp()` composition returns 404 for `POST /api/reports/send` and exposes the enabled local route. | No disabled-production assertion through the full app composition; production gate is tested at the mounted-route helper. |
| `backend/tests/unit/ausemioLocalTestSubmit.test.ts` | 15 | Loopback route gating; metadata-only echo/no-store; omitted options; service/CSS/locality checks; long text and non-empty phone; malformed body; per-file/count/aggregate exact and +1 boundaries; 65,537-byte field rejection; abort cleanup. | No exact 65,536-byte field case, malformed limit env matrix, duplicate scalar, arbitrary unknown field, unexpected file field, empty/zero-byte/MIME matrix, concurrent request isolation, or abort at multiple phases. |
| `backend/tests/unit/ausemioMapping.test.ts` | 3 | Literal current keys/code sets/locale and technical-log projection excluding contact/location values. | Tests mapping utilities, not the current local route or public UI. |
| `backend/tests/unit/importParsing.test.ts` | 3 | Representative CSV, JSON aliases, and GeoJSON coordinate order. | Unrelated to public VO form and P4a submit. |
| `backend/tests/unit/legacyReportParser.test.ts` | 2 | Preserves the historical parser's defaults and old simulated service behavior with the external service mocked. | Protects disabled/legacy code, not the active P4a route; it must not be mistaken for live external integration coverage. |
| `backend/tests/unit/slovakPhone.test.ts` | 3 | Backend phone helper normalization and invalid sentinel behavior. | The local P4a endpoint only requires a non-empty phone string; these helper tests do not prove the local endpoint contract. |
| `backend/tests/unit/streetLightsExport.test.ts` | 1 | CSV header, quoting for comma/quote/newline, and one repository query. | Unrelated to public VO form and P4a submit. |

### 1.2 Evidence quality and meaningful gaps

- `reportFormMarkup.test.ts` is useful as a small server-rendered structural check, but its source slicing and string-order assertions can pass while browser event wiring, focus, validation visibility, and step behavior are broken.
- `ausemioVoContract.test.ts` and `buildReportFormData.test.ts` contain valuable explicit contract literals. They are not substitutes for selecting each radio and observing the resulting accessible/serialized value.
- `ausemioLocalitiesSnapshot.test.ts` anchors a catalog hash and checks generated output; comparing snapshots to output from the same generator is partly self-referential. The literal hash, count, provenance, and an explicit frontend/backend equality assertion should remain independent checks. The current Windows run exposed line-ending sensitivity, not a demonstrated locality-label mismatch.
- `reportTargetSession.test.ts` and `autofillPrecedence.test.ts` test helpers only. `ReportFormPage.tsx` has actual effects for target changes and async light-point data, including a cancellation flag; stale-response and reset behavior remain unproven at component level.
- Backend `ausemioLocalTestSubmit.test.ts` uses a real loopback Express server and is the strongest current integration coverage for this flow. It mocks the DB pool and observes fetch; it proves the tested route does not query the mocked pool, while a process-wide assertion for every possible outbound transport/log sink is outside that test's boundary.
- `ResultPage` and form markup tests use `renderToStaticMarkup`; current output includes React Router `useLayoutEffect` SSR warnings. Static output checks do not model user focus, keyboard input, or navigation state changes.
- There are no tests with a DOM environment, Testing Library interaction APIs, Playwright, or automated accessibility scanner. Both Vitest configs use `environment: 'node'`.

### 1.3 Coverage report

Coverage was collected locally with Vitest 3.2.7 / V8 on Node 22.14.0, Windows, at the repository baseline above. The output includes every `src/**/*.{ts,tsx}` file, not only P4a modules. This makes the whole-repository percentage a broad inventory metric, not a measure of form quality.

The complete frontend run executed 40 cases: 39 passed and the locality snapshot hash assertion failed. Expected SHA-256 is `786bad2f37b0e7cd67e1b73bf03ee04ab9ab4a6d49d518952a3fac5c7a06a5cb`; the Windows checkout produced `ef25186647ca4f27c44a8e71447eca690614d3a84c0470a8ec6b59a205f7e559`. The checkout has `core.autocrlf=true`. Therefore the complete run did not print a final frontend coverage table. A second run excluded only that failing test and passed 39/39; the partial report below is explicitly not a complete suite baseline.

| Suite/report | Tests | Statements | Branches | Functions | Lines | Interpretation |
|---|---:|---:|---:|---:|---:|---|
| Frontend, excluding only the failing locality snapshot test | 39/39 passed | 45.80% | 63.94% | 47.70% | 45.80% | Partial source baseline; all frontend source files are included. |
| Backend full suite | 29/29 passed | 54.48% | 66.66% | 40.49% | 54.48% | Full backend source baseline; includes untested admin/legacy/runtime modules. |

Critical-source per-file report, ordered `statements / branches / functions / lines`:

| Source file | Coverage | Readout |
|---|---:|---|
| `frontend/src/pages/ReportFormPage/ReportFormPage.tsx` | 45.33 / 48.64 / 20.00 / 45.33% | Main interactive form; only static SSR markup test reaches it. Largest target for component coverage. |
| `frontend/src/pages/ResultPage/ResultPage.tsx` | 63.79 / 36.36 / 100 / 63.79% | Success path is tested; error/fallback/locale branches remain. |
| `frontend/src/schemas/reportSchema.ts` | 100 / 100 / 100 / 100% | Direct schema cases have full measured counters, but do not prove the UI surfaces them correctly. |
| `frontend/src/services/api.ts` | 84.04 / 82.60 / 88.88 / 84.04% | Local submit response paths partially covered; `getHealth` is outside P4a and uncovered. |
| `frontend/src/utils/buildReportFormData.ts` | 100 / 63.63 / 100 / 100% | Statements/functions covered; optional-field decision branches need broader table tests. |
| `frontend/src/utils/autofillPrecedence.ts` | 100 / 100 / 100 / 100% | Helper counters complete; no component lifecycle proof. |
| `frontend/src/utils/reportTargetSession.ts` | 93.93 / 75 / 100 / 93.93% | Helper counters strong; branch gaps and mounted-page transitions remain. |
| `frontend/src/utils/localTestSubmissionTransport.ts` | 100 / 100 / 100 / 100% | Current covered examples do not enumerate every malformed URL/mode branch. |
| `backend/src/app.ts` | 100 / 100 / 100 / 100% | Composition path has loopback route coverage. |
| `backend/src/routes/ausemioTest.routes.ts` | 94.46 / 81.18 / 100 / 94.46% | Current route behavior is well exercised; several multipart/env/error branches remain. |
| `backend/src/utils/parseAusemioMultipartBody.ts` | 86.66 / 71.42 / 100 / 86.66% | Historical parser, not part of the active local sink. Keep its legacy test separate from P4a coverage claims. |

The reports are generated under ignored `frontend/coverage/` and `backend/coverage/` directories by the commands described in §14; they are not committed evidence. No project coverage thresholds are configured. The frontend workflow stops its later steps when the unit test step fails, although coverage artifact upload is marked `always()` in `.github/workflows/ci.yml`.

## 2. Behavior matrix

Priorities in this proposal: **P1** protects submit boundaries, state integrity, and data/resource isolation; **P2** covers important user-facing behavior and contract partitions; **P3** covers lower-risk portability or additional resilience. “Browser” indicates whether an actual browser runtime is needed; component tests use a DOM but not a browser engine.

### Test-layer responsibility

Keep exhaustive contract literals independent while avoiding repeated exhaustive matrices at every layer:

| Test layer | Responsibility |
|---|---|
| Independent unit/contract tests | Own the canonical literal field-key and public-code matrix, including labels where the repository defines them, and detect unexpected contract drift without deriving expected values from the implementation under test. |
| Backend route tests | Cover server-side validation partitions, resource limits, malformed/missing/unknown/duplicate input, cleanup, and route gating. They do not need to replay every valid public code when the independent matrix already anchors those literals. |
| Component tests | Use representative valid values and realistic user interactions; explicitly cover the `Q10` cross-field collision and `Q99` conditional field. They do not repeat every code combination. |
| Browser E2E | Cover a small set of critical cross-layer seams and complete user journeys, not the full code/value matrix. |

### 2.1 Rendering, interactions, validation

| Behavior / risk | Layer; browser? | Existing coverage | Missing evidence and recommended test; priority |
|---|---|---|---|
| Hidden fixed `service=2`; no service selector and no CSS product branch | FormData + rendered component; no | Contract/SSR checks and one FormData assertion | Render accessible DOM, assert selector absent and submit emits only `2`; assert product never emits `service=16`. P1. |
| Locality is first; exact VO field labels/order: locality, detail, block, fault, conditional other fault, phone | Component; no | SSR markup checks step-1 order and several Slovak labels | Assert actual DOM roles/labels and full order in SK and EN; verify that screen-reader group names match. P2. |
| Block radio values `Q10/Q11/Q12`, labels, no default; fault values `Q/Q1/Q2/Q3/Q4/Q6/Q10/Q61/Q99`, labels, no default | Independent literal contract tests plus representative component tests; no | Literal arrays and SSR default/unselected radios; selected messages only partially asserted elsewhere | Keep the exhaustive expected key/code/label matrix in the independent contract layer. In components, select representative values and explicitly prove that `Q10` is distinct across the two field groups; cover `Q99` interaction separately. P2. |
| Q99 field appears, accepts text, then clears after leaving Q99; switching into Q99 does not resurrect stale text | Component; no | Helper predicate and initial absence tested | Select Q99, type, select a representative non-Q99, then reselect Q99 and prove empty; assert final FormData has no stale text. The independent contract layer owns the exhaustive option literals. P1. |
| Phone required before step 2; `Next` and `Back` preserve valid values | Component; no | Zod step-1 schema only | Click `Next` blank and characterize the current field-error and focus behavior; enter arbitrary non-empty phone and advance; Back/Next preserves inputs. Required step validation and value preservation are P1; first-invalid focus is P2 characterization only and does not authorize a product change. |
| Step-2 email and consent; attachment control only in step 2; consent not serialized | Component + FormData; no | Static source placement, schema required values, consent omission in FormData | Navigate steps, assert labels/errors, submit disabled until consent, attachment file list appears only in step 2, and consent never enters FormData. P1. |
| SK/EN rendering and locale toggle | Component; no | Slovak labels, English locality heading, serialized locale | Assert the complete form and errors in both locales; toggle locale mid-form and preserve user-edited values for the same target. P2. |
| Each required blank and whitespace-only case | Schema + component; no | Locality/email/phone/consent examples; blank optionals and whitespace phone in select cases | Table-test blank/whitespace locality, phone, email, consent false, and each step-specific required combination; verify messages appear and disappear after correction. P1. |
| Each valid literal option and each invalid/legacy/CSS value | Independent contract layer plus backend route partitions; no | Some block/fault positives; examples `Q8`, `Q5`, `Q20`, CSS key and service 16 rejected | Keep every valid public literal in the independent contract matrix. At the route, test representative valid values and each distinct server validation partition (unknown, old, wrong-case, whitespace, CSS, service 16); avoid replaying the whole valid matrix in both layers. P1. |
| Long text, arbitrary non-empty phone, email, consent, trimming | Schema + FormData + route; no | 2,501-character text and arbitrary phone accepted; one malformed/valid email and consent true/false; FormData trims selected strings | Equivalence-class table for whitespace-only versus non-empty, valid/invalid email, consent false/true, leading/trailing spaces, and long description/other-fault boundary. Assert which layer trims and what bytes are serialized. P2. |
| Slovak/Unicode text and unusual but valid descriptions | Component + route; optional browser | No dedicated Unicode/multiline cases | Use Slovak diacritics, combining characters, emoji, newline, punctuation, and text resembling markup; assert round-trip echo without lossy trimming/HTML interpretation. P2. |
| Public attachment behavior: multiple, no `accept` restriction, no client count cap, 30 MiB/file hint | Component + schema; no | Schema permits six files and 30 MiB/file; markup checks `multiple` and no `accept` | Select synthetic `File` objects in DOM, display names, reject 30 MiB + 1, permit multiple files, preserve selection while stepping Back/Next. Never use real files. P2. |
| Keyboard radio arrows, Space, Enter, tab order; disabled/loading and rapid double submit | Component and browser E2E; browser for native keyboard confirmation | No interaction tests | Characterize native radio arrow/Space behavior and step keyboard behavior. Assert existing Next loading/disabled state and submit disabled before consent and while in flight. Characterize the current rapid double-activation behavior without requiring exactly one POST for local echo. The single-submit guarantee is a separate mandatory prerequisite before any future live AUSEMIO transport. P2, except established disabled/in-flight state characterization. |
| Error announcement and focus after validation failure | Component + accessibility scan; no browser for DOM, browser for focus behavior | SSR includes `fieldset`/`legend`; radio fieldset error attributes exist in source | Characterize current error associations, accessible names, and focus behavior (`aria-invalid`, `aria-describedby`, error IDs) and verify correction removes stale errors. First-invalid focus is P2 accessibility/UX hardening, not a required product contract; do not change product behavior solely to satisfy its test. Verify associations rather than assume them from adjacent spans. |

### 2.2 Locality and report-target/autofill lifecycle

| Behavior / risk | Layer; browser? | Existing coverage | Missing evidence and recommended test; priority |
|---|---|---|---|
| Exactly 928 VO locality entries, pinned source SHA, deterministic generation, order, duplicate rejection | Generator unit + snapshot; no | Count/hash/order metadata and deterministic module assertions | Add explicit duplicate-input rejection test and direct `frontend == backend` data/module equality assertion. Preserve content-drift detection. P1. |
| Generated-file drift and LF/CRLF portability | Required research/decision before portability implementation, then CLI fixture tests and platform CI; no browser | Snapshot comparison; canonical checkpoint documents current `core.autocrlf` issue | First research and document a canonical hashing policy. It must make LF/CRLF-only checkout differences pass, make real content changes fail `--check`, preserve pinned original-source provenance, and separately verify frontend/backend generated equality. Do not select an algorithm in advance of that research. The current Windows raw-hash failure is a portability issue, not permission to weaken content-drift detection. P2. |
| Exact unique address match; unknown, duplicate, whitespace, and case mismatch | Helper unit + component; no | Exact match, duplicate rejection, extra text and a combined case/whitespace near-match | Split the partitions; assert unknown/duplicate/leading-space/lowercase each do not autofill, then observe the locality UI remains editable and safe. P2. |
| `untouched → auto`, auto refresh, user edit blocks further auto, manual clear blocks further auto | Helper and React component; no | Helper transitions; direct component evidence absent | Mounted form: resolve synthetic light-point response, edit or clear field, refetch/change locale, then assert user value/empty string remains. P1. |
| Same target refetch and same-target locale switch preserve edits | Component; no | Helper same-identity case | In component test drive a locale toggle and repeated same-ID response; assert locality/detail and files/errors/step behavior explicitly. P1. |
| LightPoint A→B, lightPoint→coordinates, coordinates A→B, coordinates→lightPoint | Component; no | Identity helper for lightPoint and distinct coordinates; helper reset case | Drive router search params through every transition and assert form defaults, new autofill, files, file input DOM node/key, errors, submit error, step, and loading state reset. P1. |
| Old target response resolves after new target; old/new request failures | Component with deferred API promises; no | Source effect has a `cancelled` cleanup flag; no test | Resolve A after B and prove only B appears; cover A rejection after B and B rejection, no stale loading/error mutation. P1. |
| Selected files and native file-input DOM state reset on target change | Component; no | `ReportFormPage.tsx` clears `selectedFiles` and changes `fileInputKey`; no test | Assert visible list clears and old input node is replaced; new target can select the same filename again. P1. |

### 2.3 FormData, frontend transport and result semantics

| Behavior / risk | Layer; browser? | Existing coverage | Missing evidence and recommended test; priority |
|---|---|---|---|
| Exact literal keys, service `2`, locality, phone/email/locale, each block/fault code | Independent contract unit plus representative FormData unit; no | One representative key set/codes; blank optional test | Keep the exhaustive literal field/code/key expectations in the independent contract matrix. FormData tests use representative values and independently assert exact serialization, including the `Q10` field distinction; do not repeat every code combination. P1. |
| Optional blank omission; Q99 other text only for Q99; no stale text, CSS keys, legacy defaults, consent, `lightPointId` | FormData unit; no | Representative omission/Q99/stale data/CSS/consent checks | Cover whitespace-only values and every transition case; assert absent keys rather than empty defaults and no CSS/legacy fields in all cases. P1. |
| `files[]` repeated order and metadata | FormData + real loopback route; no | Two file names/order in FormData; route returns one file metadata | Assert original order and filename/type/size round-trip with synthetic files and ensure no bytes/content appear in response/logging. P2. |
| Development `localhost`, `127.0.0.1`, `::1`; test mode | Transport unit; no | Three hosts in development only | Add explicit test-mode success for each allowed loopback form that is supported. P1. |
| Production/other modes, external and AUSEMIO hosts, malformed URLs | Transport unit; no | Development external/AUSEMIO, production mode/build, malformed string; each tested block asserts fetch zero | Add arbitrary other mode, AUSEMIO variants, and ensure every blocked case asserts exactly zero fetch invocations. P1. |
| `ftp:`, `file:`, `ws:`, credentials, query, hash | Transport unit; no | Protocol and URL subbranches not explicitly covered | Add one table row per rejected parser branch; assert the guard fails before transport and with stable error code. P1. |
| Network `TypeError`, 404, structured 400/413/500/503, malformed JSON/error/success schema | API unit; no | 404, structured 400, 503, and malformed JSON; one-attempt/no-fallback examples | Cover rejected fetch `TypeError`, 413, 500, all malformed schema branches and valid response, with exact call count one for attempted local transport and zero for blocked origin. P1. |
| Result page success, unavailable, resource-limit, invalid, malformed response, server error, locale, missing router state | Component + E2E; yes only for actual navigation | Static success copy prevents external-acceptance claim | Render result variants, preserve `errorCode`, and assert no external-reference/acceptance wording. Characterize the existing direct `/result` no-router-state fallback; do not introduce new SK/EN fallback semantics. Any fallback UX/localization change requires a separate owner decision. P2 characterization. |

### 2.4 Backend gating, multipart/resource and isolation

| Behavior / risk | Layer; browser? | Existing coverage | Missing evidence and recommended test; priority |
|---|---|---|---|
| Dev+flag true/false/unset, test+true, production+true, active `/api/reports/send` 404 | Backend loopback integration; no | Gate matrix at helper/route and active createApp checks | Keep current cases; add production full-app composition check and assert unsupported route does not fall through to any legacy service. P1. |
| Malformed `LOCAL_TEST_MAX_FILE_BYTES`, `LOCAL_TEST_MAX_FILES`, aggregate limit | Backend route setup test; no | Defaults only | Table-test blank/default and invalid zero, negative, decimal, non-number, unsafe integer; app must fail closed before exposing route. P1. |
| No DB, integration-log, external HTTP, or raw file persistence/logging | Backend loopback plus spies; no | Pool mock unused, fetch count is the single client loopback call, response excludes marker bytes | Strengthen boundary with injected/observable DB and outbound transport/logger spies and metadata-only assertions on both success/failure; distinguish test client's loopback fetch from server outbound calls. P1. |
| Zero/one/two/three/four files; 10 MiB/file, +1; 20 MiB aggregate, +1 | Backend loopback multipart; no | Zero/one/three/four; exact and +1 per-file, count, aggregate | Preserve exact/+1 pairs. Add zero-byte and split-chunk boundary cases; for resource tests use streamed synthetic bodies to control memory. P1. |
| Field bytes 65,536 exact / 65,537 +1 | Backend loopback multipart; no | +1 only | Add exact-at-limit acceptance and +1 rejection with deterministic `413 LOCAL_TEST_RESOURCE_LIMIT`. P1. |
| Malformed multipart, unexpected file field, unknown scalar field, CSS field, duplicate scalar | Backend loopback multipart; no | Missing boundary, CSS field/code, unknown locality | Add each case and assert deterministic client code/status, no unexpected echo, and cleanup. Duplicate scalar must fail closed rather than silently selecting one value. P1. |
| Empty filename, MIME variations, zero-byte file | Backend loopback multipart; no | One synthetic text file; MIME is echoed as metadata | Characterize filename/MIME contract without introducing product MIME restrictions; assert local sink remains metadata-only. P2. |
| Abort during file stream, validation error after upload, cleanup on all terminal paths | Backend loopback with controlled stream; no | One client abort and several resource errors assert `activeRequests=0` | Assert cleanup for parse, field validation, file cap/count, aggregate cap, request error, and success. Add controlled abort before/at/after threshold only where stream behavior can be deterministic. P1. |
| Concurrent requests and `activeRequests` isolation/races | Backend loopback with concurrent synthetic clients; no | No concurrent test | Valuable: run two accepted requests plus one limit rejection/abort concurrently, prove per-request totals do not mix and every completion/abort returns active count to zero. Use small env caps/barriers; avoid random sleeps/load tests. Add “single response/callback” assertion if a deterministic reproducer exists; otherwise do not couple tests to private callback implementation. P1. |

### 2.5 Browser E2E, external-network safety and accessibility

No E2E suite exists today. Browser E2E implementation is blocked until the separate process-egress research gate below passes.

| Scenario | Recommended layer / priority | Assertions and safety boundary |
|---|---|---|
| Full valid form flow and Q99 show/type/switch/clear | Playwright E2E; P1 | Fill synthetic locality/contact data, choose Q99, enter then clear conditional text, move steps, receive only `local_test_received`; assert UI says local/simulated, never external acceptance. |
| Target A→B, same-target locale persistence, manual clear, files | Playwright E2E; P1 | Use a synthetic local light-point stub and deferred response route; prove old target response cannot overwrite new, same target keeps edits, target change clears file list and input. |
| Enabled/disabled endpoint and resource rejection | Playwright + local `createApp()` process; P1 | Explicit test env/flag for enabled app; a second server without flag returns unavailable; synthetic oversize fixture gets local resource error; assert no second route attempted. |
| Mobile/desktop viewport, keyboard-only, reload/back where meaningful | Playwright E2E; P2 | Run at explicit mobile and desktop viewports; tab/arrow/space/enter through controls; verify history behavior only where the form state contract promises it. |
| Accessible names, labels, fieldset/legend, errors and focus | Testing Library plus Playwright; P1/P2 | Role/name queries, label association, fieldset/legend, radio `name`, `aria-invalid`/`aria-describedby`, and error association. Characterize current focus behavior. First-invalid focus is P2 UX hardening, not a required behavior change. Run axe on the public form and error states. |
| Contrast | Manual/accessibility review, not unit-test claim | Automated DOM tests can check semantics but do not establish that contrast is acceptable across rendered states. Record contrast separately if measured. |

Browser-level request interception is mandatory before the first `page.goto()`, but it is not process-level isolation:

1. Create a fresh Playwright context with service workers blocked; register a catch-all `context.route('**/*', ...)` before page code executes.
2. Allow only the local frontend origin and the local test API endpoints needed by that test. Fulfill data from synthetic fixtures or the loopback `createApp()`; no external assets, analytics, map tiles, AUSEMIO GET, or production URLs.
3. Abort and fail immediately on any hostname ending in `ausem.io`, any non-loopback report `POST`, or `/api/reports/send` under any host. Also deny every other non-loopback request by default; retain a request ledger and assert all denied-request counts are zero.
4. Use only reserved `.test` emails, synthetic addresses, and generated text/byte buffers. Never click external links, use a production URL, or submit to AUSEMIO.

### 2.6 Blocking pre-E2E process-egress research gate

Before implementing any browser E2E tests, research and document a real process-level outbound-network isolation mechanism that works on GitHub-hosted `ubuntu-24.04`. `context.route()` plus blocked service workers are browser-level defenses only; they do not isolate Node, backend, test-runner, or other processes.

The gate must establish and retain evidence for all of the following:

1. Compare feasible supported mechanisms for GitHub-hosted `ubuntu-24.04`; identify the selected mechanism and its limits, or record that no feasible mechanism was found.
2. Contain outbound network access for the Playwright browser and all Node/backend/test processes in the E2E phase, leaving only the required loopback connections available.
3. Complete GitHub Actions setup, checkout, dependency installation, browser binary installation, and any other required connectivity before entering the network-denied phase.
4. Demonstrate that an outbound connection is actually blocked using a safe synthetic external target or another controlled proof. Never use AUSEMIO, including as a probe.
5. Preserve sanitized evidence of the mechanism/configuration, the blocked-egress proof, and the result in the checkpoint evidence.
6. Keep browser request interception and a zero-external-request ledger as additional browser-level defenses; do not describe them as process isolation.

Only a PASS on this research gate permits implementation of browser E2E. The `browser-e2e` job must remain informational until the isolation proof is stable and repeatable; only then can it be considered for required-check status. If no feasible runner mechanism is found, stop E2E implementation, mark process isolation unresolved, and present alternatives for an owner/architecture decision without silently weakening the requirement. This plan revision does not implement firewall rules or network isolation.

## 3. Proposed tooling

Current frontend dependencies include React 18, React DOM, React Hook Form, Zod, Vite, Vitest 3.2.7, and `@vitest/coverage-v8`. Current backend uses Express 4, Multer 2, `pg`, and the same Vitest/V8 coverage versions. No DOM environment, Testing Library, Playwright, or axe package is listed in `frontend/package.json` or `backend/package.json`.

| Proposed dev dependency | Exact gap it closes | Existing tooling alternative | CI / maintenance cost |
|---|---|---|---|
| `jsdom` | Supplies a browser-like DOM for Vitest component tests; current Vitest environment is `node`. | `happy-dom` is a lighter DOM alternative, but choosing both adds no value. Native browser tests alone would be slower for exhaustive form-state cases. | Moderate install footprint; no browser binary. Keep DOM tests deterministic and reserve actual navigation/native behavior for Playwright. |
| `@testing-library/dom` | Makes the DOM testing dependency explicit for the Testing Library component setup and accessible queries. | Hand-built query helpers would duplicate DOM Testing Library behavior and reduce consistency. | Low runtime cost; pin and verify alongside the selected React Testing Library version. |
| `@testing-library/react` | Mounts `ReportFormPage` and `ResultPage` and queries rendered controls through accessible roles/names rather than source text. | Low-level `react-dom/test-utils` is already available through React DOM but would require a custom render/cleanup harness and encourage implementation-coupled tests. | Low runtime cost; standard React testing pattern, small maintenance burden. |
| `@testing-library/user-event` | Models typing, tabbing, radio selection, Space/Enter and focus transitions used by the matrix. | `fireEvent` or direct DOM assignment are available but simulate lower-level events and can miss realistic focus/keyboard sequences. | Low; adds async event setup to tests. Keep time-based behavior controlled, not slept. |
| `@playwright/test` | Real browser engine for multi-step E2E, viewport, keyboard, navigation, file input, and route interception. | Vitest browser mode would still require browser provider/config and is less aligned with independent E2E fixtures; custom Puppeteer harness would duplicate runner features. | Highest cost: pinned browser download/cache and a separate job. Run a small stable critical-flow suite, not every data partition. |
| `@axe-core/playwright` | Runs repeatable accessibility rules on actual rendered form and error states. | Explicit DOM assertions remain necessary but cover only known attributes; a manual audit can complement but not replace regression checks. | Low-to-moderate test runtime; rule engine needs reviewed exceptions. It cannot prove contrast in every visual state or replace human review. |

Do not add dependencies in this checkpoint. During implementation, pin versions via lockfile and confirm compatibility with current Vite/Vitest/React before adoption. Declare `@testing-library/dom` explicitly with the React Testing Library setup. `jest-dom` is optional and is not a mandatory dependency; use it only if its matchers provide a concrete readability benefit. Avoid a custom event or browser harness unless a concrete feature is unsupported by these standard tools.

## 4. CI design proposal

`.github/workflows/ci.yml` currently runs `frontend` and `backend` on PRs to and pushes to `master`. Those are the required checks. Frontend performs install, test-source typecheck, unit tests, coverage, and build; backend performs the same plus a PostgreSQL 16 `SELECT 1` connectivity check. Coverage artifacts upload with 14-day retention. `sqlfluff-report` and `dependency-audit-report` are informational.

| Job | Proposed behavior | Required status |
|---|---|---|
| `frontend` | Keep clean install, test typecheck, Vitest unit/component suite, coverage artifact, and production build. | Required for every PR. |
| `backend` | Keep clean install, test typecheck, unit/loopback integration suite, coverage artifact, build, and PostgreSQL readiness smoke. The P4a local sink tests must stay DB-independent and assert no DB call. | Required for every PR. |
| `browser-e2e` | Start Vite + a `createApp()` test server on loopback in one isolated runtime; run deterministic synthetic flows under Playwright interception plus the separately proven process-egress isolation gate. Upload trace/screenshot only on failure; ensure no sensitive data is present. | Informational until the pre-E2E isolation research gate passes and the isolation is stable and repeatable; only then consider required status. |
| `postgres-integration` | Exercise migrations/repository transactions only when persistence/schema paths are in scope; use a disposable PostgreSQL service and teardown. | For stable branch protection, either declare the job on every relevant workflow run and self-skip internally with success when out of scope, or provide an always-created stable summary/gate job that evaluates the conditional result. Never require a check name that is absent on some PRs. |
| `accessibility` | Run axe against form/result and validation states inside component/E2E jobs, with reviewed findings and no silent blanket ignores. | Initially report while establishing baseline; require zero new serious/critical violations after baseline triage. Keyboard/focus assertions remain explicit required tests. |
| `sqlfluff-report`, `dependency-audit-report` | Keep informational behavior until a separate baseline/triage policy changes. | Informational; their green job status does not mean there are no findings. |

All test steps must be deterministic and independent of internet/AUSEMIO. Install dependencies and browser binaries before entering the network-denied test phase. The browser route policy must be installed before scripts; post-install E2E execution should have external egress denied by the process-level mechanism established in the pre-E2E research gate. Page interception alone is not egress isolation. Never weaken safety by allowing an external URL because a test fixture or page component requested it.

## 5. Coverage policy proposal

Do not set a global 100% target. Continue publishing whole-source reports; consider per-module statements, branches, functions, and lines thresholds only after the evidence conditions below are met. Keep difficult executable paths in the report; do not exclude code to inflate percentages. Generated locality data remains covered by its pinned snapshot/generator checks, not by meaningful branch percentages.

The numeric floors below are proposed eventual targets only. They are not approved thresholds or blockers and are not configured in CI:

| Critical module | Statements/lines | Branches | Functions | Current measured baseline |
|---|---:|---:|---:|---|
| `ReportFormPage.tsx` | 85% | 85% | 90% | 45.33 / 48.64 / 20 / 45.33% |
| `reportSchema.ts` | 95% | 95% | 95% | 100% all counters |
| `buildReportFormData.ts` | 95% | 90% | 95% | 100 / 63.63 / 100 / 100% |
| `autofillPrecedence.ts` + `reportTargetSession.ts` | 95% | 90% | 95% | Autofill 100% all; target session 93.93 / 75 / 100 / 93.93% |
| `localTestSubmissionTransport.ts` | 95% | 95% | 100% | 100% all counters |
| Local-submission branches in `services/api.ts` | 90% | 90% | 95% | Whole file 84.04 / 82.60 / 88.88 / 84.04%; unrelated health branch included |
| `ResultPage.tsx` | 85% | 80% | 90% | 63.79 / 36.36 / 100 / 63.79% |
| `backend/src/routes/ausemioTest.routes.ts` | 95% | 90% | 100% | 94.46 / 81.18 / 100 / 94.46% |

Before considering enforcement, require a stable component/E2E suite and a risk-based rationale for every critical module. First record and use a baseline/no-regression policy; consider the proposed floors only after that evidence exists. Do not write implementation-coupled tests just to raise a percentage. Avoid a single project-wide gate because admin, legacy, bootstrap, and unrelated map code currently dilute the aggregate. Keep generated data and type-only files visible in raw reports; document only technical non-executable exclusions if the coverage provider counts them.

Reasonable limits: browser file choosers cannot be automated as OS dialogs, but Playwright `setInputFiles` can test page handling; actual AUSEMIO/server responses must never be contacted, but all parser branches can use synthetic responses; contrast cannot be established from unit tests alone; environment-specific build constants should be exercised through injected runtime inputs where possible, not by contacting external systems. Any genuinely unreachable branch must be listed with a code reference and reason before exclusion.

## 6. Test-first rollout

1. **Locality portability research:** before implementing portability behavior, compare candidate canonical hashing policies against the four requirements in §2.2; preserve source provenance and keep frontend/backend equality as a separate check. Record the selected policy and rationale, or leave implementation blocked if research cannot establish one. No algorithm is selected by this plan revision.
2. **Component test infrastructure:** add the approved DOM/user-event layer and mount public form/result with `MemoryRouter`; stub light-point and submit API at local boundaries. Confirm one meaningful test fails if a user-observable contract is broken.
3. **Close current P2 gaps:** add real component target-switch/reset characterization and exhaustive transport-denial branches plus explicit fetch `TypeError` regression. For a demonstrated bug, capture RED first, then implement the smallest behavior change and verify GREEN; this document authorizes no code change.
4. **Complete form behavior matrix:** test required established behavior, representative user interactions, Q10 collision, Q99 reveal/clear, step navigation, validation, locale, email/consent, and attachments. Keep the exhaustive literal code/key oracle in the independent contract layer rather than duplicating it in components and E2E.
5. **Harden backend multipart behavior:** add field exact/+1 and malformed-env cases, duplicate/unexpected input cases, and cleanup/concurrency checks with loopback synthetic requests.
6. **Process-egress research gate:** before any browser E2E implementation, satisfy §2.6 on the actual GitHub-hosted `ubuntu-24.04` runner and retain the mechanism and blocked-egress proof. If no feasible mechanism is established, stop this rollout at the gate and obtain an owner/architecture decision.
7. **Browser E2E:** only after the gate passes, add full valid and Q99 flows, target race, files, disabled/enabled sink, resource rejection, mobile/desktop, and keyboard critical seams under preinstalled browser interception and process-level network deny.
8. **Accessibility:** add axe runs and explicit accessible-name, error association, and radio keyboard tests; characterize current first-invalid focus as non-blocking P2. Do not change product solely to satisfy a focus test; manually assess contrast separately.
9. **CI and coverage policy:** preserve current `frontend`/`backend` required checks; keep browser E2E informational until isolation is stable and repeatable. For scope-dependent PostgreSQL tests, use a check that always exists. Treat numeric coverage floors as proposals; establish a stable suite, per-module risk rationale, and baseline/no-regression evidence before considering enforcement.
10. **Docs/evidence:** update the checkpoint with exact test names/results, browser/version, network-isolation and request-ledger evidence, coverage baseline/results, known platform limits, and audit outcome. Do not duplicate external-contract evidence from the canonical contract audit.

The required checkpoint closeout sequence is: **implementation → GREEN tests → coverage/evidence → CI → independent Code Audit result audit → corrections/re-audit if needed → checkpoint closure**. Do not close the checkpoint before the independent result audit passes.

Every new bug discovered in these phases starts with a regression test and recorded failing result. Keep assertions on public behavior and boundaries; avoid tests that copy a private implementation branch without proving its output or safety effect.

## 7. Acceptance criteria for the future hardening implementation

Acceptance criteria distinguish current behavior, safety invariants, owner-decision-gated UX, and future live-integration requirements. All executable tests use synthetic data and local services only.

The following owner decisions are recorded for this revision: first-invalid focus is not a current mandatory contract; rapid double-submit is not a one-POST contract for local echo; direct `/result` without router state keeps its existing fallback semantics, and changing that UX/localization requires a separate owner decision.

### Established behavior: required characterization/regression tests

- The existing suite and new component tests exercise established form behavior: current required-field validation, values preserved by Back/Next where implemented, submit disabled before consent, and actual submit/in-flight state.
- Characterize the current first-invalid focus behavior and the current rapid double-activation result for local echo. These tests record present behavior; they do not require a particular focus destination or exactly one POST, and do not authorize product changes solely to satisfy the tests.
- Characterize direct `/result` navigation without router state using the existing fallback. Do not introduce new Slovak/English fallback semantics; any fallback UX or localization change requires a separate owner decision.
- The independent unit/contract layer owns the exhaustive literal key/code matrix. Backend route tests cover validation partitions; component tests use representative values plus explicit Q10 collision and Q99 interaction; E2E covers critical seams only.
- Exercise target changes, stale responses, FormData serialization, local transport denials, route gating, multipart boundaries, cleanup, and result states through the planned focused test layers.
- The locality portability policy is selected only after research and meets all four requirements: line-ending-only differences do not create false drift, real content edits fail the check, pinned original-source provenance remains intact, and frontend/backend generated equality is checked separately.

### Technical safety invariants: required

- The local submit path remains local/test-only and gated; rejected origins call fetch zero times; the route does not persist reports or send outbound transport; all requests and files are synthetic.
- Before any browser E2E implementation, the §2.6 research gate demonstrates process-level egress denial on GitHub-hosted `ubuntu-24.04`, with only necessary loopback traffic allowed during test execution and retained evidence of a blocked synthetic outbound attempt.
- Browser interception is installed before page scripts and blocks service workers and external requests. The request ledger has zero AUSEMIO requests, non-loopback report POSTs, or `/api/reports/send` requests. No AUSEMIO endpoint is used as a probe.
- CI evidence is reproducible on a clean install. Browser E2E is not required until process isolation is proven stable and repeatable. Scope-dependent PostgreSQL checks use an always-present stable check name or summary gate.

### Owner-decision-gated UX: non-blocking hardening

- First-invalid focus remains P2 accessibility/UX hardening. Characterize current behavior; do not change product behavior only to make a focus assertion pass.
- Direct-result fallback text/localization changes remain outside this checkpoint until a separate owner decision.

### Future live-integration requirement: not a P4a/local-echo requirement

- A single-submit/one-POST guarantee under rapid double activation must be defined and tested before any future live AUSEMIO transport is implemented. It is not an acceptance criterion for the current local echo.

### Test evidence constraints

- Use synthetic fixtures, reserved `.test` email addresses, generated text/byte buffers, and loopback processes. No production endpoint, real PII, AUSEMIO access, issue creation, or external form submission is permitted.
- Accessibility checks establish semantics and keyboard behavior; report contrast only after a separate visual/manual assessment.

## 8. Risks and limitations

- The current Windows frontend test run is not fully green because of raw catalog hash sensitivity under `core.autocrlf=true`; this plan records the evidence and proposes a portability test, but does not alter the current hash or generator.
- SSR markup assertions can continue to serve as cheap structural tests but must not be represented as interaction/accessibility coverage. Existing React Router SSR `useLayoutEffect` warnings are expected in these static tests; DOM tests should avoid relying on server rendering.
- Playwright adds browser installation/runtime cost. Keep E2E cases focused on cross-component seams; leave the large code/invalid-value matrix to fast unit/component/API tests.
- Concurrent multipart checks can become flaky if they rely on timing or allocate several 20 MiB bodies. Use streamed, deterministic barriers and small injected test limits for interleaving; retain the existing exact real-default boundary tests separately.
- Network interception alone is not a complete process egress policy. Before E2E implementation, the CI job must use a mechanism researched and demonstrated through §2.6 to deny outbound access after setup as well as inspect browser requests; if no feasible mechanism exists, E2E remains blocked for owner/architecture decision.
- No server-side AUSEMIO contract is established by these tests. The only external reference is client-side evidence in the canonical audit; local echo means local receipt only.

## 9. Files and evidence reviewed

This plan was prepared from repository source and test files, not README claims. Main evidence paths:

- Public form and state: `frontend/src/pages/ReportFormPage/ReportFormPage.tsx`, `frontend/src/schemas/reportSchema.ts`, `frontend/src/utils/autofillPrecedence.ts`, `frontend/src/utils/reportTargetSession.ts`, `frontend/src/utils/buildReportFormData.ts`.
- Frontend transport/result: `frontend/src/utils/localTestSubmissionTransport.ts`, `frontend/src/services/api.ts`, `frontend/src/pages/ResultPage/ResultPage.tsx`.
- Locality and code lists: `frontend/scripts/generateAusemioLocalities.mjs`, `frontend/src/config/data/ausemioVoLocalities.generated.ts`, `backend/src/config/data/ausemioVoLocalities.generated.ts`, `frontend/src/config/ausemioForm.ts`, `backend/src/config/ausemioFormOptions.ts`.
- Backend route/resource boundaries: `backend/src/app.ts`, `backend/src/routes/ausemioTest.routes.ts`, `backend/tests/unit/applicationRoutes.test.ts`, `backend/tests/unit/ausemioLocalTestSubmit.test.ts`.
- Test and CI tooling: `frontend/vitest.config.ts`, `backend/vitest.config.ts`, both package manifests, `.github/workflows/ci.yml`.
- Canonical external evidence and P4a closeout: `docs/research/ausemio/contract-audit.md`, `docs/research/checkpoints/p4a-implementation.md`.

## 10. Audit status

This is a proposal only; implementation, test files, dependencies, CI, and product decisions remain unchanged. The suggested test stack, threshold floors, and CI rollout are ready for independent plan audit.
