# P2b — Exhaustive AUSEMIO Contract Research

**Status:** evidence package ready for independent audit
**Evidence date:** 2026-10-03
**Scope:** read-only research and Markdown/normalized-evidence artifacts. No adapter or application behavior change.

Canonical roadmap: [Development & Research Plan](../development-research-plan.md).
Canonical external client evidence: [AUSEMIO contract audit](../ausemio/contract-audit.md).
Canonical normalized public field catalog: [ausemio-public-field-catalog-2026-10-03.json](../ausemio/ausemio-public-field-catalog-2026-10-03.json).
P1a/P1b execution and CI evidence remain in their respective checkpoint notes.

## Outcome

- Updated the roadmap to reflect GitHub Actions, completed P1a/P1b, the active required `frontend`/`backend` contexts, and the SQLFluff skip of `database/seed.sql` over its large-file threshold. P1b's report and advisory counts remain canonical in the P1b note.
- Added P2c research requirements for the mobile-first reporting UX, permission-gated geolocation/fallback, map point selection, reverse geocoding and address confirmation, accessibility/QA, privacy/legal research, and alternatives for an owner decision.
- Recorded CSV and JSON as MUST-HAVE export formats, GeoJSON as desired when appropriate, and YAML as not required. Added duplicate-submission assistance as research only, with the prior “sent” event clearly distinct from an open problem and its matching/time-window/retry semantics left for owner decision.
- Captured every service code exposed by the public form (`2` VO, `16` CSS), all 10 ordered public field assignments, code labels and conditions, client file hints, and the observed VO/CSS conditional UI states. The canonical matrix and full 928-choice location catalog are in the contract audit and E12 artifact.
- Updated the future P4 mock-only matrix with literal public keys, codes, conditional branches, file cases, locale/email/consent unknowns, the local mismatches, and the invariant that local `simulated` results do not establish AUSEMIO acceptance.
- No adapter was implemented. Public-client evidence remains separate from server contract claims.

## Repository and CI baseline

At checkpoint start the working tree was clean on `master` at `fabd6cb8eb2f6417ae2617b296e179b783a268f6`. P1a and P1b are complete; GitHub Actions is selected; `frontend` and `backend` are required contexts. SQLFluff findings and the `database/seed.sql` large-file skip are recorded in the P1b checkpoint; no lint configuration or SQL file was changed here. npm audit advisories remain informational/untriaged as documented in P1b.

## AUSEMIO read-only evidence

### Method

Playwright `1.62.1` with Edge/Chromium `154.0.4258.53`; fresh anonymous contexts; no storage state, credentials, owner cookies, reporter values, or files. Context route was installed before page navigation/scripts and allowed only `GET`/`HEAD` to `kosice.ausem.io`. Service workers were blocked. An init script blocked form submission APIs, unsafe fetch/XHR, beacon, WebSocket, and EventSource. Unsafe HTTP methods and other origins would abort before transmission. Only service/fault selection codes were used to inspect client visibility; submit was never activated.

### Capture ledger

| Capture | UTC / Europe-Bratislava | Requests reaching network | Responses | Blocked before network | Unsafe attempts / transmissions |
|---|---|---|---|---|---|
| Settings, page assets, and initial form | 17:14:34.914 / 19:14:34 | 111 GET, 0 HEAD | HTTP 200 and 302 observed | One third-party GET, `www.gstatic.com/charts/loader.js`, due to origin allowlist | 0 / 0 |
| VO branch, then `typ_poruchy=Q99` | 17:34:23.009 / 19:34:23 | 104 GET, 0 HEAD | HTTP 200 and 302 observed | One third-party GET blocked by origin allowlist | 0 / 0 |
| Fresh CSS branch; `Q10`, `Q20`, `Q30` | 17:34:25.495 / 19:34:25 | 104 GET, 0 HEAD | HTTP 200 and 302 observed | One third-party GET blocked by origin allowlist | 0 / 0 |
| Relevant public source maps | 17:19:46.275 / 19:19:46 | 110 GET, 0 HEAD | HTTP 200 and 302 observed; response bodies were hashed in memory | One third-party GET blocked by origin allowlist | 0 / 0 |

The settings GET at 17:14:34.914 UTC returned HTTP 200, configuration version `2024.11.4`, and 74,678 bytes (SHA-256 `c4bbd5c5a42192c29a163bb1634112428dc85aa9f72a0239d45e94692a412b7d`). The sanitized catalog records its own GET capture timestamp, 17:11:36.434 UTC; it is 121,568 bytes (SHA-256 `786bad2f37b0e7cd67e1b73bf03ee04ab9ab4a6d49d518952a3fac5c7a06a5cb`). HTTP 200 and 302 response statuses were observed across the captures. Relevant bundle/source-map hashes and mapped module IDs are listed in the contract audit. No HAR, response headers, cookies, tokens, session IDs, raw source-map bodies, or unrelated settings were persisted.

### Public branch summary

`vyber_sluzby` offers required service `2` (VO) and `16` (CSS). VO exposes optional block `Q10/Q11/Q12` and optional fault `Q/Q1/Q2/Q3/Q4/Q6/Q10/Q61/Q99`; `Q99` reveals `iny_druh_poruchy`. CSS exposes optional `typ_poruchy_css=Q10/Q20/Q30`; Q10 reveals multiselect `porucha_na_prechode_pre_chodcov` with `Q1/Q2/Q4`, Q20 reveals multiselect `porucha_na_cestnej_svetelnej_signalizacii` with `Q1/Q2/Q3/Q4`, and Q30 has no configured child. Both services require the configured locality choice and `tel_cislo`. The full field order, defaults, Slovak labels, conditions, and 928 locality choices are in the canonical contract note/catalog.

These are **CONFIRMED PUBLIC CLIENT** facts only. Public code constructs an Axios POST to relative `public_issues` with multipart content; no such request was executed. Resolved endpoint, exact wire encoding/headers, email/consent wire keys, server validation/file acceptance, response schema, anti-bot checks, and issue-creation semantics remain **UNKNOWN SERVER**. If a fact can be confirmed only by a production write, it is **OWNER APPROVAL REQUIRED** and research stops there.

## P4 mock-only specification

The future specification is in the contract audit and uses a fake transport only. It covers both service branches, exact public keys and code labels, Q99 and CSS Q10/Q20/Q30 conditionals, file count/size/MIME edge cases, locale/email/consent unknowns, simulated-vs-accepted wording, and known public/local drift. Email/consent wire names and the exact on-wire spelling of arrays/files are not guessed. A local result must remain `simulated`; it must never be represented as externally accepted. No outbound adapter, network call, or P4 implementation was added.

## Traceability

| Requirement / acceptance criterion | Test(s) / research action | Implementation / result | Validation evidence | Independent audit outcome | Thesis-evidence reference |
|---|---|---|---|---|---|
| Roadmap reflects current CI, SQLFluff follow-up, and new owner requirements | Read P1a/P1b checkpoints, workflow and geocoding source; official-policy lookup | Plan updated; P1a/P1b marked complete; P2c research track and P3/P4 gates added | Source links in plan; P1b canonical for CI/audit counts | Pending independent audit | P7 only after audit |
| Enumerate all public services, ordered fields, options, requiredness, and conditional branches | Anonymous Playwright GET-only capture; service/fault selection in fresh contexts | 2 services; 10 configured assignments; E12 normalized option/condition catalog | E11 settings hash; E12 catalog; E14 UI state; bundle/source-map hashes in contract audit | Pending independent audit | P7 only after audit |
| Prove production write safety for this research | Context route and init guards installed before page scripts; request/response ledger per capture | No form submit; zero non-GET/HEAD attempts or transmissions; one unrelated third-party GET blocked per page context | Capture ledger above; no issue or personal data created/entered | Pending independent audit | P7 only after audit |
| Keep public-client evidence separate from server acceptance | Compare client settings/source maps with unknown server boundary | Server-only facts remain UNKNOWN; no adapter | Contract audit unknowns/approval boundary | Pending independent audit | P7 only after audit |
| Define future P4 mock coverage from evidence | Documentation-only matrix update | Literal keys/codes, both branches, attachments, mismatches, simulated result retained | Contract audit mock-only test matrix | Pending independent audit | P7 only after audit |

## Owner decisions and unresolved questions

- Whether AUSEMIO provides an official non-production endpoint and what explicitly scoped test procedure it permits. Production write permission remains absent.
- Server acceptance, exact resolved endpoint, multipart wire format, server-side validations/file rules, headers/CSRF use, response/error schema, and anti-bot enforcement. If only production writes can answer these, stop with **OWNER APPROVAL REQUIRED**.
- Final P2c UX alternatives, geolocation/map selection flow, geocoding provider policy, log/event fields, legal basis/notice, and retention. The minimal event remains a research candidate, not an approved schema.
- Duplicate assistance matching identity, category, time window, operator note, prior-send display, and repeat-submit behavior. “Previously sent” is not “still open.”
- P3 import semantics: partial-success vs atomic, duplicate identity, retry/idempotency, concurrent imports, and audit-log semantics. The existing owner decision gate is unchanged.
- Export field/filter/version/round-trip detail. CSV and JSON are fixed MUST-HAVE, GeoJSON is desired if appropriate, YAML is not required.
- Live settings and asset hashes can change; refresh read-only before any future implementation decision.

## Files and implementation boundary

- Updated `docs/research/development-research-plan.md`.
- Updated `docs/research/ausemio/contract-audit.md` (canonical external client evidence).
- Added `docs/research/ausemio/ausemio-public-field-catalog-2026-10-03.json` (sanitized normalized public configuration projection).
- Added this P2b checkpoint note (canonical execution/evidence record).

No production source, runtime dependency, database schema/migration, test source, or application behavior was changed. No local application test suite was run; this checkpoint's validation is the read-only evidence ledger, source hashes, sanitized catalog, and document traceability. CI checks will run through the repository's required workflow when the neutral research branch is published.

## Readiness

The public-client contract evidence is ready for independent audit and for planning mock-only P4 tests. It is not sufficient to claim AUSEMIO server acceptance or to enable a live adapter.
