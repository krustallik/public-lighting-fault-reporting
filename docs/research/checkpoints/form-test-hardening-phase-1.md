# FORM TEST HARDENING — Phase 1 evidence

- **Artifact type:** Implementation checkpoint evidence
- **Status:** READY FOR MERGE. Independent result audit PASS WITH P2; P0=0, P1=0. Published and remotely validated; not merged.
- **Base:** `master` at `2e7cda9cdb591756261f322d0b19fca410edfd20`
- **Working branch:** `test/form-hardening-phase-1`
- **Scope:** Frontend DOM/component test infrastructure, mounted public VO form tests, local transport/API regression cases, minimal CI integration, and evidence only.
- **Safety boundary:** No browser E2E, Playwright, AUSEMIO access, external report submission, CSS/service 16 support, persistence/schema changes, or locality hash changes.

## 1. Pre-change dependency compatibility research

Research was completed before editing dependency manifests. The project baseline uses React/React DOM 18.3.1, Vitest 3.2.7, Vite 5.4.11, TypeScript ~5.6.3, and Node 20 in GitHub Actions (`frontend/package.json`, `.github/workflows/ci.yml`).

| Package | Selected range | Compatibility evidence and rationale |
|---|---:|---|
| `jsdom` | `^26.1.0` | Vitest 3 supports `jsdom` as a per-file environment, with the environment installed separately. jsdom 26 requires Node >=18, which includes CI Node 20; the newer jsdom 27/30 line would need newer Node versions. |
| `@testing-library/react` | `^16.3.3` | React Testing Library v16 supports React 18 and declares React 18/19 peers. This mounts the existing React page using the project’s React DOM. |
| `@testing-library/dom` | `^10.4.2` | Explicit peer dependency required by React Testing Library v16; provides accessible role/name queries. |
| `@testing-library/user-event` | `^14.6.7` | Current v14 interaction API; its DOM Testing Library peer range is compatible with DOM Testing Library 10. |

The selected versions are development-only tools. The versions preserve the existing React major, are compatible with the CI Node 20 runtime, and do not require changing Vite, Vitest, TypeScript, or application runtime packages. `jest-dom` is omitted because the planned assertions can use Testing Library queries and standard DOM properties without custom matchers.

Compatibility references consulted:

- [Vitest 3 test environments](https://vitest.dev/guide/environment.html)
- [React Testing Library introduction](https://testing-library.com/docs/react-testing-library/intro/)
- [Testing Library user-event introduction](https://testing-library.com/docs/user-event/intro/)
- [jsdom 26.1.0 package metadata](https://www.npmjs.com/package/jsdom/v/26.1.0)
- [React Testing Library 16.3.3 package metadata](https://www.npmjs.com/package/@testing-library/react/v/16.3.3)
- [DOM Testing Library 10.4.2 package metadata](https://www.npmjs.com/package/@testing-library/dom/v/10.4.2)
- [user-event 14.6.7 package metadata](https://www.npmjs.com/package/@testing-library/user-event/v/14.6.7)

## 2. Implemented test infrastructure

- Added `jsdom`, React Testing Library, DOM Testing Library, and `user-event` as frontend dev dependencies only (`frontend/package.json`, `frontend/package-lock.json`). Installed versions are `jsdom@26.1.0`, `@testing-library/react@16.3.3`, `@testing-library/dom@10.4.2`, and `@testing-library/user-event@14.6.7`.
- `frontend/vitest.config.ts` still defaults to the `node` environment for existing tests; its include glob now runs both `.test.ts` and `.test.tsx`. `ReportFormPage.component.test.tsx` opts into jsdom with a Vitest file pragma and explicitly runs Testing Library cleanup after each test.
- The component suite mounts the real `ReportFormPage` through `MemoryRouter`. Only `getLightPoint` is replaced with synthetic resolved/deferred promises; the API transport tests stub `fetch`. No browser, external asset, live service, or external form is used.
- `.github/workflows/ci.yml` keeps the required `frontend` job and its existing `npm run test` command; the step is now named “Run frontend unit and component tests.” The `.tsx` include makes the mounted tests part of that existing job without a new workflow job.
- No `jest-dom` or custom render/event harness was added.

## 3. Added cases and test-first evidence

`frontend/tests/unit/ReportFormPage.component.test.tsx` adds six mounted cases:

1. Synthetic point autofill plus user locality/detail edit and manual clear surviving same-target refetches caused by switching locale SK → EN → SK.
2. A → B target transition resetting the form to B’s auto-filled data, returning to step 1, clearing a validation error, and dropping selected files; the step-2 file input is a new DOM element with an empty `FileList`.
3. File-size error display and its clearing/remount on A → B.
4. A pending request for A resolving after B; B locality/detail remain displayed.
5. A pending A request rejecting after B loads; B remains displayed and no stale rejection clears it.
6. Q99 reveals its text area; selecting representative non-Q99 hides and clears it; reselecting Q99 shows an empty value.

`frontend/tests/unit/localTestSubmissionTransport.test.ts` now has 16 Vitest cases: four allowed loopback cases (development localhost, IPv4, IPv6, and test mode) and 12 blocked branches (production mode/build, unsupported mode, external/AUSEMIO host, malformed URL, `ftp:`, `file:`, `ws:`, credentials, query, and hash). Each blocked case asserts `LOCAL_TEST_TRANSPORT_CONFIG` and exactly zero fetch calls.

`frontend/tests/unit/localTestSubmissionApi.test.ts` now has 10 cases. New cases cover fetch `TypeError` → `LOCAL_TEST_TRANSPORT_UNAVAILABLE`, structured 413 resource-limit and 500 errors, malformed structured error body, and malformed success schema. Every attempted transport assertion checks exactly one POST to `http://localhost:5000/api/dev/ausemio-test-submit`; no second/fallback request is permitted.

No production behavior fix was indicated by these tests. The first focused run exposed test-harness/query mistakes (locale-dependent button name, clearing a select with a text-only helper, and an ambiguous Q99 label); those assertions were corrected. The subsequent behavior-focused run passed against the unmodified application implementation. This is characterization/regression coverage, not manufactured RED evidence. No production source under `frontend/src` or `backend/src` changed.

`submitError` is reset in the target-change effect in `ReportFormPage.tsx`, but cannot be held visibly on the form in the current flow: the submit catch sets it and immediately navigates to `/result`. The mounted suite verifies visible validation/file error resets; it does not claim an independently observable `submitError` reset without altering or intercepting that navigation contract.

## 4. Validation results

Local validation used Node `v22.14.0`, npm `10.9.2`, Vitest `3.2.7`, and Windows (`core.autocrlf=true`).

| Command | Result |
|---|---|
| `frontend: npm run typecheck:tests` | PASS |
| Focused `ReportFormPage.component.test.tsx`, `localTestSubmissionTransport.test.ts`, and `localTestSubmissionApi.test.ts` | 3 files, 32/32 tests PASS |
| Full frontend `npm run test` | 13 files, 58/59 tests PASS; the sole failure is the existing newline-sensitive hash assertion in `tests/unit/ausemioLocalitiesSnapshot.test.ts`, not a new test. Expected source SHA `786bad2f…a5cb`; Windows result `ef251866…e559`. This is the already documented `core.autocrlf=true` limitation and remains unfixed. |
| Frontend `npm run coverage -- --exclude tests/unit/ausemioLocalitiesSnapshot.test.ts` | 12 files, 58/58 PASS; the exclusion is only the known failing snapshot test. Coverage includes every configured `src/**/*.{ts,tsx}` file. |
| Frontend `npm run build` | PASS; Vite emitted its existing >500 kB minified chunk advisory. |
| `backend: npm run typecheck:tests` | PASS |
| Backend `npm run test` | 7 files, 29/29 PASS |
| Backend `npm run build` | PASS |
| `git diff --check` | PASS |
| Independent result audit | PASS WITH P2; P0=0, P1=0 |
| GitHub CI | Before push: NOT VERIFIED. After publication: run `37297190674` on commit `b2d64bed5f6066082bb6d8bb7d5c8381d03bdb6e`; required `frontend` and `backend` jobs succeeded. The remote frontend job ran on Ubuntu 24.04.5 with Node 20.20.2 and completed 13 files / 59 tests, including the `.tsx` component suite. |

Coverage values use **statements / branches / functions / lines**. Baseline values are from the approved plan at the recorded baseline SHA; the after values are the partial Windows run above (locality hash test excluded). They are evidence only; thresholds are not enforcement gates.

| Critical source | Baseline | Phase 1 after | Evidence |
|---|---:|---:|---|
| `frontend/src/pages/ReportFormPage/ReportFormPage.tsx` | 45.33 / 48.64 / 20.00 / 45.33% | 80.72 / 88.54 / 70.00 / 80.72% | Mounted user interactions and async target transitions execute the page effects and render branches. |
| `frontend/src/utils/reportTargetSession.ts` | 93.93 / 75.00 / 100 / 93.93% | 93.93 / 90.00 / 100 / 93.93% | Target-change behavior is exercised through the page; no helper implementation change. |
| `frontend/src/utils/localTestSubmissionTransport.ts` | 100 / 100 / 100 / 100% | 100 / 100 / 100 / 100% | Explicit allow/deny matrix; branch coverage is complete for current helper code. |
| `frontend/src/services/api.ts` (whole-file proxy for local-submission branches) | 84.04 / 82.60 / 88.88 / 84.04% | 91.48 / 92.30 / 88.88 / 91.48% | New response/error branches improve the whole-file counters; unrelated health code remains in these values. |

The partial all-frontend report is 50.56% statements/lines, 77.59% branches, and 57.79% functions. This broad number includes untested admin, map, bootstrap, and legacy files and is not a form-quality score.

## 5. Scope, evidence, and remaining limits

- Changed paths are limited to this checkpoint, `.github/workflows/ci.yml`, frontend package manifest/lock, Vitest test discovery, and the three frontend test files listed above. Backend implementation/tests, database/schema/migrations, runtime dependencies, locality generator/snapshot, and application source are unchanged.
- No production AUSEMIO page or endpoint was opened or contacted. The component uses only mocked `getLightPoint`; API tests use local `fetch` stubs; transport guard cases assert before any real fetch. This suite has no request to `/api/reports/send` and no issue-creation path.
- The locality LF/CRLF hashing failure remains a separate portability prerequisite. Its expected hash was not edited, and the suite is not described as fully green on this Windows checkout.
- Browser E2E, Playwright, axe, process-egress isolation, exhaustive form behavior matrix, backend multipart expansion, and locality portability implementation remain outside Phase 1.
- `submitError` visibility/reset remains unobservable in the mounted form because the current catch navigates away; see §3. First-invalid focus, rapid double activation, and direct `/result` localization are also outside this phase per the canonical plan.
- The CI workflow change was exercised on GitHub run `37297190674` for commit `b2d64bed5f6066082bb6d8bb7d5c8381d03bdb6e`; the existing `frontend` and `backend` required jobs succeeded. The frontend job's “Run frontend unit and component tests” step completed 13 files / 59 tests on Ubuntu 24.04.5 with Node 20.20.2, confirming component-test discovery in remote Linux CI.
- PR #9 (`https://github.com/krustallik/public-lighting-fault-reporting/pull/9`) contains the Phase 1 change set and remains open pending merge.

## 6. Remote dependency-audit evidence

The informational `dependency-audit-report` artifact for CI run `37297190674` reports `npm audit` findings as follows. A successful informational workflow job means the report was generated; it does not mean the dependency trees have zero advisories.

| Dependency tree | Info | Low | Moderate | High | Critical | Total |
|---|---:|---:|---:|---:|---:|---:|
| Frontend | 0 | 0 | 7 | 4 | 0 | 11 |
| Backend | 0 | 0 | 7 | 3 | 0 | 10 |

Comparison with the base commit lockfiles shows the package names and versions reported by `npm audit` were already present at baseline; the Phase 1 lockfile change adds the four frontend test-development dependencies and does not upgrade existing package versions. No reported finding is attributed to those four additions. Findings are therefore evidenced as pre-existing package/version advisories for this comparison, not newly introduced by Phase 1. This is an attribution against the recorded baseline lockfiles, not a claim that the dependency trees are vulnerability-free. No automatic dependency upgrades were made.

## 7. Publication status

- Phase 1 was published in commit `b2d64bed5f6066082bb6d8bb7d5c8381d03bdb6e` on `test/form-hardening-phase-1`; the PR is #9 and remains unmerged.
- The independent result audit remains PASS WITH P2; P0=0, P1=0. Required remote CI jobs are green. The dependency-audit counts and baseline comparison are recorded in §6.
- The known Windows locality LF/CRLF hash limitation remains unresolved and is not represented as a green full local frontend run.
- **Checkpoint status: READY FOR MERGE.**
