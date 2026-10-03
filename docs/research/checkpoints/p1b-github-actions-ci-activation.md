# P1b GitHub Actions CI Activation

**Status:** checkpoint in progress; local validation passed, GitHub execution/publication evidence pending
**Evidence date:** 2026-10-03
**Scope:** CI workflow and research/checkpoint documentation only. No production deployment, AUSEMIO write, or product-behavior change is authorized by this checkpoint.

Canonical factual baseline: [P0 baseline and P2 read-only research](p0-baseline-and-p2-read-only-research.md). Canonical public AUSEMIO evidence: [AUSEMIO contract audit](../ausemio/contract-audit.md). P1a test-foundation decisions/results: [P1a local test foundation](p1a-local-test-foundation.md). This checkpoint is canonical for its CI design, execution, reports, and validation.

## Owner decision and starting repository state

- **CONFIRMED — owner decision:** GitHub Actions is the CI provider for this checkpoint. This resolves the provider choice recorded as open in P0.
- **CONFIRMED — owner authorization:** publish the already-approved local checkpoint commits plus this checkpoint to `origin/master` only if the live remote head remains unchanged and publication is a normal fast-forward. No force push, history rewrite, destructive reset, or branch-protection bypass is allowed.
- **CONFIRMED — repository state at checkpoint start:** local branch `master`, clean working tree, `HEAD=4a592e85982232122f7ef3134bb4f3ca1a451ab7`; local `origin/master=d2b1c205036004e4e86e7246cb7a6551c7d40bd0`; live `git ls-remote` reported the same remote commit. The local branch was two commits ahead (`a44bf17`, `4a592e8`).
- **CONFIRMED — GitHub settings read:** repository has no classic protection on `master` and no repository rulesets at inspection time. The authenticated GitHub API reported admin access. No merge rule is inferred from these facts; a required check must be selected/configured and validated explicitly before it is described as enforced.
- If the live branch changes before publication or GitHub rejects a permitted fast-forward, stop publication and report **OWNER ACTION REQUIRED**. Do not bypass any new protection or conflict.

## Acceptance criteria

1. A checked-in GitHub Actions workflow runs on pull requests targeting `master` and pushes to `master`.
2. Frontend and backend run clean lockfile installs, test typechecks, unit/characterization tests, coverage, and production builds on Node 20, matching the repository Docker runtime (`frontend/Dockerfile`, `backend/Dockerfile`).
3. Backend CI has a disposable PostgreSQL 16 service, checks readiness, and proves a client connection with a read-only `SELECT 1`. It does not run migrations or establish the canonical migration policy.
4. SQLFluff runs with the repository `.sqlfluff` configuration and never auto-fixes. Existing rule findings are reported as informational until separately triaged; CI/tool/configuration failure is recorded distinctly from rule findings.
5. `npm audit --json` runs for both lockfiles as non-blocking evidence because the baseline includes untriaged advisories. Reports and exit codes are retained; no `npm audit fix` runs. Codex Security is not added because no supported non-interactive integration is established in this repository.
6. Workflow permissions are least-privilege (`contents: read`); no repository secrets, environment secrets, production services, deployment steps, or AUSEMIO requests are used. Unit tests use local synthetic fixtures/mocks.
7. Coverage and compact dependency/SQL reports are uploaded without `.env`, cookies, PII, secrets, or sensitive raw captures. No JUnit output is promised unless a runner already emits it; current Vitest configuration emits text, LCOV, and HTML coverage.
8. Green-on-success and red-on-failure are evidenced on GitHub. A red run must be on an ephemeral test branch/PR, never on `master`; the failing test is temporary and is removed before the final green branch result. Required-check merge blocking is claimed only if repository rules actually enforce it.
9. `origin/master` contains the approved checkpoint commits and P1b changes by fast-forward only, then is read back to verify the resulting remote SHA.

## Workflow design

The implementation is `.github/workflows/ci.yml`.

| Job/check | Work | Gate classification |
|---|---|---|
| `frontend` | Node 20; `npm ci`; `npm run typecheck:tests`; `npm run test`; `npm run coverage`; `npm run build`; upload coverage | Required candidate |
| `backend` | Node 20; `npm ci`; test typecheck/tests/coverage/build; PostgreSQL 16 readiness and `pg` client `SELECT 1`; upload coverage | Required candidate |
| `sqlfluff` | Install pinned SQLFluff; lint every repository SQL file using `.sqlfluff`; retain full report and lint exit code; never run `fix` | Informational while the known baseline is triaged |
| `dependency-audit` | Run `npm audit --json` against both package lockfiles; preserve raw reports and exit codes | Informational/non-blocking until security policy is decided |

Initial check names above are workflow job IDs. Once a GitHub run exists, use the observed check context names when configuring and validating branch rules. P1/P0 require significant behavior-changing work to wait for a real green CI gate with a demonstrated red path; local foundation work is not blocked by this checkpoint.

### Action and runtime pinning

The workflow uses immutable commit SHAs read from the official action release refs on 2026-10-03:

| Action | Release tag | Commit |
|---|---|---|
| `actions/checkout` | `v7.0.1` | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | `v7.0.0` | `820762786026740c76f36085b0efc47a31fe5020` |
| `actions/setup-python` | `v7.0.0` | `5fda3b95a4ea91299a34e894583c3862153e4b97` |
| `actions/upload-artifact` | `v7.0.1` | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |

Node.js is pinned to major 20 to match the checked-in Dockerfiles. SQLFluff is pinned to the locally observed `4.4.0`. PostgreSQL uses the `16-alpine` major tag; this smoke-only job establishes major-version connectivity, not a full byte-for-byte database image pin or migration compatibility guarantee.

## CI safety boundaries

- Workflow token permission is read-only contents. There are no `secrets.*` references and no cache of build outputs or credentials.
- Jobs run only package tests/builds and SQL lint, plus a disposable local PostgreSQL connection smoke. They do not start the production API or invoke geocoding/AUSEMIO/Nominatim.
- Tests use synthetic identifiers and `.test` email domains. The AUSEMIO adapter remains simulated; tests must not use its production base URL or external transport.
- PostgreSQL uses disposable CI-only credentials, ephemeral storage, and a single `SELECT 1`; no production database or migration file is applied.
- npm audit contacts the package registry for advisory metadata only. It does not mutate dependencies or lockfiles. Its current findings are not treated as a clean security result.
- Artifacts contain test/coverage output, SQL lint text, and npm audit reports only. CI must not upload `.env`, browser state, cookies, user data, or raw public network captures.

## Rollback/removal

Remove the CI workflow with a normal reviewed commit deleting `.github/workflows/ci.yml`; this stops future workflow runs and does not affect application runtime. If branch rules were configured for the generated check contexts, update/remove only those rules through the repository's normal owner/admin review path before deleting their checks. Do not revert or reset remote history, and do not remove unrelated repository rules.

## P2 safe corrections carried with this checkpoint

- Replace phone-like test fixtures with a deliberately non-routable synthetic sentinel (`+421000000000`), never a potentially assigned subscriber number.
- Keep the P0 refresh-session wording explicit: SHA-256 of the full refresh JWT is stored in `token_hash`; JWT `jti` is stored as `admin_refresh_sessions.id`.
- Assert literal multipart field keys in frontend FormData tests instead of deriving all expected keys from `AUSEMIO_FIELDS`.
- Extend the AUSEMIO mock-only matrix to assert that local report result remains `simulated` and is not external acceptance; spell out the public client condition for the traffic-signal field; record the separate local file count/type/size boundaries; and label public-client hints separately from unknown server-side acceptance.

The exact traffic-signal field evidence and file hints are canonicalized in `../ausemio/contract-audit.md`. A public GET of `https://kosice.ausem.io/implementation/all_settings` on 2026-10-03 returned HTTP 200. In that current read-only settings object, `porucha_na_cestnej_svetelnej_signalizacii` is conditioned on `typ_poruchy_css=Q20`; that is client configuration evidence only and does not prove server acceptance. No form submission occurred.

## Local pre-publication validation

The host already had both package `node_modules` directories. Tests/typechecks/builds were invoked through those installed project tools with Node `22.14.0`; the host `npm` shim points to a missing CLI, so this local pass did not execute `npm ci`. A clean remote Actions run is required to verify the lockfile install path on CI Node 20.

- Frontend: Vitest `3.2.7`, 4 test files / 11 tests passed; test-source typecheck passed; coverage generated (11.48% lines, 42.10% branches, 30.13% functions); production build passed. Vite reported a 501.17 kB minified JS chunk above its 500 kB advisory threshold.
- Backend: Vitest `3.2.7`, 4 test files / 11 tests passed; test-source typecheck passed; coverage generated (16.62% lines, 53.33% branches, 32.55% functions); TypeScript production build passed.
- SQLFluff `4.4.0`, explicit repository `.sqlfluff` config, no auto-fix: exit 1 with 112 rule findings across 4 of 5 SQL files (`LT01` 90, `LT05` 9, `CP03` 7, `RF04` 3, `LT02` 2, `RF06` 1). `database/seed.sql` (34,010 bytes) was skipped by SQLFluff's default 20,000-byte large-file limit. Rule findings are informational; no SQL was edited.
- `.github/workflows/ci.yml` parsed with PyYAML 6.0.3 and `git diff --check` reported no whitespace errors. These local checks do not establish GitHub Actions operational validity.
- The checked-in unit tests only exercise local pure/helper behavior with synthetic fixtures; no test calls the AUSEMIO production URL. No production source, runtime dependencies, schema, or migrations were changed.

## Validation and evidence record

Complete this section after workflow execution. Keep generated reports as GitHub Actions artifacts; do not commit generated coverage or audit output.

| Requirement / acceptance criterion | Test/job | Implementation/result | Validation evidence | Independent audit outcome | Thesis-evidence reference |
|---|---|---|---|---|---|
| Frontend typecheck/tests/coverage/build | `frontend` | Local green; GitHub `npm ci`/Node 20 run pending | Local tool output above; Actions run pending | Pending | P7 evidence transfer only |
| Backend typecheck/tests/coverage/build | `backend` | Local green; GitHub `npm ci`/Node 20 run pending | Local tool output above; Actions run pending | Pending | P7 evidence transfer only |
| PostgreSQL 16 connection smoke without migration policy | `backend` | Pending | Pending | Pending | P7 evidence transfer only |
| SQL lint uses repo config without auto-fix | `sqlfluff` | Local run: 112 findings; `seed.sql` skipped by size threshold | Local output summarized above; Actions report pending | Pending | P7 evidence transfer only |
| Dependency advisories retained non-blockingly | `dependency-audit` | Pending | Pending | Pending | P7 evidence transfer only |
| Green success and red failure on isolated branch; required-check enforcement | GitHub Actions + repository rules | Pending | Pending | Pending | P7 evidence transfer only |
| No production/AUSEMIO writes or production behavior change | Workflow/source diff review | Pending | Pending | Pending | P7 evidence transfer only |

## Known limitations and owner decisions

- Existing dependency advisories require separate security triage before any blocking audit policy is selected.
- Existing SQL style findings require a separate policy/cleanup decision; this checkpoint does not auto-fix SQL.
- PostgreSQL smoke does not resolve the P3 migration source-of-truth, migration ordering, import transactions, or failure semantics.
- Branch protection was absent at start. Required check enforcement, if enabled, is limited to the observed frontend/backend check contexts; no PR-review policy or deployment gate is inferred.
- CI being green does not authorize production deployment, AUSEMIO posting, import semantics, or other product decisions.

**Checkpoint status:** in progress; evidence and independent audit outcome pending.
