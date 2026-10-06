# P2c Location Activation — Implementation Checkpoint

**Status:** implementation scope is complete on this unmerged branch and exact-head validation passed; ready for independent result audit. This checkpoint does not authorize production use, merge, provider activation, legal approval, or AUSEMIO traffic.

**Implementation branch:** `feature/p2c-location-activation-implementation`
**Current branch HEAD:** `a89f642277eb733e97adaef880a55afd1555b370`
**PR:** [#18](https://github.com/krustallik/public-lighting-fault-reporting/pull/18), open and unmerged
**Base:** `master` at `8ec7dcb0fa0eff15d7ee9bca387ab520f2c4905b` (merged PR #17)
**Implementation code commit:** `66592f613506ca26e81b08c62a55be631fa50d91`
**Canonical plan:** [P2c final location activation implementation plan](p2c-location-activation-implementation-plan.md)
**Plan audit:** independent targeted re-audit `PASS WITH P2`, P0=0, P1=0. Its single editorial correction is the wording `test matrix, isolated egress`; historical audit verdicts were not changed.

## Scope and product boundaries

The implementation preserves the accepted D1–D11 owner directions and the service-2 / public-lighting-only scope. Service 16 / CSS is not implemented. The selected product boundary is the Košice municipal administrative area and is not represented as the lighting operator's asset-responsibility boundary. Duplicate-history storage, report persistence, schema changes, migrations, distributed coordination, real report sending, authentication/CAPTCHA additions, and backward-compatibility layers were not added.

The user-facing report remains local/simulated. There is no real `/api/reports/send` route. Provider-capable code is fail-closed by default: Geoapify is disabled, CARTO approval is false and its public key is empty, and the device-recenter flag is false. Development OSM and synthetic map modes are not production fallbacks.

## Implemented code state

### Boundary source, generator, and runtime

- The committed source subset is `backend/src/data/service-area/source/kosice-okres-802-805.epsg8353.json`, with provenance in `kosice-okres-802-805.source.manifest.json`. It contains only numeric `IDN3` 802–805 from `okres_0`, crosswalked to municipality 599981; coordinates remain in source CRS and are not presented as RFC 7946 WGS84.
- Source evidence recorded in that manifest: official archive SHA-256 `807fc19d5419df0b0986c23a03fa883e11cbef43ce8a09169fc3d5e418f4b1b4`; extracted GeoPackage SHA-256 `a4a4b6c1be877426120110c35b8ec3f60c2a4b96a6973f4ce90b2815a355dab3`; committed subset SHA-256 `b1cc7cbc2c38ea6a2eabbf3972c88e57c7e46671bdc98eaed67c4498cb1dd277`. Attribution is GKÚ Bratislava (ZBGIS), CC BY 4.0.
- `backend/src/scripts/generateKosiceServiceArea.ts` validates the checked-in subset, IDs, manifest/hash, coordinates, rings, and topology; dissolves the districts with JSTS; invokes the pinned offline transform in `transformKosiceServiceArea.py`; and writes stable CRS84 output plus a deterministic manifest. `npm run check:service-area` regenerates/checks the committed output without fetching source geometry.
- The recorded transform is EPSG operation 8368 using pyproj 3.7.2 / PROJ 9.5.1, `always_xy`, no grid files, `PROJ_NETWORK=OFF`, and the pipeline/database hashes stored in `backend/src/data/service-area/kosice-city.manifest.json`. Output axis order is longitude, latitude; output is CRS84. Generated artifact SHA-256: `69080f2d913fe7167888a4231ef949381046868ef21fc3645dbd19c908026b26`. It is one Polygon component with no holes; it is an administrative product boundary, not proof of asset responsibility.
- Backend dependency `jsts@2.12.1` is pinned exactly. The installed package metadata identifies the GitHub `bjornharrtell/jsts` repository, license expression `(EDL-1.0 OR EPL-1.0)`, and one runtime dependency, `fastpriorityqueue ^0.7.5`. Real Node 20 / ESM / TypeScript NodeNext imports and production build passed for `GeoJSONReader`, `GeoJSONWriter`, `IsValidOp`, `RelateOp`, geometry ring accessors, and Polygon/MultiPolygon behavior. This records package metadata review, not legal advice.
- `backend/src/domain/serviceArea.ts` verifies artifact/manifest hash, CRS/axis order, schema, finite/ranged coordinates, non-empty valid topology, and fails closed as unavailable. Classification uses `RelateOp.intersects` for every interior-ring boundary before `RelateOp.covers`: polygon interior and exact outer boundary/vertex are inside; hole interior, exact hole edge/vertex, outside, and MultiPolygon gaps are outside. No coordinate epsilon or buffer is used; malformed geometry and topology errors fail closed.

### Backend target validation and address assistance

- `backend/src/domain/reportTarget.ts` resolves known-light-point IDs from PostgreSQL and uses stored coordinates as canonical, ignoring any client-supplied coordinate override. It validates custom/device/manual WGS84 coordinates and applies the same service-area classifier. Stable error outcomes include 400 `invalid_coordinates`, 404 `light_point_not_found`, 422 `outside_service_area`, and 503 `service_area_unavailable`.
- The existing explicit reverse-address suggestion endpoint now validates the selected custom/device coordinate, consumes the caller limiter, checks the boundary, and only then enters shared provider admission. Outside/invalid/unavailable requests do not dispatch a provider request. Reverse suggestion remains an explicit user action and returns allowlisted text/locality only; user edits and target changes win over stale results.
- `POST /api/reports/address-autocomplete` accepts typed text and `sk|en` only. It uses the same provider admission controller, asks the injected provider for up to five candidate features, filters candidates against the local service-area geometry, then exposes text labels only. Public response types and E2E assertions exclude latitude, longitude, geometry, raw features, and provider IDs. Selecting a result only replaces the existing `detailDescription`; it does not change locality, target, coordinates, map, confirmation, or route.
- `backend/src/providers/geoapifyAddressProvider.ts` implements an injectable, abortable, timeout-bounded adapter using the allowlisted EU HTTPS origin. It maps provider failures to safe public errors and normalizes only address/locality and internal candidate coordinates. `GEOAPIFY_ENABLED=false` and the API key is empty by default. Tests use fakes; no live Geoapify request was made.
- Reverse and autocomplete share one bounded in-process queue/coalescer: max active 1, max pending unique 1, 250 ms minimum start spacing, 3000 ms upstream timeout, 4000 ms queued expiry, no completed-result cache, no automatic retry, and a 2700 dispatch/day UTC-process budget. A dispatch reserves one budget unit immediately before upstream transport; earlier rejects consume none. Restart clears process-local queue, limiter, and budget state.
- The ephemeral caller limiter defaults to burst 10, refill 30/minute, 8192 keys, 120-second idle TTL. IPv4-mapped IPv6 is normalized; IPv6 is grouped by /64. Express trusts no proxy by default; forwarded addresses are used only through explicitly configured trusted proxy CIDRs. IPs and keyed digests are not logged.
- Error middleware returns generic errors without raw message/stack, including in development; provider URLs, credentials, request text, precise coordinates, raw provider response, contact fields, request bodies, and X-Forwarded-For are not included in error logs. Existing Nominatim automatic geocoding remains false and is not used for citizen address assistance.
- PostgreSQL 16 integration was run against a dedicated disposable loopback-only container initialized from the existing `database/schema.sql`: `tests/integration/reportTarget.postgres.test.ts` passed 1/1, demonstrating canonical database coordinates override synthetic client coordinates. The temporary container was removed. No database schema or migration changed.
- The gated simulated sink was not wired to target validation because its current contract does not carry the approved report-target model; no new acceptance/send endpoint was invented.

### Frontend map and report form

- `frontend/src/config/mapTiles.ts` accepts explicit `disabled`, `carto`, `dev-osm`, and `synthetic` modes. Production rejects development/synthetic modes and has no hidden fallback. CARTO native light/dark templates, attribution, key placement, and zoom cap are configured but not activated. Synthetic tile URLs support deterministic theme tests.
- The existing one-shot map-entry geolocation, viewport recenter, and explicit target selection remain separate. Recenter is gated and affects viewport only. A known-light-point chooser is shown only when the map is unavailable; the healthy map does not receive a permanent sidebar/list. Manual reporting remains possible if map, tiles, address assistance, or geolocation are unavailable.
- The existing report form keeps canonical local locality search separate from optional external text assistance. `detailDescription` uses a 3-Unicode-code-point threshold, NFC normalization, 350 ms debounce, IME-safe request timing, cancellation, a monotonic latest-response guard, and no auto-retry. Keyboard and pointer selection are supported; stale results cannot overwrite manual edits. Complete touched-flow translations are present in Slovak and English.
- The UI includes an explanatory, collapsible notice for geolocation, viewport-only recentering, explicit target choice, provider data flows when activated, and the manual alternative. Final privacy/legal wording remains **QUALIFIED LEGAL REVIEW REQUIRED**. No GDPR-compliance, legal-approval, or production-readiness claim is made.

## Validation evidence

### Local checks

On the implementation commit:

- Frontend: `npm run typecheck:tests`, `npm run test` (23 files, 193 tests passed), `npm run coverage`, and `npm run build` passed. Vite reports the existing >500 kB minified chunk warning (generated JS approximately 573 kB). Whole-frontend coverage is not claimed as complete; administrative screens remain largely outside this feature's tests.
- Backend: `npm run typecheck:tests`, `npm run test` (132 passed; the opt-in PostgreSQL test is skipped in the ordinary run), `npm run coverage`, and `npm run build` passed. Total backend coverage was 60.33% statements/lines, 79.24% branches, and 62.81% functions; this is repository-wide, not a claim that all paths are covered.
- Offline source/artifact validation: `npm run check:service-area` passed with `PROJ_NETWORK=OFF` in CI configuration; local `npm run check:service-area` passed. The separate PostgreSQL integration result is described above.
- `git diff --check` and changed-file trailing-whitespace/conflict-marker scans passed. No schema/migration path changed.
- Local browser E2E was not run: this Windows workspace does not establish the required process-level egress containment. Automated browser evidence must come from the repository's `process-egress-research` then `browser-e2e` jobs. Native Safari/iOS spot-check remains future evidence; Chromium is the only CI browser configured and must not be described as Safari.

### Remote CI and process-egress evidence

**Final exact-head result:** PR #18 head `a89f642277eb733e97adaef880a55afd1555b370`; GitHub Actions run [37492659758](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/37492659758) completed successfully on 2026-10-06. Required `frontend` and `backend` jobs passed; `process-egress-research` and `browser-e2e` also passed. Informational `sqlfluff-report` and `dependency-audit-report` completed successfully; their success is not a clean SQL/dependency finding verdict.

- `frontend`: test-source typecheck, unit/component tests, coverage, and build all passed.
- `backend`: disposable PostgreSQL 16 initialization/integration, test-source typecheck, unit/API tests, coverage, offline service-area generation check, and build all passed.
- `process-egress-research` passed. The workload used UID 999 with no effective/bounding capabilities and `no_new_privs=1`, in a network namespace with loopback only and no IPv4/IPv6 routes. Backend/frontend process probes to the synthetic `example.com` target were blocked with `ENETUNREACH`; the headless-Chrome fetch probe was rejected before response. This is containment evidence, not an application provider request.
- `browser-e2e` ran Chromium `Google Chrome 154.0.8037.57` / Node `v20.20.2`; **25 tests passed**. It used synthetic tile fulfillment and local/fake application services. The uploaded `browser-e2e-evidence` artifact contains 25 request-ledger JSON files and 3,157 browser request entries. The only origins were `http://127.0.0.1:5173`, `http://127.0.0.1:5000`, and `https://synthetic.invalid`; all 338 synthetic tile GETs were intercepted, with zero disallowed requests and zero requests to any other origin. No AUSEMIO request occurred (`noAusemioRequests: true` in process-egress evidence). Artifact links: [browser E2E evidence](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/37492659758/artifacts/11426630251) and [process-egress evidence](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/37492659758/artifacts/11426560263).
- An earlier run on head `c180a83d5d0bb5a28864b914be4167f277cc6682` passed isolation and 24/25 browser tests but failed because the test expected a CSS dark-tile filter while the synthetic provider correctly switches to a `/tiles/dark/` URL. Commit `a89f642` corrected that test assertion only; no application behavior or isolation was weakened. The exact-head run above passed all 25 tests.

### Dependency-audit evidence

The exact-head `dependency-audit-report` artifact recorded frontend 13 findings (6 moderate, 5 high, 2 critical) and backend 12 findings (6 moderate, 3 high, 3 critical). These totals match the recorded `master` baseline comparison. `jsts` and `fastpriorityqueue` do not appear among the affected package names in this artifact or the compared baseline; package-name comparison did not identify a newly introduced finding. Attribution limits remain: informational CI success means report collection succeeded, not zero vulnerabilities, and the audit job is not a full reachability/security review.

## Explicitly unverified or gated

- CARTO account/key, applicable terms for the concrete account, origin restriction, cost behavior, and any live tile request remain unverified and disabled.
- Geoapify account/key, current account-specific free/production/billing terms, live traffic, qualified legal/privacy review, approved notice wording, deployment hostname/TLS, and explicit owner authorization remain open. Provider flags remain off.
- Production proxy/XFF rewriting, proxy/container/APM/access-log review, secret storage, and production deployment behavior are unverified.
- No native Safari/iOS evidence or manual physical-device QA is claimed. Browser CI evidence is limited to Chromium; it is not Safari evidence.
- No real report-send route, AUSEMIO request/write, schema/migration, duplicate-history persistence, or service-16/CSS support was introduced.

**Readiness after remote validation:** exact-head CI and uploaded egress/browser artifacts are recorded above. The implementation is **READY FOR INDEPENDENT RESULT AUDIT** only; it is not approved for merge, legal use, production, or live provider activation.
