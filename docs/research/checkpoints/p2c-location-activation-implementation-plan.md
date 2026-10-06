# P2c Final Location Activation Implementation Plan

- **Status:** planning only; this final plan is ready for independent plan audit after publication. Owner decisions D1–D11 are accepted. This plan authorizes neither implementation nor live provider activation.
- **Repository baseline:** master `cf4108b6ac75e2e5c6166426a4c92eaecac81f1f`. PR #16 merged. Post-merge GitHub Actions run 37456530390 succeeded for frontend, backend, process-egress-research, browser-e2e, sqlfluff-report, and dependency-audit-report. The last two are informational and do not mean zero findings.
- **Research date:** 2026-10-06. Recheck provider terms, quotas, software releases, and dataset before implementation/activation.
- **Canonical evidence:** [P2c location-activation research](p2c-location-activation-research.md) contains dated provider/geography research; [P2c owner-decisions implementation plan](p2c-owner-decisions-implementation-plan.md) preserves earlier O1–O12 classifications; [P2c security/privacy evidence](../security-privacy/p2c-geolocation-privacy-evidence.md) is canonical for privacy/legal research. This plan is the final implementation-planning source. Historical audit verdicts are not rewritten.
- **Scope:** map tiles/theme, map-entry geolocation/recenter, official Košice administrative boundary, server-authoritative coordinate checks, explicitly triggered reverse-address suggestion, typed full-address autocomplete, provider admission/privacy hardening, tests, and documentation. Duplicate-history persistence is excluded.

## 1. Executive summary

The accepted product direction is a map-first service-2 / VO reporting experience for the administrative territory of Košice. Service 16 / CSS remains out of product scope. The city boundary is the product boundary by owner definition; it is not evidence that the municipality polygon equals the lighting operator's asset-responsibility territory. Use CARTO Basemaps for the thesis/pre-production map and Geoapify for server-side reverse geocoding and typed full-address autocomplete. Both remain inactive by default until the external gates in section 19 close.

Use an immutable, committed WGS84 boundary artifact generated from official ZBGIS/GKÚ administrative data using numeric identifiers and a recorded coordinate operation. Validate it at generation and startup with GEOS topology; use a robust point predicate at request time. The server, not the browser, decides whether a target is inside the product boundary.

Retain the local canonical AUSEMIO locality combobox as a separate required field. New external full-address autocomplete fills a distinct optional editable field; it never silently selects a locality or changes the report target. To use a result as a location, the user must explicitly choose that action and then confirm it through the existing confirmation flow.

All provider tests use fake transports and synthetic data. No live provider request, AUSEMIO request/write, real report submission, new persistence, or database migration is authorized. Do not add or mount a real-send route.

## 2. Accepted owner decisions and scope

These are accepted product directions, not decisions to reopen:

| Decision | Accepted direction | Consequence |
|---|---|---|
| D1 — tiles | CARTO Basemaps Free for thesis/pre-production; current budget $0; no SLA is acceptable for this stage; prefer native light/dark styles; future municipal production can revisit provider/plan/SLA. | CARTO path behind explicit gates; no silent paid upgrade or live-provider fallback. |
| D2 — recenter | Production-intended device recenter remains available after provider/privacy gates. It only changes viewport. It never selects/replaces target. Device target requires separate selection and confirmation. | Keep viewport and target state separate; test no target mutation. |
| D3 — boundary | Product report boundary is the official administrative territory of the City of Košice. It is not a claim about operator asset responsibility. | Build and enforce the municipal polygon server-side. |
| D4 — predicates | Interior and exact outer edge allowed; hole interior and hole edge outside; just outside outside; no buffer; malformed coordinates invalid; absent/invalid production geometry fails closed. | Explicit hole-edge exclusion plus robust outer-edge inclusion; no degree epsilon. |
| D5 — address provider | Geoapify is the primary implementation target for explicit reverse lookup and typed autocomplete; intended Free plan and current $0 budget; server-only key; EU endpoint where applicable. Live use gated. Public Nominatim is not for citizen address flows. | Server adapter default-off. |
| D6 — autocomplete | External full-address autocomplete is in scope and distinct from the local canonical locality picker. | Must not silently change locality, target, or user edits. |
| D7 — admission values | Engineering may tune concrete admission values from current provider contract, one-backend topology, synthetic tests, and fallback UX; researched numbers were proposals. | Values in `12–13 are final engineering proposals for implementation. Queue expiry is 4000 ms, not 2000 ms. |
| D8 — abuse control | Per-IP limiter required in addition to global queue/budget; no raw IP persistence/logging; no blind X-Forwarded-For trust; bounded memory; define IPv4/IPv6 and trusted proxies; disclose NAT fairness limitation; no CAPTCHA/auth now. | Implement shared in-process limiter in `13 with proxy/IP tests. |
| D9 — Nominatim | NOMINATIM_AUTO_GEOCODE remains separate, inventory-only, default false; not reused for citizen reverse/autocomplete. | Do not enable as side effect. |
| D10 — browsers | Target modern Chrome, Edge, Firefox, Safari, Android, iOS. Playwright WebKit is not native Safari/iOS Safari. | Automated claims only for browsers actually run; add native Safari/iOS spot-check before support claim. |
| D11 — activation | Synthetic providers may exercise complete behavior. Live providers stay off until account/key, terms, qualified legal/privacy review, notice, deployment proxy/APM/log review, and owner authorization are complete. | Fail-closed defaults; this plan does not authorize activation. |

Do not implement duplicate-history persistence or choose its remaining event-state, retention, reporting-window, deletion, or migration-source semantics. No DB schema/migration change is required here.

## 3. Baseline and current repository facts

Evidence is current code at the baseline, not README assertions:

| Concern | Current fact | Evidence |
|---|---|---|
| Tiles/gate | Leaflet uses OSM Standard raster. Visible in Vite development or when VITE_PUBLIC_MAP_TILES_APPROVED=true; that flag does not select CARTO. | frontend/src/config/mapTiles.ts; frontend/src/components/LightPointsMap/LightPointsMap.tsx |
| Theme | Dark appearance currently applies CSS raster filtering. | frontend/src/hooks/usePrefersColorScheme.ts; frontend/src/components/LightPointsMap/LightPointsMap.module.css |
| Geolocation | Map entry calls getCurrentPosition once with high accuracy, maximumAge 0, and 10-second timeout; denied, timeout, unsupported, and unusable states exist. | frontend/src/hooks/useMapEntryGeolocation.ts |
| Recenter/target | Recenter calls map.setView; selecting device as a target is separate and uses confirmation before report navigation. | frontend/src/components/LightPointsMap/LightPointsMap.tsx::handleRecenter/handleSelectDevice; frontend/src/components/TargetConfirmationDialog/ |
| Manual fallback | There is a continue-without-map-point path and manual coordinate input. Preserve them and add a non-map known-light-point chooser for tile/component failure. | frontend/src/components/LightPointsMap/; frontend/src/pages/MapPage/ |
| Locality | The report form uses a bundled canonical VO locality list. Matching is local, accent-insensitive and bounded; typing makes no network request. | frontend/src/components/LocalityCombobox/; frontend/src/utils/localitySearch.ts; frontend/src/config/ausemioForm.ts |
| Reverse suggestion | Explicit action for custom/device target. It aborts stale work, tracks user-vs-auto edits, fills current detail field when safe, and maps provider locality only through an exact unique local match. | frontend/src/pages/ReportFormPage/ReportFormPage.tsx::requestAddressSuggestion; frontend/src/services/geocodingApi.ts |
| Backend address seam | POST /api/reports/address-suggestion exists. Production singleton has no provider and is disabled; tests can inject fakes. Queue/cache settings are constructor options, not env config. | backend/src/app.ts; backend/src/routes/reportAddressSuggestion.routes.ts; backend/src/services/reportAddressSuggestion.service.ts |
| Inventory geocoder | Legacy Nominatim enriches inventory/light points when NOMINATIM_AUTO_GEOCODE is true; default false. It is separate. | backend/src/config/index.ts; backend/src/services/geocoding.service.ts; backend/src/scripts/geocodeLightPoints.ts |
| Boundary seam | classifyServiceAreaPoint accepts injected Polygon/MultiPolygon and returns inside/boundary/outside/invalid/unconfigured. No Košice polygon is configured; no report route calls it. Existing ray-casting epsilon/structural validation do not validate topology. | backend/src/domain/serviceArea.ts; backend/tests/unit/serviceArea.test.ts |
| Report sending | No active POST /api/reports/send route is mounted. A gated local test sink exists only for development/test and does not call AUSEMIO. Do not infer production sending from unmounted legacy services. | backend/src/app.ts; backend/src/routes/ausemioTest.routes.ts; backend/src/services/reports.service.ts |
| Logging | Generic 5xx middleware logs raw error objects; inventory geocoding has error-text logging. HTTP errors may carry URL/response/request data; exact deployment log/APM behavior is unknown. | backend/src/middleware/errorHandler.ts; backend/src/services/lightPoints.service.ts |
| Tests/CI | Vitest unit/component suites exist. CI runs frontend/backend, process-egress-research, browser-e2e, and informational SQLFluff/npm-audit reports. Browser E2E installs Chromium only. | .github/workflows/ci.yml; frontend/playwright.config.ts; scripts/research/contained-workload.sh |

No production report endpoint currently enforces the boundary. A shared backend target validator must run before a report can be treated as accepted and before any external/write side effect. The address-suggestion endpoint must reject invalid/out-of-bound coordinates before provider dispatch.

## 4. Target architecture and data flow

Boundaries:

1. **UI:** Leaflet map, accessible non-map known-point chooser, confirmation, canonical locality combobox, distinct optional full-address control, SK/EN.
2. **Frontend API:** typed clients call only this backend for address operations. Browser never receives Geoapify key.
3. **Backend routes/validation:** bound schemas and caller limits; reject invalid coordinates/outside targets before provider dispatch.
4. **Domain/services:** immutable boundary loader/classifier, target resolver, reverse/autocomplete, bounded queue/budget/coalescing, per-IP limiter, sanitized errors.
5. **Adapters:** injectable fake providers in tests; real Geoapify behind disabled config.
6. **Persistence:** no new persistence. Known light-point coordinates come from current PostgreSQL inventory; boundary is a checked-in static artifact, not a DB table.
7. **External boundary:** browser-to-CARTO tiles; backend-to-Geoapify only for explicit address actions. No AUSEMIO traffic in this scope.

Flow:

- Map entry -> browser geolocation attempt -> optional viewport centering/device marker -> independently selected known point, device, manual coordinate, or address suggestion -> confirmation -> report form.
- Map pan/zoom never calls geocoder.
- Explicit reverse action -> frontend POST /api/reports/address-suggestion -> schema/range validation -> caller limiter -> boundary validation -> coalescing/queue/budget -> Geoapify only if activated -> safe editable suggestion.
- Typed address -> Unicode minimum/debounce -> frontend POST /api/reports/address-autocomplete -> validation/limiter/queue/budget -> Geoapify autocomplete -> server filters candidates against polygon -> at most five safe candidates. Selection fills only the separate address field. A distinct use-as-location action creates a candidate and requires confirmation.
- Submission remains local/simulated. Any future application-owned accepted-report route must resolve known-point ID from DB or validate custom/device coordinates, enforce boundary, then execute its separately authorized sink. This plan adds no real-send route.

## 5. CARTO Basemaps contract

### URL, key, and config

Use CARTO raster XYZ, 256 px, max zoom 20:

- Light: https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key={VITE_CARTO_PUBLIC_KEY}
- Dark: https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key={VITE_CARTO_PUBLIC_KEY}
- Styles: light_all and dark_all.
- Attribution with links: © OpenStreetMap contributors -> https://www.openstreetmap.org/copyright; © CARTO -> https://carto.com/attribution/.
- CARTO-issued key is in tile URL query and intentionally browser-visible; it is not a secret. Restrict to exact approved website origins/domains. Do not commit it or place it server-side.
- Provider ID: carto. Allowed IDs: disabled, carto, dev-osm, synthetic. Development/test choices are explicit and not production fallbacks.
- Production requires provider=carto, VITE_CARTO_TILES_APPROVED=true and a valid nonempty public key. Missing/bad/unapproved config omits TileLayer and shows unavailable state with manual reporting intact. Never silently fall back to OSM or a paid provider.
- VITE_ALLOW_DEVICE_MAP_RECENTER remains a separate false-by-default gate, enabled only after privacy/provider approval.

### Usage, terms, privacy, failure

Official pages checked 2026-10-06:

- Free thresholds are 5M monthly non-commercial or 1M commercial requests, per calendar month UTC aggregated across all keys of one account. Treat use as commercial unless CARTO confirms the account classification. Do not split keys/projects.
- Terms updated 29 September 2026: legacy commercial keys issued before 23 September may use `12(c) until 30 November; `12(d) applies to all from 1 December. That does not mean all of the terms start on 1 December. Applicability to a newly created key/project and classification must be confirmed.
- Free access is revocable and may be rate-limited/suspended without notice; no SLA. Style/tile may be changed or withdrawn. Failure shows unavailable basemap and preserves manual/known-point paths; no provider fallback.
- Client/browser cache must not exceed 30 days; no server-side tile caching or proxying.
- Terms define request metadata as source IP, Referer, user-agent, key, timestamps and request volumes. CARTO states IP is truncated at ingestion (IPv4 final octet and IPv6 final segments), logs retained 30 days and stored in US, with transfer safeguards in terms. Tile z/x/y disclose viewport geography; exact device lat/lon is not inserted verbatim in the URL. HTTP metadata/referrer and public key are sent.
- Provider usage dashboard is per key/account and updated hourly according to CARTO. Monitoring is not a hard ceiling. Do not select paid plan or auto-upgrade. Verify free-account behavior is consistent with $0 owner budget before activation.
- E2E must fulfill tile requests from synthetic local fixture and assert no external tile traffic.

### Theme switch

Change TileLayer URL without remounting MapContainer where practical. Preserve center, zoom, overlays, known-point/device markers, candidate, pending/confirmed target and keyboard focus. If layer remount is needed, preserve the map. Retire CSS raster dark filtering for production CARTO; style UI controls separately for contrast/focus.

## 6. Geolocation, recenter and manual UX

- Keep one map-entry geolocation attempt, currently high accuracy, maxAge 0 and 10-second timeout, unless test evidence supports a narrow adjustment. Browser-controlled and optional.
- A usable fix may add device marker and center viewport. Recenter changes only viewport and never mutates target, candidate, confirmation, report state or form.
- Choosing device as target is separate; it creates a candidate and uses confirmation before report navigation.
- Denied, timeout, unsupported, invalid, or unavailable fix leaves city/map/manual paths available; explain recovery, do not create repeated permission prompts, and do not imply permission is consent to provider transfer.
- Tile disabled/failed/misconfigured -> neutral accessible map canvas and a separate fallback that survives a Leaflet component error boundary. Keep a non-map searchable light-point list, canonical locality, landmark/free text and manual latitude/longitude. This avoids pointer-only reporting.
- Without usable map/geolocation/provider, user can choose a known inventory point or enter approximate valid coordinates; service-area validation remains authoritative. If no point/coordinate can establish an in-area target, explain the required input rather than claim acceptance.
- Address provider failure/disabled/empty never blocks manual reporting or overwrites target/text.
- Mobile confirmation is compact card/bottom sheet with readable text, visible focus, touch targets, keyboard/dialog semantics and reachable manual path. All actions labeled; logical focus order; async status announced; blocking errors use alert summary. Include zoom/reflow and reduced-motion checks.
- Provider notice must explain location attempt, viewport-only recenter, separate target confirmation, CARTO viewport exposure, explicit Geoapify transfer, manual alternative and optional provider. Final legal copy: **QUALIFIED LEGAL REVIEW REQUIRED**.

## 7. Verified Košice administrative geometry and artifact

### Source evidence

Read-only official data was examined 2026-10-06:

- Publisher: GKÚ ZBGIS administrative boundaries, https://www.gku.sk/gku/produkty-sluzby/na-stiahnutie/zbgis.html.
- Basic-level S-JTSK03 administrative-boundary GeoPackage archive: https://opendata.skgeodesy.sk/static/ZBGIS/usj/ah_gpkg_0_sjtsk03.zip.
- Archive SHA-256: 807fc19d5419df0b0986c23a03fa883e11cbef43ce8a09169fc3d5e418f4b1b4.
- Extracted USJ_hranice_0.gpkg SHA-256: a4a4b6c1be877426120110c35b8ec3f60c2a4b96a6973f4ce90b2815a355dab3.
- GKÚ says data state 2026-06-30; Košice is not among older-data exceptions. License CC-BY 4.0; author GKÚ Bratislava.
- GeoPackage layers include okres_0 and obec_0. Geometry is MULTIPOLYGON, CRS EPSG:8353 (S-JTSK[JTSK03]). Select numerically from okres_0 using IDN3 802, 803, 804, 805, not display names. Official Statistics Office territorial division identifies City of Košice as municipality code 599981; record numeric crosswalk/source snapshot in provenance.
- No single whole-city feature keyed 599981 exists in this source layer. Read-only checks found four district geometries individually valid; their union is valid single Polygon, one component, no holes, 3444 ring coordinates, projected area 243731328.4013076 square metres. The union of 22 corresponding lower-level parts equals the district union (symmetric-difference area 0). This is geometry evidence, not lighting operator responsibility evidence.
- Generated subset retains source URL, attribution and CC-BY 4.0 notice. Do not check in entire archive without separate size/license review.

### Reproducible pipeline

1. Generator accepts the official GeoPackage as local input; runtime never downloads source data.
2. Verify recorded archive/input hashes or update evidence when source snapshot changes.
3. Fail if expected layer/schema/CRS/numeric-ID field/selected IDs/count/geometry type differs.
4. Select IDN3 802, 803, 804, 805 and verify crosswalk to municipality 599981 using the recorded official territorial-division source.
5. Validate source features and dissolved union: finite coordinates, closed rings, nonzero area, valid topology, expected components/holes. Never silently “make valid.”
6. Transform once with documented EPSG operation 8368, named by GKÚ as S-JTSK_[JTSK03]_To_WGS84_UGKK_SR, using pinned PROJ runtime/database; output OGC:CRS84 longitude/latitude. Forbid ballpark, missing-grid fallback, or implicit alternate operation. Record resolved pipeline, PROJ/database/grid versions and checksums. Stop if 8368 cannot run reproducibly.
7. Revalidate transformed WGS84 polygon, ranges, validity, extent, source metadata and expected geometry type. Serialize deterministically without simplification or moving vertices.
8. Future committed immutable outputs: backend/src/data/service-area/kosice-city.geojson and backend/src/data/service-area/kosice-city.manifest.json. Runtime never downloads/transforms/repairs/regenerates.
9. Future command: backend/src/scripts/generateKosiceServiceArea.ts --input <official-gpkg> --check. Generation writes artifact+manifest; --check compares deterministic outputs without modifying files.
10. Manifest records publisher/title/source URL/access date/data state/license/attribution, source hashes, layer/IDs/crosswalk, input/output CRS, operation code/name/full pipeline, pinned tool/grid versions+hashes, validation summary, output hash and generator revision. Separate nondeterministic generation timestamp from deterministic artifact comparison.

The selected boundary is the municipality by owner-defined product scope, not verified lighting-service territory.

## 8. Geometry approach and predicates

Select a narrow adapter to GEOS via geos-wasm; add it only in the later approved implementation. Research found TypeScript declarations/no transitive dependency and LGPL-3.0-or-later. Confirm redistribution/relinking obligations. Release activity is comparatively quiet, so first tests must prove Node 20 + current TypeScript ESM load, deterministic init/disposal, and production build. If compatibility or license check fails, stop the spatial slice and report; do not silently substitute a different library.

Alternatives:
- Reject current custom ray casting: fixed degree epsilon; no full OGC topology validation; weak handling of holes, self-intersection, overlap and zero area.
- JSTS/JTS-style is robust and has EDL/EPL licensing, but the researched package trails current JTS and has upgrade/API maintenance uncertainty. Not selected.
- Reject PostGIS: DB extension/migration/hosting operations for one static polygon without a compelling need.

Validation/predicates:
- Generation: GEOS validity checks for source, union and transformed artifact; fail on self-intersections, invalid rings, zero area, invalid overlapping MultiPolygon parts, non-finite/range errors or wrong CRS. No silent repair.
- Startup: load only committed artifact+manifest; validate hash/schema/CRS/topology. Missing, malformed, mismatched or invalid production artifact fails startup or makes boundary service unavailable; never fail open.
- Request: validate finite numeric WGS84 range then robust predicate. No epsilon, buffer or approximate distance.
- Outer edge allowed: GEOS covers(full polygon, point).
- Hole interior and exact hole edge outside: create/check each hole as an exclusion polygon; if covers(holePolygon, point), reject. Otherwise accept if covers(fullPolygon, point). This specifies hole-edge semantics separately rather than relying on ambiguous full-polygon behavior.
- MultiPolygon accepts if any valid component covers the point and no hole exclusion applies. Generated artifact expected single Polygon; fixtures still test MultiPolygon.
- Test shared edges/vertices deterministically. Predicate is exact over artifact coordinate values and does not imply sub-metre positional accuracy.

## 9. Backend-authoritative service-area flow

Use a common target resolver/validator at each application-owned report acceptance boundary:

- Known point: validate lightPointId, fetch canonical coordinates from DB, ignore/reject conflicting client coordinates, 404 unknown id, then apply same boundary predicate. No known-point bypass.
- Device/custom/manual/address target: validate finite WGS84 coordinates after explicit target selection/confirmation.
- Invalid coordinate -> HTTP 400 code invalid_coordinates.
- Outside, including hole edge -> HTTP 422 code outside_service_area.
- Missing/invalid production artifact -> HTTP 503 code service_area_unavailable.
- Reject before provider request, report persistence, AUSEMIO, or sink; only safe low-cardinality rejection telemetry.
- Browser check is UX only; backend decides.
- Today no active public report-send endpoint exists. Do not add /api/reports/send or real AUSEMIO adapter. Check coordinates before reverse-provider dispatch; check target on the gated simulated sink when used to verify contract. Any separately authorized future accepted-report route must resolve and enforce target before side effects.
- Autocomplete server filters every result with same polygon; outside results never returned as selectable locations.
- Keep local-sink outcome labeled simulated.

## 10. Geoapify contract

Official docs/pricing/terms/privacy checked 2026-10-06; no live API request made.

### Reverse

- Upstream GET https://api-eu.geoapify.com/v1/geocode/reverse.
- Query: lat, lon, lang=sk|en, limit=1, format=geojson, countrycodes=sk, server apiKey. Consume properties.formatted and, if present, the locality/city property only; city boundary remains local-authoritative.
- User-triggered only; never on map movement, typing/locality search, mount or focus.
- Allowlist only first feature properties needed for formatted editable address and optional locality candidate. Empty FeatureCollection -> 200 data:null. Discard raw response.
- Malformed schema -> safe 502 provider_invalid_response; handle provider status as `16.
- Key stays server-side even though provider query parameter contains it. Never expose key/full URL/error details.

### Typed autocomplete

- Upstream GET https://api-eu.geoapify.com/v1/geocode/autocomplete.
- Query: text, lang=sk|en, limit=5, format=geojson, filter=countrycode:sk, bias=proximity:<manifest representative-point lon>,<lat>, apiKey.
- countrycode:sk is hard country restriction; proximity only ranking. Filter each returned coordinate against local city polygon.
- Return at most five allowlisted entries using properties.formatted, properties.address_line1/address_line2, properties.street, properties.housenumber, properties.city/locality, and lat/lon only as needed for explicit use-as-location. Empty -> 200 empty list; malformed -> safe 502. No raw provider payload.
- Only the dedicated full-address field triggers autocomplete; do not send canonical locality/free-text report content automatically. The result is editable. Selecting one fills this field only; it does not change canonical locality or target. A separate explicit use-as-location action enters target confirmation. Reverse lookup also fills the separate address suggestion field; preserve the current exact-unique local locality mapping only for the explicit reverse-suggestion flow when the locality field remains untouched.
- No retry and no completed-result cache until terms explicitly support it. In-flight coalescing only.

### Terms, privacy and usage

- Current pricing says Free 3000 credits/day and up to 5 req/sec; reverse/geocoding/autocomplete simple request is one credit.
- Pricing FAQ currently says commercial production Free use is allowed within limits and attribution, but Terms v5 (2024-02-02) says commercial Free production use has limitations and asks users to contact. Terms reserve suspension or overage charges. Ask Geoapify: “May this specific pre-production/thesis citizen-reporting application for a municipal public-lighting service use Free in production at zero cost, and can the account/API key hard-stop without billable overage or paid upgrade?”
- Add required Geoapify and data-source attribution adjacent to results; recheck exact current wording.
- Privacy policy says request body, headers, IP and timestamp are retained; successful request information generally no longer than 24 hours for usage aggregation; lists Cloudflare, Bunny CDN for .eu requests, and Hetzner. Vendor statements, not independent verification.
- A .eu host alone does not prove all data residency or processors; review applicable DPA/routing before activation.
- Completed-result caches disabled: TTL=0/maxEntries=0 for both ops because general caching rights for these endpoint terms were not established. Do not apply batch API cache language to individual calls.
- Reserve one internal budget unit at dispatch and conservatively assume dispatched failed/aborted requests may consume provider credit; verify actual account behavior.
- No account/project/key quota splitting.

## 11. Autocomplete proposal values

| Setting | Value | Reason |
|---|---:|---|
| Minimum text | 3 Unicode code points after trim/NFC | Avoid one/two-character noise; count Unicode code points, not UTF-16 units. |
| Debounce | 350 ms | Reduce per-keystroke spend while remaining interactive; validate with synthetic mobile tests. |
| Max results | 5 | Bounded compact list and provider response cap. |
| Country | Slovakia hard filter | Product location; still apply city polygon locally. |
| Košice bias | deterministic representative point generated from official polygon | Ranking only, no exact citizen location in bias. |
| Cancellation | Abort prior request on edit/clear/close/target change/unmount | Reduce stale work. |
| Stale guard | monotonic sequence + query and target identity check | Abort is best effort. |
| Retry | none | No hidden quota or duplicate requests. |

Do not request during IME composition; evaluate after composition-end and threshold/debounce. Address remains optional/editable, and manual flow stays available.

## 12. Global admission, coalescing and budget

One shared process-local controller for reverse and autocomplete:

| Control | Proposal |
|---|---:|
| Active provider calls | 1 |
| Pending unique jobs | 1 |
| Minimum start spacing | 250 ms |
| Upstream timeout | 3000 ms |
| Queue expiry | 4000 ms |
| Reverse result cache | TTL 0, max 0 |
| Autocomplete result cache | TTL 0, max 0 |
| Shared UTC-day app budget | 2700 dispatches |
| Automatic retry | none |

With one active call bounded at 3000 ms and a 250 ms spacing rule, one queued job normally starts within about 3250 ms. A 4000 ms expiry gives 750 ms margin. Expiry at 2000 ms would reject normal queued work while the active operation was still running. Always check expiry immediately before dispatch in case event-loop timers were delayed.

Rules:
1. Validate schema and coordinate type/range; then account for the caller token; then validate the local boundary; only then reach coalescing/queue/provider admission.
2. Per-IP token is consumed after schema and coordinate-range validation by each valid request, even if a future cache/coalescer answers it. Invalid schema/range consumes none.
3. Completed caches remain disabled. Coalesce identical in-flight work only using HMAC-SHA-256 of operation + canonical request + language/filter/bias/provider version with random 32-byte per-process key; never retain completed result or log raw key fields.
4. Queue-full -> HTTP 429 queue_full, zero provider calls. Queue expiry -> 429 queue_expired, zero calls.
5. Immediately before upstream dispatch, reserve one of 2700 app units; exhausted -> 429 daily_budget_exceeded, zero provider calls.
6. Single process active=1 and 250 ms spacing is below published provider 5 req/sec but not account-wide if deployment multiplies.
7. Dispatched timeout -> 504 address_provider_timeout; abort transport where possible. App counts it once even if caller disconnects/outcome unknown.
8. Process restart resets queue, coalescing and daily counter. This is not an account-wide hard no-cost cap. Before activation verify provider plan hard-stops without billing/auto-upgrade; otherwise require separately approved durable budget coordination or remain disabled.
9. A second backend replica invalidates global coordination; keep one instance or approve shared coordination before scaling.
10. FIFO is order only, not caller fairness.

## 13. Per-IP limiter

One shared token bucket for reverse and autocomplete:

- Capacity 10; refill 30 per minute (0.5/sec sustained); one token per schema-valid request. Global queue separately caps provider work.
- No token -> HTTP 429 caller_rate_limited with generic Retry-After when possible; no provider call/app dispatch unit.
- Order: schema and coordinate-range validation -> caller limiter -> local boundary -> cache/coalescing/queue. Invalid schema/range returns 400 before caller state allocation.
- Max 8192 buckets, idle TTL 120000 ms, monotonic time; cleanup on access plus bounded sweep. At capacity evict expired only; if still full fail closed as 429 limiter_capacity.
- Do not store raw IP. Use existing express-rate-limit IPv6 helper with /64, then HMAC-SHA-256 with random 32-byte process-only key. Key rotates at process start. Pseudonymous key remains privacy-relevant; bucket is ephemeral.
- IPv4 is individual canonical address; IPv4-mapped IPv6 normalizes to IPv4; IPv6 aggregates by /64. Test compressed/expanded forms and mapped form.
- Express trust proxy defaults false. TRUST_PROXY_CIDRS is strict comma-separated CIDRs; configure a predicate trusting only those proxy addresses. Never use trust proxy=true, numeric hop count, or arbitrary XFF. Direct connection uses remoteAddress; Express req.ip may be used only after validated proxy chain. Edge must overwrite/sanitize XFF. Invalid CIDR fails startup; empty means trust none.
- If deployed behind a proxy without CIDRs, requests may all share proxy IP: conservative but poor availability/fairness. Actual proxy CIDRs and header rewrite are activation gates.
- NAT/shared networks can share one bucket. This is a fairness limitation, not proof of caller identity. No CAPTCHA/auth.
- No raw IP, forwarded chain, HMAC key/token in logs or persistence; only aggregate counters.

## 14. Logging, errors and privacy

Before enabling provider, normalize errors in adapter and stop generic middleware from logging raw error objects.

Never log/return exact coordinates, full address, typed query/locality, phone/email, free text, file names/metadata/content, raw body/provider response, Geoapify key, full upstream URL/query, raw IP/XFF chain, HMAC key/token. Do not expose provider data in development stacks or production responses.

Allowed aggregate low-cardinality telemetry: operation, result class, safe status class, latency bucket, queue-depth/active-count bucket, cache/coalesced flag, rejection reason, coarse remaining-budget band. Avoid per-user rows with precise timestamps and content.

- Adapter catches fetch/HTTP/JSON failures and emits a closed set of typed safe errors. Do not pass raw request/response/config as error cause into logger.
- Redact at source before error wrapping; never stringify upstream URL. Provider key is in upstream query and must be removed.
- Replace console.error(err) for provider-capable paths in backend/src/middleware/errorHandler.ts with fixed safe code/class. Review backend/src/services/lightPoints.service.ts error logs too.
- Bound request sizes; invalid-body telemetry must not serialize body.
- Reverse-proxy/access/container/APM logging is separate and unknown from repo. Inspect actual fields/access/retention/redaction before activation. Do not promise nothing is stored.
- Final privacy notice requires QUALIFIED LEGAL REVIEW REQUIRED.

## 15. Configuration and secrets contract

No credential value is included. Defaults are fail-closed.

### Frontend build-time

| Variable | Rule/default |
|---|---|
| VITE_MAP_TILE_PROVIDER | disabled in production; explicit disabled/carto/dev-osm/synthetic only |
| VITE_CARTO_TILES_APPROVED | false |
| VITE_CARTO_PUBLIC_KEY | empty; browser-visible public key after build; restrict domain; not secret |
| VITE_ALLOW_DEVICE_MAP_RECENTER | false until gate |
| VITE_API_URL | existing backend API base; never include provider key |

Production CARTO requires provider=carto, approval=true, valid key. Bad/missing config omits layer and preserves manual flow. Production rejects dev-osm/synthetic.

### Backend runtime

| Variable | Default/rule |
|---|---|
| GEOAPIFY_ENABLED | false |
| GEOAPIFY_BASE_URL | https://api-eu.geoapify.com; HTTPS and allowlisted host only |
| GEOAPIFY_API_KEY | empty; server-only, required when enabled |
| GEOAPIFY_TIMEOUT_MS | 3000 |
| GEOAPIFY_MAX_ACTIVE | 1 |
| GEOAPIFY_MAX_PENDING | 1 |
| GEOAPIFY_START_INTERVAL_MS | 250 |
| GEOAPIFY_QUEUE_EXPIRY_MS | 4000 |
| GEOAPIFY_DAILY_BUDGET | 2700 UTC process-local dispatches |
| ADDRESS_IP_BUCKET_BURST | 10 |
| ADDRESS_IP_REFILL_PER_MINUTE | 30 |
| ADDRESS_IP_MAX_KEYS | 8192 |
| ADDRESS_IP_IDLE_TTL_MS | 120000 |
| TRUST_PROXY_CIDRS | empty means trust no proxy; else strict CIDRs |
| NOMINATIM_AUTO_GEOCODE | remain separate/default false |

Reject invalid enum, unsafe/noninteger/inconsistent limits, malformed CIDRs, non-HTTPS/unapproved host/userinfo, or enabled-without-key at startup. Production invalid provider config fails startup, not silently switches providers. Tests inject fakes. No env flag enables AUSEMIO.

## 16. Failure matrix

App dispatch budget is reserved at dispatch. Assume any dispatched request may consume provider credit until account behavior is verified.

| Case | Result / UI | Provider call and budget | Logging |
|---|---|---|---|
| CARTO disabled/unapproved/missing key | No TileLayer; accessible unavailable state; manual/known-point controls remain | No tile request | Safe config class only |
| CARTO tile 4xx/5xx/network/quota | Unavailable background, no other live fallback; manual path works | CARTO request attempted; no Geoapify budget; vendor quota effect varies | Aggregate error class |
| CARTO theme unavailable | Keep old valid style or unavailable canvas; preserve map state/focus | Tile request may have occurred | Style/status only |
| Geolocation denied/timeout/unsupported/invalid | Explain and retain manual path | No provider | UI state only |
| Boundary artifact missing/invalid/hash mismatch | 503 service_area_unavailable; block acceptance | No Geoapify/AUSEMIO; zero budget | Safe startup/config code |
| Invalid/nonfinite/out-of-range coordinates | 400 invalid_coordinates; focus correction path | None | Code only |
| Unknown lightPointId | 404 light_point_not_found; point chooser | None | Omit ID by default |
| Outside target / hole edge | 422 outside_service_area; allow correction | No provider/AUSEMIO/write, zero budget | Outcome only |
| Exact outer edge | Accept in-area | No provider unless separately requested | No location log |
| Address provider disabled | 503 disabled; manual address/target unchanged | No call, zero budget | Operation+disabled |
| Invalid request | 400 invalid_request | None, zero budget | Never body |
| Per-IP rejected/capacity full | 429 caller_rate_limited/limiter_capacity; manual path | None, zero budget | Aggregate reason |
| Global queue full/expired | 429 queue_full/queue_expired; manual path | None, zero budget | Depth/outcome bucket |
| Daily cap reached | 429 daily_budget_exceeded; retry after UTC reset/manual path | None, zero budget | Coarse budget band |
| Provider timeout | 504 address_provider_timeout; preserve form/manual fallback | Yes, one app unit; external debit uncertain | Safe timeout/latency |
| Provider 400 / 401-403 | 502 provider_rejected_request/provider_configuration_error | Yes, one app unit; debit uncertain | Safe status only |
| Provider 429 | 503 provider_throttled; no automatic retry | Yes, one app unit | Status class |
| Provider 5xx/network | 503 provider_unavailable | If dispatched, one app unit | Safe class |
| Malformed provider JSON/schema | 502 provider_invalid_response | Yes, one app unit | Parser class only |
| Empty reverse/autocomplete | 200 data:null / suggestions:[]; no-results/manual flow | Yes, one app unit | Empty result count |
| Abort before dispatch | No stale response; keep form | No call/zero budget | No raw per-request event |
| Abort after dispatch/stale response | Ignore result; user text/target wins | Dispatch occurred; one app unit; vendor may charge | Aggregate abort stage |
| No map, geolocation or address provider | Known-point list or manual valid coordinates/locality/details | None | No sensitive event |

## 17. Test-first acceptance matrix

Start with failing tests and fake transports. Each pre-provider rejection asserts zero fake-provider calls and zero dispatch-budget consumption. No live CARTO, Geoapify or AUSEMIO in tests.

| Area | Required tests |
|---|---|
| CARTO | Exact templates/styles/key/attribution/max zoom; missing/unapproved config fail-closed; no fallback; theme state preservation; synthetic tile errors preserve manual flow; no external request. |
| Geolocation/recenter | One map-entry attempt; denied/timeout/unsupported/invalid; device marker; recenter only viewport; device selection requires confirmation; no target/log coordinate mutation. |
| Geometry artifact | Numeric source selection/crosswalk/hash; deterministic generator and --check; EPSG:8353 to CRS84 through pinned 8368; missing grid/wrong CRS fails; authentic manifest; synthetic Polygon/MultiPolygon; outer/hole edges; outside; malformed; self-intersection/zero-area/open ring/overlap; missing/corrupt artifact fail-closed. |
| Boundary API | Known ID resolves DB coordinates and ignores spoofed client coords; custom/device checked; stable 400/422/503; rejection precedes provider/sink; zero call/budget on invalid/outside; outer and hole edges end-to-end. |
| Reverse | Explicit only; success/empty/timeout/4xx/429/5xx/malformed; boundary rejection zero provider call; stale target/abort; user edit wins; exact-unique existing local locality mapping only; no request on pan/typing; cache disabled/coalescing verified. |
| Autocomplete | Unicode minimum/debounce/IME; abort and latest wins; max 5; SK/EN; hard Slovakia filter and ranking-only Košice bias; local polygon filter; selected suggestion changes address field only; locality/target/user edits unchanged; explicit use-as-location plus confirmation; empty/disabled/error manual path. |
| Per-IP | Direct IPv4, mapped IPv6, expanded/compressed IPv6 /64; trusted proxy; spoofed XFF ignored untrusted; allowed chain; bad CIDR startup fail; NAT caveat; refill/burst/expiry/capacity; invalid request no allocation; rejection zero upstream/budget; no raw IP in logs. |
| Queue/budget | 1 active/1 pending, 250ms, 3000ms timeout, 4000ms expiry normal queued-work bound; queue full/expiry/budget rejects zero transport and unit; reserve exactly once on dispatch; UTC reset/restart; HMAC coalesce; abort before/after dispatch; no cache/retry; bounded memory. |
| Privacy/errors | Captured logs/errors exclude coordinates/address/query/contact/body/files/key/full URL/provider payload/IP/XFF/HMAC. No key in frontend build; generic middleware gets safe code only. Deployment proxy/APM redaction remains a manual pre-activation checklist. |
| Accessibility/E2E | Existing narrow mobile sizes, touch, keyboard, visible focus, dialog/listbox/screen-reader announcements, zoom/reflow, reduced motion where applicable, SK/EN, manual fallback, axe as signal only. Synthetic tile and fake Geoapify fulfillments under process-egress isolation; request ledger proves no external providers/AUSEMIO. |
| Browsers | CI currently installs Chromium only. Report Chromium only. Add Firefox/WebKit only if install/run under same egress containment. Playwright WebKit is not native Safari; retain native Safari/macOS+iOS manual spot-check evidence separately. |

No duplicate-history tests, DB schema changes or migrations in this scope.

## 18. Exact future code-change map

Planning only; none is changed here.

| Area | Expected files | Responsibility/dependencies |
|---|---|---|
| Tiles | Modify frontend/src/config/mapTiles.ts | Provider enum, CARTO templates, attribution, strict production gate, no fallback. |
| Map/theme | Modify frontend/src/components/LightPointsMap/LightPointsMap.tsx and module CSS; possibly frontend/src/hooks/usePrefersColorScheme.ts | Preserve Leaflet state; native styles; retire production raster filter. |
| Geolocation/fallback | Modify frontend/src/hooks/useMapEntryGeolocation.ts and frontend/src/pages/MapPage/; add accessible known-point chooser if no reusable component | Device marker/recenter separation, fallback outside map error boundary. |
| Confirmation | Modify frontend/src/components/TargetConfirmationDialog/ and map integration | Explicit device/address target confirmation; focus/mobile semantics. |
| Report address UX | Modify frontend/src/pages/ReportFormPage/ReportFormPage.tsx and styles | Separate optional full-address field/listbox; source tracking, latest-wins, explicit target action. |
| Frontend API/i18n | Modify frontend/src/services/geocodingApi.ts and types; frontend/src/i18n/reportFormMessages.ts and locale definitions | Backend-only requests; SK/EN errors/statuses; no provider key in browser. |
| Backend config | Modify backend/src/config/index.ts; add/update backend/.env.example only if consistent with repository convention | Strict provider/proxy/admission config; Nominatim remains separate/off. |
| Provider adapter | Add backend/src/providers/geoapifyAddressProvider.ts | Reverse/autocomplete fetch, safe normalization, fakeable transport. |
| Address routes/service | Modify backend/src/services/reportAddressSuggestion.service.ts and backend/src/routes/reportAddressSuggestion.routes.ts; add backend/src/routes/reportAddressAutocomplete.routes.ts for POST /api/reports/address-autocomplete | Validation, shared queue/budget/coalescing, boundary-before-dispatch. |
| Per-IP | Add backend/src/middleware/addressRateLimit.ts or backend/src/services/addressCallerLimiter.ts; wire validated proxy predicate in backend/src/app.ts | Bounded HMAC token bucket, address normalization, no raw-IP logging. |
| Geometry | Add backend/src/data/service-area/kosice-city.geojson and manifest; add backend/src/scripts/generateKosiceServiceArea.ts; extend backend/src/domain/serviceArea.ts; add startup loader service | Immutable artifact, pinned repro pipeline, GEOS adapter, fail-closed startup/request predicate. |
| Target enforcement | Add shared target resolver/domain service; wire coordinate address route and gated sink; future accepted-report route only if separately authorized | Canonical DB point lookup, ignore client-coordinate spoof, stable codes before side effect. |
| Logging | Modify backend/src/middleware/errorHandler.ts; review backend/src/services/lightPoints.service.ts | Safe event codes and source-level redaction. |
| Tests | Extend backend/tests/unit/serviceArea.test.ts, reportAddressSuggestionService.test.ts, reportAddressSuggestionApi.test.ts, errorHandler.test.ts; frontend map/form tests and frontend/tests/e2e/ | Synthetic fixtures, fake transport, `17 matrix, isolated egress. |
| Environment/docs | Add templates only following existing convention; update canonical P2c implementation checkpoint after implementation | No secrets; exact defaults/evidence; keep historical research canonical. |

Do not change DB schema/migrations, add history tables, mount a real AUSEMIO endpoint, or add credentials.

## 19. One coherent implementation order and activation gates

### Future coding task order

A. Add failing tests and config contracts with fake providers and blocked live egress.
B. Prove geos-wasm Node 20/TypeScript ESM and build compatibility/license; implement generator and authentic artifact; validate before any route depends on it. Stop spatial slice if pinned operation/library fails.
C. Implement boundary loader/predicates and server enforcement; known points resolve from DB; validate gated simulated target. No persistence or real send.
D. Implement Geoapify adapter, strict config, per-IP limiter, queue/budget/coalescing and source-level privacy/error redaction; keep disabled and use fakes.
E. Integrate explicit reverse and typed autocomplete UI; separate address from canonical locality; cancellation/edit/target guards and manual fallback.
F. Implement CARTO config/theme/recenter with synthetic tiles only; preserve Leaflet state and viewport/target separation.
G. Integrated SK/EN, mobile, keyboard, screen-reader, zoom/reflow and reduced-motion flows.
H. Run unit/component/API/typecheck/build/E2E/process-egress/generator --check; report only actual browsers.
I. Record hashes, tool versions, tests, configuration and limitations in canonical checkpoint; targeted independent audit before any activation consideration.

### External activation prerequisites

1. CARTO account/key, accurate use classification, new-key transition applicability, domain restriction, attribution, free-plan quota behavior and no-paid-upgrade behavior confirmed.
2. Geoapify account/key and written/account-specific confirmation that this exact service may use Free in production and can hard-stop without billing/upgrade; otherwise remain disabled or obtain approval for a different budget design.
3. Qualified legal/privacy approval for actual data transfer, processor terms, retention and user notice. Notice text remains QUALIFIED LEGAL REVIEW REQUIRED.
4. Deployment owner confirms exact hostnames/origins, TLS, trusted proxy CIDRs/XFF rewrite, and proxy/container/APM log fields/access/retention/redaction.
5. Runtime settings reviewed: server-only Geoapify secret; explicit CARTO and Geoapify gates; fail-closed defaults; no hidden Nominatim/AUSEMIO behavior.
6. Owner separately authorizes live provider activation after synthetic CI/E2E evidence.

If any gate is incomplete, provider flags stay false and no real provider traffic is sent. No paid fallback or silent alternative provider is allowed.

## 20. References

### Repository evidence

- Map config/state: frontend/src/config/mapTiles.ts; frontend/src/components/LightPointsMap/LightPointsMap.tsx; frontend/src/hooks/usePrefersColorScheme.ts.
- Geolocation: frontend/src/hooks/useMapEntryGeolocation.ts.
- Locality/address: frontend/src/components/LocalityCombobox/; frontend/src/utils/localitySearch.ts; frontend/src/pages/ReportFormPage/ReportFormPage.tsx; frontend/src/services/geocodingApi.ts.
- Backend app/address: backend/src/app.ts; backend/src/routes/reportAddressSuggestion.routes.ts; backend/src/services/reportAddressSuggestion.service.ts.
- Boundary/config/logs: backend/src/domain/serviceArea.ts; backend/src/config/index.ts; backend/src/middleware/errorHandler.ts.
- CI/evidence: .github/workflows/ci.yml; frontend/playwright.config.ts; scripts/research/contained-workload.sh.
- Simulated sink: backend/src/routes/ausemioTest.routes.ts.

### Official external evidence

- [CARTO styles, raster URLs, keys, attribution and quotas](https://www.carto.com/basemaps/)
- [CARTO Basemaps Terms](https://carto.com/legal/basemap-terms/)
- [Geoapify Reverse API](https://apidocs.geoapify.com/docs/geocoding/reverse-geocoding/)
- [Geoapify Autocomplete API](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/)
- [Geoapify pricing](https://www.geoapify.com/pricing/)
- [Geoapify Terms](https://www.geoapify.com/terms-and-conditions/)
- [Geoapify Privacy Policy](https://www.geoapify.com/privacy-policy/)
- [Geoapify EU endpoint and GDPR guidance](https://www.geoapify.com/maps-geocoding-routing-apis-gdpr-compliant-application/)
- [GKÚ ZBGIS administrative-boundary downloads](https://www.gku.sk/gku/produkty-sluzby/na-stiahnutie/zbgis.html)
- [Statistics Office territorial division: Košice municipality code 599981](https://volby.statistics.sk/oso/oso2022/sk/uzemne_clenenie.html)
- [GKÚ S-JTSK03 transformation guide](https://www.gku.sk/files/gku/produkty-sluzby/na-stiahnutie/s-jtsk_jtsk03_v_arcgis.pdf)
- [EPSG operation 8368](https://epsg.io/8368)
- [geos-wasm npm metadata](https://www.npmjs.com/package/geos-wasm) and [source repository](https://github.com/planetscale/geos-wasm). Recheck exact release/types/license/Node compatibility before adding.

Provider statements and research are dated evidence, not a legal opinion or guarantee. Recheck current pages and account-specific terms before activation.
