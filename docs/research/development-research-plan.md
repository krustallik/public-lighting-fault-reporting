# Development & Research Plan

**Purpose:** evidence-driven roadmap for continued development of the Public Lighting Fault Reporting thesis application.
**Scope:** planning and research only. This document does not authorize production changes or production traffic to AUSEMIO.

## 1. Current baseline

### Product state visible in the repository

- The product is a Košice public-lighting map and reporting front end, plus an administrative interface for managing lighting inventory. The project rules explicitly exclude a local authoritative report lifecycle, technician assignment, and repair workflow (`README.md`, `.cursor/rules/project.mdc`).
- The public UI has a map, a multi-step report form, and a result page (`frontend/src/App.tsx`, `frontend/src/pages/MapPage/MapPage.tsx`, `frontend/src/pages/ReportFormPage/ReportFormPage.tsx`, `frontend/src/pages/ResultPage/ResultPage.tsx`).
- The admin UI currently lives in the same Vite application and router as the public UI. It includes dashboard, street-light CRUD, import, settings, and logs pages (`frontend/src/App.tsx`, `frontend/src/pages/Admin*`). This does not yet meet the requested separate-admin-application/build/deployment boundary.
- The Express API serves public light-point, reverse-geocoding, and report endpoints, and protected admin endpoints (`backend/src/index.ts`, `backend/src/routes/`). PostgreSQL stores light-point inventory, admin/session data, import batch metadata, and technical logs (`database/schema.sql`).
- **Report submission is simulated in the current code.** `backend/src/services/aussemio.service.ts::sendReportToExternalSystem` explicitly does not POST to AUSEMIO; it creates a synthetic reference/status and attempts to store a sanitized technical log. `backend/src/services/reports.service.ts::sendFaultReport` returns `status: 'simulated'`. The README introduction says reports are sent to the external system, so that prose overstates the implemented behavior.
- **Accepted AUSEMIO product scope:** the local product supports only service `2` (VO / Verejné osvetlenie). Public AUSEMIO service `16` (CSS / Cestná svetelná signalizácia) is a confirmed external-form option but is **OUT OF PRODUCT SCOPE**; it is not a missing feature or local defect and must not be implemented. P4 may include only a negative guard that the local product does not generate a service-16/CSS payload.
- The frontend constructs an AUSEMIO-shaped multipart body (`frontend/src/utils/buildReportFormData.ts`); backend field names and code values are centralized in `backend/src/config/ausemioMapping.ts` and `backend/src/config/ausemioFormOptions.ts`. These establish the app's current mapping, not the complete current server-side contract of the live form.

### Engineering baseline

- The repository has separate `frontend/` and `backend/` npm projects with their own lockfiles; there is no root npm workspace or root package manifest. Frontend build is `tsc -b && vite build`; backend build is `tsc` (`frontend/package.json`, `backend/package.json`).
- P1a has since added independent Vitest `3.2.7` unit/characterization suites and test scripts under `frontend/` and `backend/`; their tested behavior and limits are recorded canonically in [P1a](checkpoints/p1a-local-test-foundation.md). Current coverage is narrow helper/service behavior; it is not a complete API, PostgreSQL, browser, or E2E suite.
- P1b is complete. GitHub Actions is the owner-selected CI provider, `.github/workflows/ci.yml` is active, and required check contexts `frontend` and `backend` are enabled. The canonical workflow, red/green evidence, and operational limits are in [P1b](checkpoints/p1b-github-actions-ci-activation.md); P1b is no longer pending.
- PostgreSQL initialization uses `database/schema.sql` and `database/seed.sql` in Compose. Runtime migration code reads `backend/src/db/migrations/` and also applies an inline `address_geocoded_at` alteration (`backend/src/db/migrate.ts`). There are also migration copies under `database/migrations/`; their ownership and relationship should be resolved before migration changes.
- SQLFluff `4.4.0` uses `.sqlfluff` without auto-fix. Its recorded baseline has 112 rule findings across 4 of 5 SQL files; `database/seed.sql` (34,010 bytes) is skipped by the default 20,000-byte large-file threshold. npm audit also produced non-blocking advisories for both packages. Counts, reports, and limits are canonical in [P1b](checkpoints/p1b-github-actions-ci-activation.md); neither successful report collection nor CI green means the findings are cleared. The SQLFluff seed-file skip is a P2 follow-up.
- At the start of this planning task, Git reported branch `master` tracking `origin/master` with no pre-existing working-tree changes. `.env` exists but was not read; do not copy its contents into documentation or logs.

### AUSEMIO inspection baseline and evidence labels

The initial P0 GET-only load was limited to the initial service-selection screen. P2b has since inspected both configured public services, all configured field assignments and conditional code branches, relevant public source maps, and their client-side request construction in an anonymous Playwright context. The current evidence and its strict server-side limits are canonical in [the AUSEMIO contract audit](ausemio/contract-audit.md) and [the P2b checkpoint](checkpoints/p2b-ausemio-contract-research.md).

Use these labels in all integration research notes:

- **Confirmed (repo behavior):** visible in this application's source, e.g. locally generated multipart field names and simulated report response.
- **Confirmed (public read-only evidence):** directly observed in public DOM/assets/GET metadata, recording URL, date, browser conditions, and artifact/hash where practical.
- **Inferred:** plausible from client code or repository documentation but not directly verified against current public behavior.
- **Unknown:** unavailable without additional safe evidence. If only a production write can resolve it, mark **OWNER APPROVAL REQUIRED** and stop there.

## 2. Development principles

1. For every significant block use: **research/documentation → acceptance criteria → tests first → implementation → automated verification → documentation update → independent audit**.
2. A reproducible bug fix starts with a regression test that fails for the demonstrated behavior. Never defer the whole test suite until after implementation.
3. Tie claims to source paths, observed tool output, official technical sources, or peer-reviewed literature. Keep repo facts, external evidence, assumptions, and owner decisions visibly separate.
4. Preserve the product boundary unless the owner changes it: the local app is a map/integration layer, not a competing report-lifecycle system. Do not add permanent citizen PII storage as an incidental implementation choice (`.cursor/rules/project.mdc`, `.cursor/rules/security.mdc`).
5. Prefer critical-behavior coverage and meaningful failure cases over a target of 100% line coverage. Report uncovered risks and test limits honestly.
6. Put external systems behind explicit adapters and test them with contract fixtures/mocks. No automatic retry of an external issue submission without explicit user awareness (`.cursor/rules/integration.mdc`).
7. Do not submit to the real AUSEMIO production form, create a real/test issue, send personal data, or bypass validation/anti-bot controls without a separate, explicit owner authorization. Read-only inspection and local method blocking are the default research boundary.
8. Do not decide owner-controlled product behavior (export scope, integration configuration ownership, PostGIS, production host/domain, report acceptance semantics) inside implementation work.
9. Consult the Thesis Writing agent before a decision when academic rationale depends on literature, standards, or official technical evidence; this applies at the relevant research checkpoint, not only at thesis write-up. Transfer only verified findings and post-audit implementation results into thesis material. Do not put unverified claims directly into LaTeX.

## 3. Proposed documentation structure

Keep this compact; make one draft per significant change or closely related checkpoint. Avoid duplicating decision/evidence records: other documents link to the canonical source below.

```text
docs/
  research/
    development-research-plan.md       # this roadmap and dependencies
    decisions/                          # ADRs: canonical accepted architecture/product decisions
    checkpoints/                        # canonical execution/evidence/tests/results/audit per block
    ausemio/                            # contract-audit.md: canonical external contract evidence
    security-privacy/                   # canonical security/legal research evidence
    thesis-evidence/index.md            # links + short verified summaries only
```

Canonical ownership: an **ADR** is the source of truth for an accepted architecture/product decision; a **checkpoint note** is the source of truth for execution, evidence, tests, results, and audit for that checkpoint; the **AUSEMIO contract note** is the source of truth for external contract evidence; a **security/privacy note** is the source of truth for security/legal research evidence; the **thesis-evidence index** contains only links and short verified summaries, not duplicated detail. Other documents link to the applicable canonical source instead of copying its facts.

Each checkpoint draft should contain: problem/context; current factual state; research questions; evidence and source/date; confirmed/inferred/unknown labels; alternatives; accepted decision and canonical ADR link (if any); owner decision (if any); acceptance criteria; tests to write first; implementation notes; actual validation/results; limitations and open questions; independent-audit outcome; thesis-evidence link. Include an explicit traceability table with one row per requirement/acceptance criterion:

| Requirement / acceptance criterion | Test(s) | Implementation / result | Validation evidence | Independent audit outcome | Thesis-evidence reference |
|---|---|---|---|---|---|

Do not create empty folders/files in advance unless a checkpoint starts.

## 4. Phased Development & Research Plan

Dependencies are sequential where contracts or choices gate behavior; independent research can run in parallel:

```text
P0 factual baseline ─┬─ P1a local test foundation ─┬─ P1b CI activation ── behavior-changing implementation
                    ├─ P2 AUSEMIO read-only audit ── P4 report adapter ─┐
                    └─ P5 admin separation research ── P6 admin app ────┼─ P7 release readiness + thesis evidence
P3 DB/import-export (import behavior gated by owner decisions) ──────────┘
P7 + owner/infra decisions ── P8 future CD (not current implementation)
```

### P0 — Baseline and decision records (research only)

- **Goal/prerequisites:** Establish a shared, source-backed picture before any behavior change; no prerequisites.
- **Research/evidence:** Map routes, services, schema, runtime configuration, current simulated report behavior, duplicate migration locations, and the historical test/CI baseline. Do not treat README claims as proof when code differs.
- **Artifact:** checkpoint note with facts, uncertainties, baseline commands/results, and owner-decision register.
- **Tests first / implementation:** no production implementation. Specify initial characterization tests and test-tool decision criteria.
- **Validation/audit:** verify each claim against source or label it supplied/unverified; independent reviewer checks the inventory against the repo.
- **Exit / thesis:** baseline and scope are accepted; thesis may cite only verified descriptions of current implementation, not planned capability.

### P1a — Local test foundation

- **Status:** COMPLETE. Local Vitest suites and test scripts are in place; see the canonical [P1a checkpoint](checkpoints/p1a-local-test-foundation.md) for test inventory and validation evidence.
- **Goal/prerequisites:** Make local test-first work reproducible using P0. This may proceed independently of CI-provider selection.
- **Research/evidence:** Compare test runner and API/browser tooling compatible with the existing TypeScript/npm lockfiles. Candidate categories include a TS unit runner, HTTP/API test client, PostgreSQL integration harness, and browser automation; choose only after recording rationale. Inspect supported PostgreSQL version and clean-install assumptions. Consult Thesis Writing agent before test-methodology decisions only if the thesis rationale needs academic/standards support.
- **Artifact:** local test architecture ADR (if it records an accepted decision), checkpoint note, and first critical-flow test plan.
- **Tests first / implementation:** first add executable unit/characterization tests for existing pure helpers (report field builder/validators, Slovak phone normalization, import row sorting/parsing, CSV escaping/mapping as selected). This checkpoint adds test infrastructure/specifications only, not behavior-changing production code.
- **Validation:** clean install from each lockfile; typecheck/build; run the selected local tests; record SQL lint and disposable PostgreSQL harness readiness where available.
- **Independent audit:** review test isolation, deterministic fixtures, and whether DB tests use disposable data/services.
- **Exit / thesis:** local test foundation is reproducible; document actual results and avoid speed/quality claims without measurements.

### P1b — CI activation (mandatory gate)

- **Status:** COMPLETE. P1a and P1b are finished; GitHub Actions was selected for the repository and the required `frontend` and `backend` checks are active. The exact decision, workflow, and validation evidence are canonical in [P1b](checkpoints/p1b-github-actions-ci-activation.md).
- **Goal/prerequisites:** Activate required automated checks after P1a. The provider decision is resolved for this repository; provider choice is not pending.
- **Research/evidence:** use the live repository hosting/settings as evidence and record provider-specific implementation and red/green validation in the P1b checkpoint. Do not treat informational SQLFluff/npm-audit jobs as required checks or as evidence that their reported findings are clean.
- **Artifact:** active CI workflow and canonical P1b checkpoint note with the provider decision, required status checks, and validation evidence; create an ADR only if a separate architecture decision is recorded.
- **Tests first / implementation:** configure clean installs, typecheck/build, unit/API/service tests, SQL lint, disposable PostgreSQL integration/migrations, dependency/security checks, and critical E2E as stable; store reports. This is CI tooling/configuration only, not application behavior.
- **Validation:** demonstrate required checks green on a valid change and red when a required check is deliberately made to fail in a safe CI-only fixture/check. Verify artifacts, permissions, and disposable services.
- **Independent audit:** inspect workflow permissions, secret handling, caches, branch/status-check enforcement, and DB disposal.
- **Exit / thesis:** CI provider is settled, CI actually runs, and mandatory checks have demonstrated red-on-failure and green-on-success. **No significant behavior-changing implementation may begin after P1a until this exit criterion is met.** Research and behavior-independent test work may continue.

### P2 — AUSEMIO public-form contract audit (read-only; integration gate)

- **Goal/prerequisites:** Verify the complete public-client contract before designing any real adapter; P0. Production submission is not needed or authorized.
- **Research/evidence:** Follow §8. P2b inspected all service options advertised by the public form, the ordered field assignments and their conditions/options, the VO and CSS branches, relevant client source maps, and client request/response construction. Preserve CSS as public-form evidence, but classify service `16` as **CONFIRMED PUBLIC CLIENT / OUT OF PRODUCT SCOPE**, not a local mismatch or defect. Do not promote public-client metadata to a server-contract claim.
- **Artifact:** `docs/research/ausemio/contract-audit.md` is canonical for external client-contract evidence. The sanitized normalized field catalog is linked from it; the P2b checkpoint is canonical for capture execution, safety counts, and evidence provenance. Neither artifact contains cookies, tokens, session IDs, real PII, or raw sensitive headers.
- **P2b scope/status:** P2b's exhaustive public-client research was independently audited and is **CLOSED**; PR #3 is merged. Preserve CSS only as external-form evidence; P4 coverage is service `2` plus a negative guard against generating service `16`. The VO code-to-label crosswalk is retained as historical local/public comparison evidence; the accepted P4a owner decision makes confirmed public VO values canonical, so tests use those values directly without legacy translation. Include exact file hints, locale behavior, code differences, source-map hashes, and the distinction between client construction and server acceptance.
- **Thesis research:** if smart-city, citizen-reporting, or integration literature is needed to justify a thesis claim or design decision, consult Thesis Writing agent before that decision and record source evidence in the canonical research note.
- **Tests first / implementation:** no production integration code. Create mock-only contract fixtures and a proposed mapping test matrix after field evidence is sufficiently grounded.
- **Validation:** independent reviewer checks that evidence is reproducible and that no unsafe method escaped interception. If a detail requires production submit, record **OWNER APPROVAL REQUIRED**; do not attempt it.
- **Exit / thesis:** external contract fields and safe-to-test boundary are documented; unresolved production-only behavior blocks real integration. Thesis notes cite public/official evidence only, not speculation.

### P2c — Mobile-first reporting, location, geocoding and privacy

- **Canonical implementation plan and result checkpoint:** [P2c final location activation implementation plan](checkpoints/p2c-location-activation-implementation-plan.md) records the independently audited implementation scope; [P2c implementation checkpoint](checkpoints/p2c-location-activation-implementation.md) records owner corrections and current validation. The earlier plan described Geoapify reverse lookup plus text autocomplete; later owner manual QA superseded autocomplete. Current address enrichment is one submit-time reverse lookup only for validated custom/device targets; `detailDescription` remains editable free text.
- **Accepted owner directions:** D1–D11 remain recorded in the final plan, except autocomplete direction A is superseded by the later owner manual-QA decision to remove typed address autocomplete. The municipal administrative territory is the product boundary by owner definition and is not asserted to equal lighting-operator responsibility. Service 2 / VO only remains in scope; service 16 / CSS remains out of scope.
- **Evidence sources:** [P2c location-activation research](checkpoints/p2c-location-activation-research.md) preserves dated provider/geography evidence; [P2c security/privacy evidence](security-privacy/p2c-geolocation-privacy-evidence.md) is canonical for privacy/legal research. The final plan records verified ZBGIS input hashes and the numeric Košice district selection used to form the municipal polygon.
- **External activation gates remain:** actual CARTO/Geoapify account and key terms, qualified legal/privacy approval and notice, deployment hostname/TLS/proxy/APM/log facts, and explicit owner authorization. Provider flags remain off until these close. No live provider or AUSEMIO traffic is authorized by planning.
- **No persistence in this scope:** duplicate-history reporting window, event semantics, deletion/retention and migration-source questions stay separate and unresolved; no P2c schema or migration is planned.
- **Status:** the final implementation plan was independently re-audited PASS WITH P2 (P0=0, P1=0); the known test-matrix wording correction is recorded in the plan. The automatic-address-enrichment/recenter delta was independently audited from `c7417fec1398203c16867b1f2169dda10a822d5b` to `07f2660f2088e3e482bd2c50a609a359088eef27`: PASS WITH P2, P0=0, P1=0, with audited-head CI run `37596168546` successful. The two non-blocking findings—provider control-character normalization and stale audit-status wording—are addressed in the targeted correction and canonical checkpoint. Correction commit `42b9c627881d84f46b3da7c9a72ff0d3f7dbccbd` passed exact-head CI run `37611585920`; any later PR head must also pass required exact-head CI before merge. Live provider activation remains disabled and unauthorized pending the separate external gates below.
### P3 — PostgreSQL, migrations, import/export and consistency

- **Accepted decisions:** the canonical [P3 implementation plan](checkpoints/p3-postgres-import-export-implementation-plan.md) fixes PostGIS, CSV/JSON/GeoJSON exports, inventory identity, partial-success imports, duplicate handling, retry/idempotency, sequential queueing, and audit semantics. These P3 owner-decision gates are closed; implementation must follow the plan rather than reopen them.
- **Implementation state:** PR #20 is open and unmerged on `feature/p3-postgis-import-persistence`, based on `d72e928487884cd758677d07b4222e979bf479b3`. Independent result audit of historical head `f94d7f3758c7245f34e6e46e91df429aa52ae587` returned FAIL (P0=0, P1=5, P2=6); the five targeted P1 corrections are implemented. Current corrected-head CI evidence is in the [P3 implementation checkpoint](checkpoints/p3-implementation.md) and final handoff; targeted independent re-audit is pending.
- **Evidence and limits:** disposable PostgreSQL/PostGIS migration, persistence, queue-restart, export, adoption recovery, and encoding tests are present. The checkpoint records current local test results, seed and compiled-migration smoke evidence, historical dependency-audit counts/SQLFluff findings, and the Windows-only service-area hash mismatch. No P2 is claimed closed; the Ubuntu resource-profile gap, unbounded individual row size, Windows portability, dependency findings, and SQLFluff findings remain non-blocking. The local 100,000-row run is an observation on an unbounded Windows host/container, not validation of the target Ubuntu 2-vCPU/4-GB profile or a performance SLA.
- **Thesis/research:** consult the Thesis Writing agent before any future academic rationale about database integrity or transactions; thesis evidence may describe only verified implementation/test results. No thesis was changed in P3.
- **Independent audit / exit:** the prior implementation result audit found five P1 and six P2 findings. Targeted P1 corrections have been implemented; do not merge until corrected-head required CI is green and an independent targeted result re-audit passes.

### P4 — Public reporting flow and AUSEMIO adapter

- **Goal/prerequisites:** Make the service-`2` VO reporting result truthful and its integration behavior testable; service `16` CSS remains **OUT OF PRODUCT SCOPE** and is not implemented. P4 requires P1a, P1b exit, P2 client evidence, and service-`2` acceptance criteria. The accepted P4a owner decision makes confirmed public VO codes, labels, semantics, and conditions canonical; obsolete local mappings are replaced directly with no backward remapping, historical migration, schema migration, `mappingVersion`, or compatibility layer. The owner-provided pre-production/history state and repository evidence are distinguished in the [canonical P4a plan](checkpoints/p4a-vo-form-local-test-plan.md). Any unresolved server contract gap blocks live integration. If P4 changes persistence, integration logging, retention, or DB schema, the corresponding P3 work must be completed first; otherwise P4 must not change those persistence/logging semantics.
- **Research/evidence:** For VO only, compare form validation with backend validation; confirm location override from selected inventory point, coordinate note semantics, file size/count/type restrictions, locale/code mappings, and response/error meanings. Keep public CSS evidence in the contract audit as external-form research, not as a local mismatch/defect. Clarify owner-approved behavior for simulated vs accepted reports. Research whether the system can identify a prior submission for the same light point/location, show the user that it was previously sent, and provide an additional operator note. “Previously sent” must not be presented as “still open.” Duplicate matching, time window, category matching, and repeat-submit behavior are OWNER DECISIONS. Any event persistence/logging needed for this feature is gated by P3 and the P4↔P3 rule above.
- **P4a canonical implementation plan:** [VO form parity + local test submission endpoint](checkpoints/p4a-vo-form-local-test-plan.md). Planning is **CLOSED**. Implementation passed independent targeted re-audit (PASS WITH P2; P0=0, P1=0), merged as PR #5, and is **CLOSED**. Post-merge master CI run `37228183483` passed `frontend` and `backend`. Remaining P2 follow-ups are non-blocking and listed in the [canonical P4a implementation checkpoint](checkpoints/p4a-implementation.md), which records audit, merge, and validation evidence. The plan links to the canonical AUSEMIO contract audit and public field catalog instead of duplicating their evidence.
- **Artifact:** report-flow checkpoint note, API contract, field mapping table, failure matrix, and privacy data-flow record.
- **Tests first / implementation:** write synthetic service-`2` tests with a fake AUSEMIO adapter using literal public VO values directly: field keys, conditions/codes, locality, phone/email/consent known/unknown state, file client boundaries, response parsing, timeouts, non-success responses, no retries, and no PII persistence/logging. Do not assert a legacy cross-code translation or backward mapping. Include a negative guard that the product emits service `2` and never generates a service-`16`/CSS payload. Do not add CSS implementation or CSS contract tests beyond that negative guard. Then implement only the approved VO adapter boundary; production transport remains disabled until separate explicit owner permission where required.
- **Validation:** API integration with a local stub; verify the application reports “simulated” when simulated and does not claim external acceptance; verify error/result flows and no external POST in ordinary tests.
- **Independent audit:** inspect actual outbound-request guard, retry policy, privacy boundary, and contract evidence against implementation.
- **Exit / thesis:** mock contract suite is stable; any production enablement is a separate approved checkpoint. If smart-city/reporting/integration literature is used as thesis rationale, consult Thesis Writing agent before the design decision and record sources in the canonical research note. Thesis can report simulated/mock results as such, never as live integration results.

### P5 — Admin separation architecture research

- **Goal/prerequisites:** Design a genuinely separate admin application and build/deployment boundary; P0. The accepted hard requirement is an independent admin application, its own build artifact, a separate deployment boundary, and the admin origin/subdomain `admin.<domain>`. The concrete base domain/hosting remain owner decisions; architecture and acceptance criteria must assume this separate origin from the outset. Do not assume a target folder layout.
- **Research/evidence:** Compare monorepo separate app package/build, separate repository, and shared-package alternatives against existing frontend/API coupling. Model public/admin/API origins, cookie scope, refresh flow, CORS, CSRF, deployment, shared types/UI, versioning, and local developer workflow. Identify who owns DNS/TLS/hosting.
- **Artifact:** ADR with at least two viable alternatives and consequences; threat/data-flow diagram; proposed build and release boundaries. Consult Thesis Writing agent before decisions whose thesis rationale relies on security, privacy, accessibility, or architecture standards/literature.
- **Tests first / implementation:** write auth boundary acceptance tests before moving code: anonymous admin API denied, refresh/rotation/logout behavior, allowed origin only, unsafe cross-site requests rejected, public UI cannot gain admin privilege, and independent builds. No route relocation before ADR/owner decisions.
- **Validation:** prototype only after approval of structure, host/domain, and cookie/API topology; browser tests run on local/test domains and never against live admin accounts.
- **Independent audit:** review separation at build/deployment and API enforcement—not just route/UI separation.
- **Exit / thesis:** acceptance requires an independent admin application, its own build artifact, a separate deployment boundary, and a distinct `admin.<domain>` subdomain/origin; documented auth/session/CSRF/CORS design passes tests. Thesis uses architecture diagram and test evidence after audit.

### P6 — Admin behavior, security/privacy/accessibility and operations

- **Goal/prerequisites:** Validate CRUD, import/export, activity/integration logs, geocoding, configuration, and admin security against agreed semantics; P1, P3, P5 as relevant.
- **Research/evidence:** Role model (currently only active/inactive admin is visible), account provisioning, settings source of truth, upload constraints, auditability, retention/minimization, accessibility needs, and operational configuration. Check current behavior in `adminStreetLights.service.ts`, `streetLightsImport.service.ts`, `streetLightsExport.service.ts`, `adminActivity.service.ts`, `auth.service.ts`, and `geocoding.service.ts`.
- **Artifact:** threat model/security review, admin acceptance matrix, accessibility checklist based on chosen authoritative standard, privacy/data inventory, operations/configuration guide. Consult Thesis Writing agent before decisions relying on security/privacy/accessibility standards or literature; keep legal conclusions tied to official evidence.
- **Tests first / implementation:** tests before approved changes for role/API access, CSRF/CORS, login rate-limit, cookie flags, file validation, import/export errors/partial failures, log redaction, geocoder timeout/rate/cache behavior, and keyboard/screen-reader critical paths.
- **Validation:** API/DB/browser tests with synthetic inventory/admin identities; dependency/security scan reports attached, findings triaged without silently changing scope.
- **Independent audit:** separate reviewer checks security boundaries, accessibility findings, and traceability from requirements to tests.
- **Exit / thesis:** agreed critical requirements have evidence and open risks are explicit; legal compliance claims wait for official-source research.

### P7 — Release readiness and thesis evidence transfer

- **Goal/prerequisites:** Complete release-readiness review and transfer already verified evidence into the thesis; P1–P6 as applicable. CD is a separate P8 future phase and is not implemented here.
- **Research/evidence:** consolidate completed checkpoint results, limitations, independent audits, and evidence references. Do not add new unverified claims or duplicate canonical evidence.
- **Artifact:** release-readiness checklist, independent audit record, and thesis-evidence index containing links/short verified summaries only.
- **Tests first / implementation:** no CD implementation. Re-run the required CI suite and verify release evidence artifacts; update thesis material only from verified evidence.
- **Validation:** trace thesis statements to canonical research/checkpoint sources and actual validation results.
- **Independent audit:** reviewer checks traceability, limitations, and consistency between implementation, reports, and thesis claims.
- **Exit / thesis:** only already verified evidence is transferred into thesis material; earlier phases perform any necessary literature/standards consultation before decisions.

### P8 — Future CD (separate phase; not current implementation)

- **Goal/prerequisites:** Design/implement CD only in a separately authorized future phase. Prerequisites are owner/infra decisions for hosting, base domain and `admin.<domain>`, TLS, secret management, DB provisioning, backups/restore ownership, migration strategy, rollback/roll-forward, monitoring/health checks, and incident ownership; P7 release readiness and a green P1b CI gate are also required.
- **Research/evidence:** document target topology and deployment/recovery procedures from approved infrastructure facts.
- **Artifact:** future CD ADR and deployment/recovery runbook.
- **Tests first / implementation:** test deployment, migrations, backup/restore, and rollback in disposable/non-production environments before enabling any production automation.
- **Validation:** verify deployment and recovery checks against owner-approved non-production infrastructure.
- **Independent audit:** review permissions, secrets, migration safety, rollback path, monitoring, and approval gates.
- **Exit / thesis:** no CD work starts until prerequisites are met and separately authorized; this roadmap does not implement CD or production deployment.

## 5. Testing strategy

P1a established Vitest suites in both npm packages and P1b runs them in GitHub Actions. Current tests cover selected helpers/mapping/import parsing and CSV export; the following broader layers remain target coverage, not a claim that they already exist. See the P1a/P1b checkpoint notes for canonical test inventories and observed results.

| Layer | Primary targets | Evidence/critical cases |
|---|---|---|
| Unit | Pure validators/mappers/helpers | phone normalization; report fields; AUSEMIO code mapping; coordinate and import row validation; CSV escaping; locale/detail helpers |
| Backend service | Services with external and persistence seams mocked | report validation/result semantics; inventory CRUD; import preview/confirm; export serialization; geocoder cache/fallback/rate-limit; auth token rotation |
| API integration | Express routes/controllers/middleware | response envelopes/statuses; validation errors; upload limits; login throttling; cookie/session lifecycle; public vs protected endpoints; no citizen PII in technical logs |
| PostgreSQL integration | Real disposable PostgreSQL/PostGIS matching supported major version | P3 now has fresh/replay/adoption/checksum/lock tests, direct identity constraints, geometry/bbox, atomic CRUD/import audit, duplicate/update semantics, idempotent confirmation, real worker crash/restart and FIFO, and streaming/export resource tests; see the [P3 implementation checkpoint](checkpoints/p3-implementation.md) for current evidence and the Windows service-area limitation |
| Frontend/component | Forms, route guards, data/error states | two-step report validation; locale; admin refresh/logout redirect; import preview confirmation and failure presentation; keyboard/accessibility behavior |
| Browser/E2E | Critical user journeys against local API/test DB | map → report → simulated result; admin login → CRUD → import preview/confirm → export → logout; no real AUSEMIO traffic |
| Regression/security | Every reproduced bug and security boundary | add failing regression first; CSRF/CORS/cookies, upload abuse, malformed imports, error-path redaction, external calls constrained to mock |

Coverage priority: auth/session; report validation and mapping; import/export; DB invariants and migrations; failure and retry semantics; personal-data boundaries. Choose tools via P1 ADR. Avoid coverage thresholds until baseline and critical paths are understood; if a threshold is later adopted, justify it and distinguish line coverage from behavior coverage.

## 6. CI → future CD strategy

**CI is an active required development gate.** GitHub Actions is the owner-selected provider. `.github/workflows/ci.yml` runs on PRs to `master` and pushes to `master`; branch protection requires `frontend` and `backend`. SQLFluff and dependency-audit reports are informational. Current workflow scope and its demonstrated red/green behavior are canonical in the P1b checkpoint. Future stages may add API/service, disposable PostgreSQL/migration, and browser coverage after their own design decisions; CI green is not evidence of untested layers.

After local test foundation P1a, no significant behavior-changing implementation begins until P1b has an evidenced provider decision, CI actually runs, and mandatory checks demonstrate both red-on-failure and green-on-success. This gate does not block research or behavior-independent test foundation work.

Do not implement CD now. A future CD checkpoint is blocked on owner decisions for production host/domains, TLS, secret storage, database provisioning/backups, migration execution and rollback/roll-forward, deployment health checks, monitoring, and incident ownership. CI green is not production approval.

## 7. Security/privacy/compliance research track

Maintain separate engineering and legal-evidence columns. Build a threat model for citizen submission, admin session/API, inventory imports/exports, logs, file uploads, geocoding, AUSEMIO, and deployment. Review cookies/session rotation, CSRF/CORS, login throttling, authorization, upload content/size, secrets/config defaults, citizen contact/content and precise location in memory/responses/logs, rate limits, dependency vulnerabilities, retention, data minimization, backups, accessibility, and incident handling. Treat the research-only candidate event in P2c as a question, not a schema decision. Its minimality, identifiability in context, purpose, legal basis, notice, access, and deletion/retention period all require evidence and owner review.

For privacy/accessibility/legal obligations, consult current primary/official material during the relevant checkpoint (e.g. EUR-Lex, EDPB, Slovak competent authorities including Slov-Lex, and authoritative accessibility standards); record title, issuing body, version/date, applicable passage, jurisdiction, and interpretation limits. Re-check amendments effective on the research date; the current Slov-Lex entry for Act 18/2018 Z. z. must be read in its then-current effective version, not an old translated copy alone. Consult the Thesis Writing agent before decisions when academic rationale depends on peer-reviewed literature or standards. This plan states no legal conclusion; applicability and exact obligations are **не визначено з репозиторію** and must not be inferred from code or `.cursor/rules/`.

Treat supplied audit counts as findings to reproduce and triage: retain raw reports and dependency lockfile context, then classify reachability/impact before deciding changes. The Codex Security scan has no final report in the supplied baseline; do not describe it as clean or as having findings.

## 8. AUSEMIO research/integration track

### Safe contract audit protocol

1. Use a new anonymous browser context and the official public URL `https://kosice.ausem.io/#/public/issues/new`; do not import cookies, tokens, or form data from any owner/user session.
2. Inspect DOM, static/public client bundles, public source maps where available, and GET response/network metadata only. Do not submit the form or use real personal data.
3. Install request interception before page scripts execute. Permit only GET/HEAD to reach the network; abort every other method before transmission. Also neutralize `HTMLFormElement.submit/requestSubmit`, `fetch`, XHR, beacon, service-worker paths, and write-capable navigation locally. Verify the capture log contains zero non-GET/HEAD requests. If the instrumentation cannot guarantee this, stop inspection.
4. Record the form's route/API endpoint, client-constructed method/content type, exact field keys and enumerated codes, file field/count/type/size hints, headers/CSRF material, client-side requiredness/validation, locale behavior, and client parsing of success/error responses. Distinguish code evidence from what the server would accept.
5. For each new capture, retain a sanitized verification script and request ledger with URL/origins, methods/status summary, UTC/local timestamp, tool/browser versions, public asset identifiers/hashes, and an assertion that zero non-GET/HEAD requests reached the network. Exclude cookies, tokens, session IDs, real PII, and sensitive raw headers. Existing P2 capture evidence is partially reproducible: raw settings/source-map bodies and the original request ledger were not retained. Do not reconstruct them retroactively.
6. Do not probe validation by sending malformed requests. Infer only what public client code establishes; server response contract and production acceptance remain unknown without a safe official test endpoint or explicitly approved test.
7. Keep a table `question | evidence | label | source/date | confidence/limitation | next safe step`. Use synthetic values in mock fixtures. Do not store personal data or session secrets.

The repo currently encodes multipart keys in `frontend/src/config/ausemioForm.ts` and `backend/src/config/ausemioMapping.ts`; report field validation is in `backend/src/services/reports.service.ts::validateAusemioFields`. `backend/src/services/aussemio.service.ts` currently simulates. Repo rules in `.cursor/rules/integration.mdc` are project instructions, not independent proof of the live contract. The P2b public-client matrix and capture limits are in `docs/research/ausemio/contract-audit.md`; no client-side source or public GET establishes server validation, actual request acceptance, or real response semantics.

**Owner gate:** if exact live server behavior can only be established by a production write, stop and record **OWNER APPROVAL REQUIRED**. Any later permission must be separate, explicit, scoped (endpoint, synthetic data, test/prod, date/window, expected side effect, rollback/contact). No approval is presumed by this plan. Until then, only mocked adapter contract tests and simulated behavior are allowed.

## 9. Admin-app separation track

The current router `frontend/src/App.tsx` serves both public and admin screens; `frontend/src/services/adminApi.ts` and `backend/src/routes/admin.routes.ts` form the current API boundary. The hard requirement is an independent admin application, its own build artifact, a separate deployment boundary, and a distinct admin origin/subdomain `admin.<domain>`. A hidden path or UI-only guard does not satisfy this requirement. The concrete base domain and hosting can remain future owner decisions, but the architecture starts from a separate admin origin.

P5 must compare (without preselecting) a same-repository second app/package, a separately versioned/deployed app, and an extracted shared package for contracts/UI utilities. Record build ownership, release coupling, local dev, code sharing, API compatibility, and rollback impact. Before implementation, decide origins: public app, admin app, and API; whether API is shared; cookie host-only vs wider scope; same-site/cross-origin properties; exact credentialed CORS allowlist; CSRF defense for unsafe methods; login/refresh/logout and rotation; TLS; and how environment config is delivered.

The existing cookies are `httpOnly`, path `/`, `SameSite=Lax`, and `Secure` only when `NODE_ENV=production` (`backend/src/utils/cookies.ts`, `backend/src/config/auth.ts`); current CORS is one configured origin with credentials (`backend/src/index.ts`). These are current settings, not proof that a future subdomain topology is safe. The API's `requireAdmin` remains the authorization boundary; `AdminProtectedRoute` is only a client-side navigation guard. Test independent build/deployment and server enforcement, not just route movement.

## 10. Owner decisions required

Do not resolve these in implementation without the owner:

1. Integration settings source of truth: deployment environment/secrets manager vs persisted admin-editable settings; which values can be changed by whom and whether an API key is actually required.
2. Production deployment target/base domain, public/API domains, TLS/DNS, CI secret/permission ownership, secret manager, database hosting/backup owner, and migration/rollback responsibility. The CI provider is GitHub Actions; the separate admin app and `admin.<domain>` origin are already accepted requirements. The concrete base domain/hosting and other production infrastructure implementation remain undecided.
3. Report semantics: when UI may say “submitted/accepted”; whether a safe AUSEMIO test/staging endpoint exists; production-send permission owner and scope. Until settled, keep “simulated” truthful.
4. Admin account/permission model: single admin class vs roles, password reset/provisioning, session revocation semantics, and whether additional operators are in thesis scope.
5. P2c accepted directions D1–D11 are in the canonical [final implementation plan](checkpoints/p2c-location-activation-implementation-plan.md), with typed autocomplete direction A superseded by later owner manual QA; the implementation state and evidence are tracked in the [implementation checkpoint](checkpoints/p2c-location-activation-implementation.md). External provider/account, qualified legal/privacy, deployment proxy/APM and live-activation gates remain; all provider flags stay off until closed. Service 2 / VO only remains in scope; service 16 / CSS remains out of scope. Duplicate-history semantics/retention/migration remain a separate future gate and are not part of P3 inventory/import persistence.
6. P2c duplicate history is limited to known light points and excludes contact, free text, attachments, precise coordinates and arbitrary points. O10 remains open for accepted event-state semantics, category/block display, rolling period, retention/deletion/access. A “reported” event is not an “open” or unresolved fault. See the canonical P2c plan for the proposed whitelist and transaction outline.

## 11. Risks/dependencies

- **AUSEMIO contract drift:** repo mappings and project rules can be stale. P2 gates P4; without a safe non-production contract, live acceptance/response behavior remains unknown and production integration remains blocked.
- **Report truthfulness:** README describes external sending while implementation simulates it. This should be reconciled in a documentation checkpoint and acceptance criteria before any user-facing live-send work.
- **Test scope gap:** local Vitest and required GitHub Actions checks are active, but current suites are narrow helper/characterization coverage; API, DB/migration, browser/E2E, and broader privacy/integration paths remain unverified. Keep significant behavior changes behind the applicable research, decision, and test gates.
- **P3 migration and import state:** the P3 implementation replaces the competing runtime migration paths with the checksummed `backend/src/db/migrations/` chain and persists import preview/job state in PostgreSQL. Review the [P3 implementation checkpoint](checkpoints/p3-implementation.md); do not treat a local developer DB volume as verified or bypass its read-only recognized-schema preflight. PR #20 remains unmerged; its historical audited snapshot failed result audit and the targeted P1 correction awaits independent re-audit.
- **Admin deployment boundary:** separate app is a hard requirement, but domain/hosting/API topology is unknown. Cookie/CORS/CSRF decisions and ownership precede P5 implementation.
- **Security backlog uncertainty:** supplied npm audit counts and SQLFluff findings were not reproduced here; the deep security scan has no final report. Preserve reports and re-run in a controlled checkpoint before prioritization.
- **Possible stale paths:** `frontend/src/services/geocodingApi.ts::reverseGeocodeForLightPoint` calls `/light-points/:id/address`, while the inspected public router exposes only `GET /` and `GET /:id` (`backend/src/routes/lightPoints.routes.ts`). Search for consumers and verify intended contract before deciding whether this is live, stale, or dead code. Older admin artifacts (`frontend/src/pages/AdminLightPointsPage/`, `backend/src/controllers/admin.controller.ts`, `backend/src/services/admin.service.ts`) are not wired by the current `App.tsx`/`backend/src/routes/admin.routes.ts`; confirm before removing anything.
- **Geocoder coordination:** the default public Nominatim policy limits the aggregate application traffic, while current cache/rate state is in-process; a multi-instance deployment could exceed policy without shared server-side coordination. Re-check policy/provider and design this before increasing or distributing geocoder traffic.
- **External policy/legal uncertainty:** AUSEMIO contract drift, privacy law/retention, and accessibility still require current primary/official evidence. The Nominatim public-server policy was checked on 2026-10-03 and is documented in P2c; it may change. This roadmap makes no legal-compliance claim.

## 12. Recommended first implementation checkpoint

### Before implementation

P0, P1a, and P1b are complete; use their canonical checkpoint notes rather than repeating their evidence. P2b was independently audited, merged in PR #3, and is **CLOSED**; no P2b audit feedback remains pending. P3 owner decisions are fixed in the accepted plan. PR #20 on `feature/p3-postgis-import-persistence` is open and unmerged; its historical implementation head failed independent result audit (P0=0, P1=5, P2=6), and targeted P1 correction validation/re-audit remains outstanding. P2c external provider/account, qualified legal/privacy, deployment proxy/APM and live-activation gates remain separate and open. Do not fix the informational SQLFluff/npm-audit baseline as part of P3. Significant future behavior changes still require their relevant owner decisions, test-first acceptance criteria, and active CI gate.

### First implementation block: P1a local test foundation

This is a historical P1a instruction; P1a and P1b are complete. P2c has one consolidated implementation plan at `docs/research/checkpoints/p2c-location-activation-implementation-plan.md`; its final targeted independent plan re-audit was PASS WITH P2 (P0=0, P1=0). The implementation evidence is in `docs/research/checkpoints/p2c-location-activation-implementation.md` and PR #18 (`feature/p2c-location-activation-implementation`). Its automatic-address-enrichment/recenter delta was independently audited from `c7417fec1398203c16867b1f2169dda10a822d5b` to `07f2660f2088e3e482bd2c50a609a359088eef27`: PASS WITH P2, P0=0, P1=0. The audited head passed exact-head CI run `37596168546`. The two non-blocking findings concerned provider control-character normalization and stale audit-status wording; the targeted correction normalizes/rejects such provider text and records the completed audit in the canonical checkpoint and this roadmap. Correction commit `42b9c627881d84f46b3da7c9a72ff0d3f7dbccbd` passed exact-head CI run `37611585920`. Earlier P1 packaging remediation and owner manual-QA findings remain historical evidence in the checkpoint. External provider/account, qualified legal/privacy, deployment proxy/APM, and production activation gates remain separate and open; no live provider activation is authorized. P3 owner decisions are closed; its unmerged implementation and validation evidence are tracked in [the P3 checkpoint](checkpoints/p3-implementation.md). Do not implement live AUSEMIO posting from public-client evidence alone.

Thesis Writing agent consultation happens before decisions where literature/standards are needed; P7 only transfers already verified evidence into the thesis. No user-study, legal, performance, coverage, or reliability result is claimed by this plan.

---

**P2c status:** The separate location-activation research checkpoint remains independently audited **PASS WITH P2** (P0=0, P1=0); its three non-blocking documentation clarifications were incorporated in PR #16. The consolidated implementation plan was independently re-audited **PASS WITH P2** (P0=0, P1=0). PR #18's automatic-address-enrichment/recenter delta and targeted correction passed their recorded independent audits and exact-head CI runs `37596168546` and `37611585920`. External provider/account, qualified legal/privacy, deployment, and explicit production-activation gates remain open. Live provider integrations remain disabled, and no AUSEMIO access/write occurred.

**P3 status:** Accepted owner decisions are implemented on `feature/p3-postgis-import-persistence` from base `d72e928487884cd758677d07b4222e979bf479b3`. PR #20 remains open and unmerged. Its historical implementation snapshot failed independent result audit (P0=0, P1=5, P2=6); the five targeted P1 corrections are implemented, with exact corrected-head validation and independent re-audit to follow. The canonical checkpoint records local evidence and remaining non-blocking P2 limitations. No P3 owner decision is represented as unresolved.

P2C AUDIT STATUS ALIGNED — PASS WITH P2 (P0=0, P1=0); CORRECTION HEAD CI 37611585920 PASSED
