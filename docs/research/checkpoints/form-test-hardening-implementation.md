# FORM TEST HARDENING — Combined implementation checkpoint

- **Status:** Implementation evidence is complete; READY FOR INDEPENDENT RESULT AUDIT. This checkpoint is not closed and the implementation PR is not merged.
- **Repository base:** `master` at `f6c873d9dba331a456e5d7b4ec30fea26a4f6b4b`, after Phase 1 implementation and Phase 1 documentation closeout.
- **Branch / PR:** `test/form-hardening-combined`; [PR #11](https://github.com/krustallik/public-lighting-fault-reporting/pull/11).
- **Latest code/test head:** `f0bf538d5a23ec35d67fee1aabd0efac4a6b7387`.
- **Product boundary:** `service=2` / VO only. `service=16` / CSS remains OUT OF PRODUCT SCOPE and is not implemented.
- **Safety boundary:** all submitted data, files, emails, phone values, light-point responses and network probes are synthetic. The production AUSEMIO form was not opened or requested; no issue was created; no real PII or files were used.
- **Phase 1:** CLOSED. The canonical [Phase 1 checkpoint](form-test-hardening-phase-1.md) records PR #9 merged, PASS WITH P2, P0=0 and P1=0.

## 1. Scope and implementation summary

This checkpoint implements the approved form-test-hardening plan using component, contract, loopback route and isolated Chromium layers. Its test inventory and behavior coverage are described below; this is not a live AUSEMIO integration.

Changes across the combined PR include:

- Mounted React form/result tests with jsdom and Testing Library, expanded VO validation and literal FormData assertions, transport/API guard partitions, backend multipart boundary/cleanup/concurrency tests, browser E2E, axe checks and locality portability tests.
- A dedicated E2E support server and frontend Playwright configuration. E2E requires `PROCESS_EGRESS_ISOLATED=1`; it starts the backend and Vite on `127.0.0.1` with explicit test-only local-submit settings.
- An automatic Playwright request-policy fixture that installs the catch-all allowlist, service-worker blocking and request ledger for every browser test before page navigation, including scenarios that do not explicitly consume the ledger.
- Two narrow, evidence-backed frontend/backend behavior adjustments: `ReportFormPage.tsx` associates locality, phone and email invalid states with their error IDs; `ausemioTest.routes.ts` configures Busboy's inclusive field ceiling so exactly 65,536 bytes are accepted and +1 byte is rejected.
- A narrow locality-generator portability policy in `frontend/scripts/generateAusemioLocalities.mjs`: only CRLF/LF differences are canonicalized for the provenance digest and generated-file comparison. Spaces, Unicode, ordering and other content remain significant.
- CI jobs for process-egress research and browser E2E; browser E2E remains informational and branch protection was not changed.

No database schema/migration, persistence, live transport, CSS/service-16, or business workflow scope was added. Backend local submit remains a gated in-memory metadata echo; its route test uses a mocked DB pool and separately scoped client-fetch observations.

## 2. Test-first evidence and behavior changes

Current regression assertions are in `frontend/tests/unit/ReportFormPage.component.test.tsx`, `backend/tests/unit/ausemioLocalTestSubmit.test.ts`, and `frontend/tests/unit/ausemioLocalitiesSnapshot.test.ts`.

- Component behavior now asserts `aria-invalid`, matching `aria-describedby` error IDs, and correction/error lifecycle. `ReportFormPage.tsx` adds those attributes for locality, phone and email; this records the already approved accessible error semantics.
- The local multipart route now accepts exactly 65,536 UTF-8 bytes and rejects 65,537. The parser limit is set to 65,537 because Busboy reports truncation at its configured inclusive boundary; this is a local parser resource cap, not an AUSEMIO text rule.
- The locality test proves LF/CRLF-equivalent source/output, pinned SHA-256 `786bad2f37b0e7cd67e1b73bf03ee04ab9ab4a6d49d518952a3fac5c7a06a5cb`, 928 entries, uniqueness, deterministic generation, independent frontend/backend equality, and rejection of actual content drift.
- Browser-run corrections were test-oracle corrections, not product defects. Run `37312539013` exposed that React StrictMode produced four same-target fetches where an E2E assertion expected exactly three; the assertion now requires the initial request plus both locale refetches without coupling to development mount count. Run `37312539013` had 7/8 browser tests pass; the final suite passes 8/8 in run `37313589561`.
- Earlier isolated E2E assertions were corrected in commit `d38ed6324ea4027e8fdc416887243a8c24e67d2c`; their failed assertions concerned test timing/matching around an unmounted radio, an aborted request with no `Response`, and a non-unique text selector. They did not show a production failure.
- No artificial RED commits or rewritten history were created. The regression tests and fixes are visible in the branch commits. Separate machine-readable local RED logs for the earlier ARIA/Busboy failures were not retained as CI artifacts; no claim is made that the CI runs contain a RED phase.

## 3. Research gates and safety evidence

### Process-egress gate — PASS

The `process-egress-research` job and the browser job run a child workload inside a Linux network namespace. Setup, dependency install, browser install, checkout and GitHub runner control remain outside the isolated phase. Inside it, the only interface is loopback (`127.0.0.1/8`, `::1/128`); IPv4 and IPv6 route tables are empty. Synthetic Vite/backend communication works over loopback. Attempts by the test process, frontend process, backend process and headless Chrome to contact reserved-purpose `example.com` are blocked (`ENETUNREACH` for TCP; Chrome reports the request rejected before a response). `example.com` is the only network probe host; AUSEMIO is not used.

Latest evidence is from [CI run 37314301543](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/37314301543): `process-egress-research` and `browser-e2e` succeeded. Artifacts: `process-egress-research` ID `11347905267`, `browser-e2e-evidence` ID `11347670828`. The automatic E2E request-policy fixture installs catch-all routing before page navigation, allows only GET/HEAD to the two exact loopback origins and POST to `/api/dev/ausemio-test-submit`, blocks other requests, blocks service workers, records each request outcome and fails on any non-allowlisted request in every test. Browser E2E produced no non-loopback request and no AUSEMIO request.

This demonstrates the configured GitHub-hosted job/test process boundary, not a general claim about every CI runner or future workflow. E2E is kept informational; branch-protection configuration is unchanged.

### Locality portability gate — PASS, narrow policy

`frontend/tests/unit/ausemioLocalitiesSnapshot.test.ts` exercises the generator's `--check` path and proves that only line-ending differences are normalized. The generator confirms 928 localities and the pinned source hash. `frontend` and `backend` generated outputs are independently compared and equal; duplicates, content edits, ordering and determinism remain observable. The Windows command `node scripts/generateAusemioLocalities.mjs --check` passed. No broad whitespace or Unicode normalization was added.

## 4. Test inventory and results

At the Phase 1 implementation base, frontend had 13 Vitest files / 59 cases and backend had 7 files / 29 cases; the Phase 1 source is `form-test-hardening-phase-1.md`. At the final implementation head:

| Layer | Final inventory | Evidence / principal boundaries |
|---|---:|---|
| Frontend Vitest | 13 files / 113 tests | Full CI unit/component step and coverage step pass. Includes 13 mounted `ReportFormPage` component cases and 9 mounted/SSR `ResultPage` cases. |
| Backend Vitest | 7 files / 52 tests | Full CI unit/loopback suite passes; includes local route gating, scalar validation, multipart limits, cleanup and concurrent request isolation. |
| Chromium Playwright | 8 E2E tests | Full valid flow, Q99 conditional clearing, mobile validation/keyboard, target A→B stale response, same-target locale refetch, resource-limit response, unavailable endpoint/no fallback and direct-result fallback. |
| axe | 9 scanned UI states | WCAG 2.1 A/AA configured tags; each scan asserts zero configured violations. This is sampled automated evidence, not a full accessibility certification. |

The mounted component matrix covers fixed VO-only UI/no service selector, ordered locality/detail/block/fault/phone fields, distinct block/fault `Q10` groups, both selection directions, no defaults, Q99 show/type/clear/no stale serialization, required-field recovery, SK/EN usage, locale refetch and manual clears, target A→B reset/stale response handling, Back/Next value and attachment persistence, consent/email, local-only submit/result, and failure without alternate transport. Attachments are absent on step 1, available on step 2, preserved across same-target Back/Next, and included in synthetic FormData.

Schema and contract suites cover literal `service=2`, block/fault codes, unknown/legacy/CSS/wrong-case/padded values, required blank/whitespace partitions, arbitrary non-empty phone, email/consent, Unicode/combining marks/emoji/multiline/markup-like text, long descriptions and Q99 text, optional-field omission and repeated files. Exhaustive literal contract expectations remain independent of values derived from implementation config.

`frontend/tests/unit/localTestSubmissionTransport.test.ts` covers development/test loopback acceptance and blocked production/build/unsupported-mode, malformed URL, external/private/AUSEMIO host, `ftp:`, `file:`, `ws:`, credentials, query and hash cases; blocked cases assert zero fetch calls. `localTestSubmissionApi.test.ts` covers TypeError, 404, structured 400/413/500/503, malformed JSON/error/success schemas, valid success and one allowed local attempt with no fallback.

Backend `ausemioLocalTestSubmit.test.ts` covers development/test flag gating, production refusal, required/canonical/unknown/duplicate/CSS/service-16 scalar partitions, exact 65,536/+1 field boundary, exact/+1 per-file and aggregate limits, 0–3 files and 4-file rejection, zero-byte/arbitrary-MIME/empty-filename/unexpected-field cases, deterministic malformed input, cleanup after tested rejection/abort, and two concurrent successful streams alongside a rejected over-cap stream. Small injected test limits are used for resource and concurrency partitions. Existing real-default boundaries remain exercised without allocating oversized test bodies.

## 5. Local and remote validation

### Local (Windows checkout)

- Frontend test-source typecheck — PASS (`tsc -p tsconfig.test.json`).
- Frontend full Vitest — PASS, 13 files / 113 tests; V8 coverage collected.
- Frontend build — PASS; Vite retains its existing >500 kB chunk-size warning.
- Backend test-source typecheck — PASS.
- Backend full unit/loopback suite — PASS, 7 files / 52 tests; V8 coverage collected.
- Backend build — PASS.
- Locality generator `--check` — PASS, 928 entries and pinned hash.
- `git diff --check` — PASS. The checkout uses `core.autocrlf=true`; Git may print line-ending normalization warnings for E2E test files, but reports no whitespace errors.
- Local Playwright was not run outside the demonstrated isolated CI namespace.

### GitHub CI

Final code/test head `f0bf538d5a23ec35d67fee1aabd0efac4a6b7387` was validated by [run 37314301543](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/37314301543), conclusion success. `frontend`, `backend`, `process-egress-research`, `browser-e2e`, `sqlfluff-report` and `dependency-audit-report` jobs all completed successfully. The required `frontend` and `backend` checks are green. Frontend remote suite ran 13 files / 113 tests; backend ran 7 files / 52 tests; Playwright ran all 8 tests. No `.test.tsx` discovery regression: the 13-case component suite ran remotely as part of the frontend Vitest run.

For repeatability, earlier successful browser run `37310294503` executed the preceding 7-case browser suite 7/7; runs `37312830855`, `37313589561` and `37314301543` execute the extended 8-case suite 8/8, with the latest including the automatic request-policy fixture on every test. Run `37312539013` is retained as a test-oracle failure history, not hidden: 7/8 passed before the StrictMode-sensitive count assertion was corrected.

Remote runtime: GitHub-hosted `ubuntu-24.04.5`, runner image `20260927.320.1`; frontend/backend CI used Node `20.20.2` and npm `10.8.2`. Playwright installed Chromium Chrome for Testing `153.0.8010.12`; the process-egress probe used system Google Chrome `154.0.8037.57`. The process-egress standalone job reported Node `22.23.3`; the in-browser-job reproof reported Node `20.20.2`. Coverage artifacts from final code/test run: `frontend-coverage` ID `11347440946`, `backend-coverage` ID `11346877168`; npm audit artifact ID `11347600697`; egress/E2E artifacts listed in §3.

## 6. Coverage review

Final V8 whole-source coverage from the remote run:

| Source tree | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| Frontend | 53.17% | 80.65% | 61.46% | 53.17% |
| Backend | 54.93% | 71.76% | 40.49% | 54.93% |

These repository-wide values include unrelated admin, map, startup, legacy and generated modules; they are inventory metrics, not form-quality scores. Critical module values are `statements / branches / functions / lines`:

| Critical module | Final coverage | Proposed plan floor | Status / interpretation |
|---|---:|---:|---|
| `ReportFormPage.tsx` | 95.20 / 93.27 / 100 / 95.20% | 85 stmt/line, 85 branch, 90 func | Achieved. |
| `reportSchema.ts` | 100 / 100 / 100 / 100% | 95 all | Achieved. |
| `buildReportFormData.ts` | 100 / 63.63 / 100 / 100% | 95 stmt/line, 90 branch, 95 func | Branch floor not met; optional-field paths remain visible and are not hidden/excluded. |
| `autofillPrecedence.ts` | 100 / 100 / 100 / 100% | shared target-session proposal | Achieved for this helper; `reportTargetSession.ts` is 93.93 / 90 / 100 / 93.93%, below proposed 95% statements/lines. |
| `localTestSubmissionTransport.ts` | 100 / 100 / 100 / 100% | 95 stmt/branch, 100 func | Achieved. |
| `services/api.ts` | 91.48 / 92.30 / 88.88 / 91.48% | local-submission branch/function proposal 90/90/95 | Whole-file function figure remains below 95%; it includes `getHealth`, outside this feature. |
| `ResultPage.tsx` | 100 / 85.71 / 100 / 100% | 85 stmt/line, 80 branch, 90 func | Achieved. |
| `ausemioTest.routes.ts` | 99.63 / 92.52 / 100 / 99.63% | 95 stmt/line, 90 branch, 100 func | Achieved. |

The proposed floors are not configured as CI blockers. Missing `buildReportFormData` branches are principally optional-field combinations; any further tests should be justified by new observable behavior, not by the percentage alone. Whole-project totals remain reduced by unrelated modules.

## 7. Dependency and quality-audit evidence

This combined checkpoint adds only the frontend dev dependencies `@playwright/test@^1.63.0` and `@axe-core/playwright@^4.13.0`; the Phase 1 DOM/testing dependencies were already merged. Backend runtime/development dependencies were not changed. `frontend/package-lock.json` is updated accordingly.

The informational dependency-audit artifact for run `37314301543` reports:

| Dependency tree | Moderate | High | Critical | Total |
|---|---:|---:|---:|---:|
| Frontend | 7 | 4 | 0 | 11 |
| Backend | 7 | 3 | 0 | 10 |

Counts and severities match the Phase 1 audit recorded in `form-test-hardening-phase-1.md` and the pre-browser base lockfile comparison there. No newly introduced high/critical advisory was attributed to Playwright/axe. This does not mean either dependency tree has no advisories; the green audit job means only that the informational report was generated. No automatic dependency upgrade was made. `sqlfluff-report` is also informational; its successful job is not interpreted as zero SQL findings.

## 8. Remaining P2 / limits

- Rapid double activation is not given an exactly-one-POST contract for the current local echo and is not asserted as a count invariant. Future live AUSEMIO transport still requires an owner-defined duplicate-submit guarantee before implementation.
- The direct `/result` missing-router-state fallback remains the existing Slovak behavior; it is characterized, not redesigned/localized.
- Proposed coverage floors are not mandatory gates; `buildReportFormData` branch coverage and whole-file API function coverage remain below the proposed floors as described in §6.
- Browser E2E remains an informational job. The process gate and repeated runs pass, but repository branch protection was intentionally not changed.
- Axe checks cover configured WCAG 2.1 A/AA rules at the nine named states in `frontend/tests/e2e/report-form.spec.ts`; they do not establish complete accessibility or visual contrast. Contrast remains a separate visual/manual follow-up.
- No server-side AUSEMIO contract, live external write, issue lifecycle or receipt is tested or claimed. Local response status remains `local_test_received` / simulated only.

## 9. Audit readiness

The implementation is on branch `test/form-hardening-combined`, latest code/test head `f0bf538d5a23ec35d67fee1aabd0efac4a6b7387`, PR #11. Required CI is green, isolated browser evidence is repeated, local validation is green, dependencies/audit are recorded, and this checkpoint is the canonical evidence source. Independent result audit remains pending; this PR is not merged and this checkpoint is not CLOSED.
