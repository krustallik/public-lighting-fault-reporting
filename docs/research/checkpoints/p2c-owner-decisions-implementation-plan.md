# P2c owner decisions — map-first reporting implementation plan

**Status:** Planning/research only; ready for independent plan audit. No production behavior, database schema, dependencies, or runtime configuration was changed. This is not implementation approval. P2c's earlier audit applies to the prior plan revision at its stated baseline, not to this owner-decision amendment.

**Evidence date:** 2026-10-05 (Europe/Bratislava). Provider quotas and terms are time-sensitive and must be checked again before implementation/provider approval.

**Repository inspected:** local `master` at `094ee65a0390b264e0efeb0d2110ea077752c354`; `git status` reported `## master...origin/master` before documentation changes. The repository refuses ordinary Git reads under this sandbox identity unless passed a command-local `safe.directory` override; no global Git configuration was changed.

**Canonical companions:** [P2c base research plan](p2c-mobile-reporting-geolocation-privacy-plan.md), [P2c security/privacy evidence](../security-privacy/p2c-geolocation-privacy-evidence.md), and [Development & Research Plan](../development-research-plan.md). This note is canonical for the owner-decision mapping, current P2c recommendation, test-first sequence, and implementation gates. The security/privacy note remains canonical for its official-source/legal evidence.

## 1. Scope, evidence labels, and hard boundaries

This checkpoint converts the owner's accepted product constraints into a concrete implementation proposal for map-first public lighting fault reporting. It makes no legal conclusion and does not authorize implementation.

- **CONFIRMED — repository behavior** means directly visible in code/schema at the inspected local `master` SHA.
- **OWNER-PROVIDED** means stated by the owner; it is not independently verified runtime database or deployment evidence.
- **CONFIRMED — official source** means a public official/primary source checked on the evidence date.
- **RECOMMENDATION / INFERENCE** is a proposed design, not an accepted rule.
- **UNKNOWN** means the inspected repository does not establish the fact.

Hard boundaries:

- Product scope is only AUSEMIO service `2` / VO. Service `16` / CSS stays **OUT OF PRODUCT SCOPE**; the product must not emit CSS payloads.
- No AUSEMIO access, form submission, or live AUSEMIO traffic is authorized. Local-test success remains simulated, not externally accepted.
- No hidden fallback or alternate live submission endpoint may be introduced: local/mock failure must never route to AUSEMIO or another production submit transport. Preserve the existing FORM TEST HARDENING egress/process boundary.
- No production code, tests, dependencies, schema, migrations, or application behavior are changed in this research task.
- Use synthetic coordinates and fake provider transports in tests. Do not use real citizen data. No live provider requests in tests or E2E.
- Do not persist citizen contact information, report text, files, device coordinates, raw request bodies, IP addresses, or browser fingerprints for duplicate history.
- Browser permission is not, by itself, legal consent to send coordinates to the application or an external provider.

### Owner-supplied current state (not runtime-verified)

The owner states that the product is pre-production, has no real users, has effectively no report/integration history, and the actual database contains only lighting-point data; backward compatibility for previous report/fault mappings and migration of historical report/category values are not required. This is an owner-provided factual premise, not a query/inspection of the running database. The repository does contain an `integration_logs` table and code that can write **simulated technical log** rows (`database/schema.sql`; `backend/src/services/aussemio.service.ts`, `mapReportToTechnicalLog` in `backend/src/config/ausemioMapping.ts`). The presence of this capability does not independently establish that rows exist. No legacy mapping layer or historical-value migration is warranted by the owner-provided state.

## 2. Owner decision register (O1–O12)

Each requirement is classified separately from any still-open implementation detail. The combined rows for O5, O7, O10, and O11 intentionally record both accepted direction and unresolved sub-decisions.

| ID | Classification | Current decision / remaining gate | Implementation consequence |
|---|---|---|---|
| O1 — entry flow | **ACCEPTED OWNER DECISION** | Map is the primary, must-have entry. Show all known light points. If usable location is available, center approximately there; otherwise show Košice at whole-city extent. If map itself is unavailable, offer a secondary manual path. | Do not switch to report-first as the normal entry. Do not let `fitBounds(all assets)` override the accepted geolocation-centered initial view. |
| O2 — geolocation prompt timing | **ACCEPTED OWNER DECISION** | Attempt a one-shot geolocation request when the map opens. If available, show the device position as a distinct marker. “My location” only recenters/zooms the map. The device position never becomes the report target without the user's explicit selection and confirmation. | Preserve the entry-time attempt. If a browser/platform delays, suppresses, denies, or rejects it, retain the Košice map and manual flow and explain recovery; compatibility fallback does not reopen the accepted product behavior. Do not repeatedly prompt automatically. |
| O3 — target authority | **ACCEPTED OWNER DECISION** | Known `lightPointId` is strongest identity; manually confirmed map point is authoritative for arbitrary reports; device location is only a suggestion and cannot silently replace a target; address is derived/suggested; user edits win. Confirmation/cancel is required before entering the form. | Preserve existing target-change reset and user-edit precedence unless a separately approved contract changes it. |
| O4 — address suggestion | **ACCEPTED OWNER DECISION** | No reverse geocoding on map pan/drag/typing. A user may request lookup or it may run only at a defined low-frequency confirmation point. The result is visibly automatic, editable, and never authoritative; manual reporting continues on failure. | Recommend a separate “Suggest address” button after target selection. This is within the allowed owner alternatives; no autocomplete. |
| O5 — provider/topology | **ACCEPTED OWNER DECISION (topology); OWNER DECISION STILL REQUIRED (provider and provider-specific contract)** | Current scope assumes one pre-production backend instance. The geocoding provider has not been selected. Geoapify is a conditional hosted recommendation for a product-scoped lookup; public Nominatim is not recommended for coordinates that may be personal/confidential. | Keep credentials and provider transport behind the backend. Reopen quota coordination if deployment changes to multiple instances. Confirm actual account, terms, plan, attribution, rate/quota, retention, and privacy conditions before selection. |
| O6 — coordinate transfer | **QUALIFIED LEGAL REVIEW REQUIRED** | Before device/report-linked coordinates are sent to any hosted provider, obtain owner approval of the specific provider, purpose, and notice, plus qualified privacy/legal review of the actual transfer. | Until cleared, fake provider only; disable all real citizen-derived coordinate lookups. A known public asset coordinate still must be assessed in its report context. |
| O7 — coordinates/retention | **ACCEPTED OWNER DECISION (minimization direction); OWNER DECISION STILL REQUIRED (exact lifetime and exceptions)** | Minimize long-lived precise coordinates and avoid unnecessary URL, database, and log persistence; prefer ephemeral state. Exact router/deep-link behavior, cache/TTL, access/error-log handling, and any exception remain open. | Recommend in-memory/router state without query coordinates, browser storage, DB write, or coordinate-bearing logs; refresh without target state enters recovery. Validate actual proxy/host logs before claims about end-to-end retention. |
| O8 — accessibility/browser baseline | **ACCEPTED OWNER DECISION** | Support broad modern-browser/device use, provide keyboard and non-map alternatives, include screen-reader-relevant semantics, automated accessibility checks, and human keyboard/focus/browser QA. Exact supported-browser test matrix remains a researched recommendation. | Target WCAG 2.2 AA as an acceptance goal, not a conformance claim. Add Chromium/Firefox/WebKit coverage where egress-isolated CI permits and manually check native Safari/iOS when available. |
| O9 — tile provider | **OWNER DECISION STILL REQUIRED** | Current OSM URL differs from OSMF's canonical URL. Current CARTO terms require a CARTO-issued key and current config has no key. Recommend OSM canonical raster for low-traffic research and a key-backed dark provider only if approved. | Do not increase tile traffic or claim current provider compliance until provider choice, key/terms, attribution, and page policy are checked. |
| O10 — duplicate/event persistence and retention | **ACCEPTED OWNER DECISION (scope/minimization); OWNER DECISION STILL REQUIRED (event and retention details)** | History applies only to known DB light points. Do not persist contact data; retain only useful minimized operational history where justified. This does not authorize email, phone, free text, photos, precise device/custom coordinates, IP, fingerprint, or raw-body retention. Exact event states, count window/time anchor, retention/deletion, access rules, category/block presentation, and future legitimate external-reference semantics remain open. | No arbitrary-coordinate duplicate history. No schema change until O10/O12 and P3 gates are satisfied. |
| O11 — reverse-geocoder admission | **ACCEPTED OWNER DECISION (product-only bounded direction); OWNER DECISION STILL REQUIRED (numeric and caller/edge contract)** | The geocoder serves the reporting product flow, not a general-purpose geocoder API. Use bounded admission/backlog, controlled provider use, explicit overload/manual fallback, and define duplicate/coalescing behavior. Exact queue size, timeout, cache size/TTL, per-caller/edge admission, numeric limits, and rejection response remain open. The previous plan-audit documentation/process P1 is closed; this operational policy is not yet approved. | Treat the current public `GET /api/geocode/reverse` as not approved for product use until its route/admission contract is selected and implemented. FIFO may define order only; see §7 for its fairness limitation. |
| O12 — legal/privacy review | **QUALIFIED LEGAL REVIEW REQUIRED** | Determine applicability for actual controller, deployment, location transfer, notices, lawful basis, retention, event history, provider/subprocessors, and deletion/backups. No compliance conclusion is made here. | Synthetic/mock implementation and tests may proceed after other gates; real user location transfer/persistence stays disabled pending review and owner decisions. |

No ADR is created: provider/tile selection, exact event lifecycle/retention, legal conditions, and operational sub-decisions remain open; accepted map-entry geolocation and minimized-coordinate direction are product requirements, with browser compatibility fallback kept separate.

## 3. Repository facts relevant to the proposal

| Area | Confirmed repository fact | Evidence |
|---|---|---|
| Entry/map | `/` redirects to `/map`; `MapPage` renders `LightPointsMap`. It starts at `[48.7164, 21.2611]`, zoom 13, fetches all returned light points, and `MapFitBounds` fits their bounds up to zoom 16. | `frontend/src/App.tsx`; `frontend/src/pages/MapPage/MapPage.tsx`; `frontend/src/components/LightPointsMap/LightPointsMap.tsx`; `frontend/src/services/lightPointsApi.ts`; `backend/src/services/lightPoints.service.ts::getAllLightPoints`. |
| Target selection | Inventory popup path uses `/report?lightPointId=<id>`. Arbitrary click creates a marker and links to `/report?lat=<lat>&lng=<lng>`. No Košice polygon check or browser geolocation use exists in current app source. | `frontend/src/components/LightPointsMap/MarkerClusterLayer.tsx`; `MapCustomLocationLayer.tsx`; `frontend/src/utils/reportLocationParams.ts`; static source search for `navigator.geolocation`. |
| Form precedence | Changing target identity resets form/errors/files/step. Auto-fill does not overwrite a field marked as user-edited. Custom coordinates are appended to local-test detail text. | `frontend/src/utils/reportTargetSession.ts`; `autofillPrecedence.ts`; `customLocationDetail.ts`; `buildReportFormData.ts`; `ReportFormPage.tsx`. |
| Reverse geocoder | Public `GET /api/geocode/reverse` validates WGS84 range then calls configured Nominatim. It has an unbounded process-local 5-decimal cache and a concurrent sleep-before-request limiter; there is no timeout, queue bound, route-level admission control, or multi-process coordination in the inspected code. | `backend/src/app.ts`; `backend/src/routes/geocoding.routes.ts`; `backend/src/controllers/geocoding.controller.ts`; `backend/src/services/geocoding.service.ts`; `backend/src/config/index.ts`. |
| Existing Nominatim usage | Inventory auto-geocoding is disabled in `.env.example`; startup/create/update/manual script paths can call Nominatim and persist inventory address/timestamp. Any use of a selected provider must account for these other callers under the same provider quota. | `.env.example`; `backend/src/index.ts`; `backend/src/services/lightPoints.service.ts`; `backend/src/scripts/geocodeLightPoints.ts`; `backend/src/config/index.ts`. |
| Current external tiles | Light tiles use `https://{s}.tile.openstreetmap.org/...` with `abc`; dark tiles use CARTO `dark_all` with `abcd`; OSM and CARTO attribution text is present. The current code contains no CARTO key. | `frontend/src/config/mapTiles.ts`; `LightPointsMap.tsx`. A runtime success/failure is not inferred. |
| Persistence | `light_points` has decimal coordinates/address and timestamp. `integration_logs` exists; the current `aussemio.service.ts` writes metadata-only simulated records. No dedicated report-event/history table exists in `database/schema.sql`. | `database/schema.sql`; `backend/src/config/ausemioMapping.ts::mapReportToTechnicalLog`; `backend/src/services/aussemio.service.ts`; `backend/src/services/reports.service.ts`. |
| Migration topology | Runtime `runMigrations()` executes SQL from `backend/src/db/migrations/`, sorted by filename, plus an inline additive `light_points` ALTER; no migration ledger/version table is visible there. Copies also exist in `database/migrations/`. | `backend/src/db/migrate.ts`; `backend/src/db/migrations/003_admin_auth_and_batches.sql`; `database/migrations/`. Canonical ownership still belongs to P3. |
| Active report endpoint | `backend/src/routes/reports.routes.ts` defines `POST /send` but it is not mounted in `backend/src/app.ts`; the app mounts only gated local-test submission route through `mountLocalTestSubmitRoutes`. `aussemio.service.ts` is explicitly simulated and writes only technical `integration_logs`; it does not make a live AUSEMIO request. | `backend/src/app.ts`; `backend/src/routes/reports.routes.ts`; `backend/src/routes/ausemioTest.routes.ts`; `backend/src/services/aussemio.service.ts`. Do not confuse the inactive controller/router with an active API. |

## 4. Recommended map-first and geolocation flow

### Initial state

1. Render the Košice-centered map, all known light-point markers, and map controls. Show an administrative or service-area boundary overlay only after its source and product meaning have been approved; a candidate polygon is not an enforcement boundary.
2. Start at an approximately city-wide Košice extent if the app has no accepted current location. Do not default to a world view. Do not allow `fitBounds(all inventory points)` to override the chosen geolocation-centered initial state; all markers remain present even when outside the initial viewport.
3. On map entry, attempt one-shot `getCurrentPosition()` as accepted by O2. Browser permission may delay, suppress, deny, or reject access; explain the resulting state and preserve manual map selection. A compatibility fallback or recovery action does not defer or reopen the accepted entry-time attempt. Chrome's older Lighthouse advice to wait for a user action is UX guidance, not a product-decision gate.
4. If a fix succeeds, show a distinct “your device location” marker and accuracy radius, center/zoom approximately there, and leave the fault target unset. A location control recenters only; it does not select a fault target.
5. If location is denied, unavailable, unsupported, insecure-context blocked, or times out, preserve the city map and manual flow with localized, non-blocking instructions. Do not repeatedly prompt automatically. A device fix remains a visually distinct suggestion and never becomes a target implicitly. Do not label it invalid against the candidate administrative polygon; the approved boundary under §5 determines service-area validity. The city-wide initial view and other map/geolocation UI work are independent of that gate.

### Geolocation API options (proposal; no final accuracy threshold chosen)

- Use one-shot `getCurrentPosition`, not `watchPosition`, for this task.
- Recommend `enableHighAccuracy: true`, `maximumAge: 0`, and an acquisition timeout around 10 seconds. High accuracy is only a hint; it can cost more time/battery and may be ignored. The timeout does **not** bound time waiting for a browser permission decision or document visibility.
- Keep browser-provided timestamp and accuracy only in current page state. Do not treat accuracy radius as a guarantee or silently accept a threshold; acceptable accuracy and retry limits remain owner decisions.
- Denial, unavailable, timeout, unsupported, permission-policy block, and stale callback are distinct states. All allow manual selection.

### Target selection and confirmation

- Known marker selection creates `known(lightPointId)` target. It remains the strongest identity; do not infer device location from an asset or vice versa.
- Arbitrary map selection may create a provisional `custom(lat,lng)` UI selection. Treating it as a valid product target and allowing the product flow to continue to a report form require the approved boundary and its validation rule. A device fix is just a suggestion marker until the user explicitly chooses that location as a report target.
- Present a confirmation step before routing to the report form. It states whether the target is an identified light point or an arbitrary point, displays its known address/coordinates as appropriate, and offers **Continue**, **Change location**, and **Cancel**. Cancel does not create or persist an event.
- The map's “my location” action only moves the camera. It is not a target-selection action.
- Preserve precedence: confirmed `lightPointId` > manually confirmed point; device location suggestion; reverse-geocoded address suggestion. User edits override suggestions; stale async responses are discarded when target identity/sequence changes.
- Recommend passing target via in-memory/router navigation state rather than `lat`/`lng` query parameters. On refresh/deep-link without target state, return a recovery screen/map path and require re-selection; do not add precise coordinates to `localStorage` or `sessionStorage`. Router/browser history state is still session history state and must be included in the retention review.

## 5. Košice target boundary

### Evidence and recommendation

The official GKÚ ZBGIS download page states that its administrative-boundary dataset contains polygon layers for administrative units and cadastral areas, names/codes, data current as of 2026-06-30 (with listed regional exceptions that do not include Košice), and CC-BY 4.0 attribution to GKÚ Bratislava. The City of Košice reports 24,373.4 ha and 29 cadastral areas (2024 statistics). These sources establish candidate geometry and attribution only; they do not prove that the municipality boundary equals the public-lighting service territory.

**Recommendation:** polygon validation is preferable to an invented bounding box, but the product/service boundary is unresolved. The administrative Košice polygon or a union of its 29 cadastral polygons is only a candidate source. Do not enforce either as the product boundary until either (A) the owner explicitly defines the municipality administrative boundary as the product boundary independent of operator/service responsibility, or (B) authoritative evidence establishes the actual lighting service-area polygon. Record the selected geometry's source, version, transformation, and attribution. No actual boundary geometry or coordinates are synthesized in this plan.

**OWNER DECISION / EXTERNAL EVIDENCE REQUIRED:** obtain the owner definition under A or authoritative service-area evidence under B before enabling client- or server-side in/out-of-area enforcement. Coordinate syntax/range validation can be researched and tested independently. This gate blocks only service-area enforcement and dependent acceptance criteria; it does not block map entry, geolocation display/recentering, target-selection UI, or other independent UX work.

The GKÚ source CRS is S-JTSK (EPSG:5514); the map uses WGS84/Leaflet. Use a documented, tested conversion to WGS84 and preserve source attribution. Do not fetch a third-party boundary API on each report; static versioning avoids runtime dependency and moving data. The published GKÚ data source establishes CC-BY 4.0, but the final derived artifact must still carry required attribution and source date.

| Candidate | Assessment |
|---|---|
| Official municipality polygon | Official non-rectangular administrative candidate with source/license evidence. It is not a product/service boundary until condition A or B above is met. |
| Union of all Košice cadastral polygons | Candidate if this is the available official geometry; complete coverage/topology and its relationship to the lighting service territory still require evidence and approval. |
| Owner-supplied service-area polygon | Most semantically correct if the municipal boundary differs from actual lighting service; no such artifact is in this repository. Owner must identify authoritative source. |
| Bounding box | Reject as final validation: admits out-of-city locations and rejects valid edge geometry unpredictably. Useful only as a quick prefilter before polygon validation. |
| Inventory envelope plus margin | Reject as territory: an asset-distribution envelope is not a jurisdiction/service boundary and would exclude areas without current lamps or allow nearby out-of-area coordinates. |

### Validation contract

- Reject non-finite, missing, malformed, latitude outside `[-90,90]`, longitude outside `[-180,180]`, and out-of-area coordinates. Never coerce empty text to zero.
- Once a boundary is approved, define an inclusive-edge rule (`covers` semantics), coordinate-conversion tolerance, and recovery copy. Do not invent a geographic buffer.
- After boundary approval, test whether known-light-point coordinates fall within that same selected geometry; surface mismatches as data-quality issues. Do not silently impose an administrative candidate polygon on inventory or users.
- Client and backend validation must share the approved artifact; backend validation is authoritative. There is no shared workspace/package at repository root today, so implementation must verify how to distribute one approved static geometry to both builds.
- After the enforcement rule is approved, an outside point must not continue to a report target; explain the limitation and offer manual re-selection/recenter. Until approval, do not claim a point is outside the product service area based solely on administrative geometry.
- Boundary tests use artificial polygon fixtures for vertices/edges, holes/multipolygons if relevant, and inside/on/outside points only after the canonical boundary is selected. Coordinate syntax/range tests do not depend on that decision.

## 6. Reverse geocoder/provider research and recommendation

All terms below were checked 2026-10-05. They can change. Vendor privacy statements are vendor statements, not independent verification or a legal conclusion. Slovakia-specific result quality is not established by a coverage assertion; compare a small synthetic/known-public-address fixture using an approved test key before selection. Do not send actual user coordinates during provider comparison.

| Candidate | Current public terms and technical shape | Privacy, attribution, caching, prohibited-use boundary, topology and complexity | Assessment |
|---|---|---|---|
| Public OSMF Nominatim | Public Usage Policy: max 1 request/second **aggregated across the application**, valid identifying User-Agent/Referer, visible attribution, client-triggered moderate use permitted; no autocomplete/systematic queries; do not submit personal/confidential material; proxy/cache recommended, provider may change policy. No API key. Current implementation uses it for inventory plus public route. | User-derived/report-linked coordinate may be personal/confidential in context, so policy is a poor fit until specific review says otherwise. Provider-side log retention/transfer details were not established in this research. OSM response licensing/attribution applies. Keep any inventory geocoding quota shared with any future route. **Topology:** browser use can be technically client-side, but the current public 1-rps aggregate limit and shared internal callers favor one backend scheduler. **Complexity:** low adapter complexity, moderate policy/identification and shared-rate-control burden. **Prohibited/restricted uses evidenced:** autocomplete, systematic queries, and sending personal/confidential data. | Do not use for real citizen/device/report-linked coordinates. Existing inventory geocoding is a separate current behavior and should not be silently repointed in this planning change. No SLA is stated in the policy. |
| Geoapify hosted Reverse Geocoding | HTTP GET, API key required; documented reverse endpoint accepts lat/lon and returns structured address. The pricing page currently lists 3,000 credits/day and up to 5 requests/sec; its FAQ says Free-plan production/commercial use is allowed when limits, features, and attribution conditions are met. The separate Terms v5 (2024-02-02) says commercial Free-plan use is allowed in development and, **with some limitations**, in production, and directs users to contact Geoapify for details. Pricing-page statements and Terms wording are both recorded; do not treat the pricing FAQ as unconditional contractual production approval. Reverse request is one credit on the pricing-details evidence. Attribution to Geoapify and data source is required. | Vendor privacy policy says each API request stores request body, headers, IP and timestamp, generally no longer than 24 hours for successful requests; lists Cloudflare, Bunny CDN for `.eu`, and Hetzner subprocessors. Vendor offers an EU-focused endpoint option; actual endpoint/subprocessors and DPA must be reviewed. **Prohibited/restricted uses evidenced:** exceeding plan limits, unreasonable load, bypassing usage/billing controls, and distributing requests among multiple accounts/projects to fit a lower plan. Quota/account/project splitting to gain extra quota is prohibited and must not be an architecture. **Topology:** keep key and scheduler server-side; direct browser use is not recommended. **Complexity:** low-to-moderate adapter and secret/quota setup; moderate terms/privacy/attribution review. | **Conditional hosted recommendation only**, not an accepted provider. Before selection, obtain provider/owner clarification for the project's commercial/production status and applicable Free-plan limits, then confirm key, attribution, transfer, processor, and legal conditions. Do not use extra accounts/projects to bypass quota. |
| OpenCage hosted | HTTP GET reverse query, API key required in query string. Free trial: 2,500 requests/day and 1 request/sec but testing only; production is paid (pricing page showed $50/month for X-Small, 10,000/day/15 rps on evidence date). No need to attribute OpenCage itself according to FAQ; returned open-data license/source attribution may still apply. | `no_record=1` says query contents are not logged; vendor says normal query logs are deleted after six months and servers/logs remain in EU. Vendor permits indefinite result storage. **Prohibited/restricted use:** free plan is testing-only, not production; use remains subject to API rate limits, terms, and upstream data-license conditions (no broader restriction was independently established here). **Topology:** vendor recommends proxying through the app server to protect the key; client-direct use exposes the key. **Complexity:** low-to-moderate adapter, key/metering and paid-plan setup; moderate residual metadata/privacy review. API key and query share URL unless request is proxied. | Credible privacy-aware evaluation candidate; free tier is not production. Paid cost and residual request metadata/DPA terms need review. Not preferred over Geoapify for this low-volume preproduction scope without evidence of better Košice quality. |
| Self-hosted Nominatim | No external request/API key after deployment; reverse-only import mode exists. Official 5.3.2 manual supports smaller-region extracts to reduce DB size/import time and requires maintaining data/import infrastructure. | Removes hosted geocoder transfer for queries but not tile providers, app hosting, or input/browser risks. Requires PostgreSQL/resource operations, OSM updates, monitoring, and licensing/attribution. **Restricted use:** obey OSM database/data licensing and attribution; public endpoint policy no longer governs a self-hosted instance, but the operator must not republish an unrestricted public geocoder without separate capacity/abuse controls. **Topology:** backend-only. **Complexity:** high compared with one hosted reverse API: import/update pipeline, PostgreSQL storage, operations, monitoring, and availability. Official manual reports planet-scale imports can require very large storage/time; region sizing must be measured. | Research comparator only. Unnecessary for one pre-production backend and low traffic; not default. Revisit only if legal/provider terms or stable operational needs justify the maintenance. |

### Recommended provider seam

If owner and legal gates approve Geoapify, keep the browser calling a single app backend endpoint. The backend owns the key and translates provider responses to the app's small typed `addressSuggestion` contract; do not expose provider key, return raw upstream objects, or call provider directly from React. Include a provider identifier/source for truthful attribution and future switching. No automatic fallback from one hosted provider to another: it can duplicate coordinate disclosure and quota use. On provider error/overload, allow manual address/locality entry.

Do not send coordinates to a provider before the user explicitly asks for address suggestion. If a point is derived from device location, require a separate explicit target selection and disclose the external lookup before transfer where applicable. OSM public Nominatim is not an automatic fallback.

## 7. Proposed one-instance admission/abuse policy (owner approval required)

The existing `GET /api/geocode/reverse` is public and has no route-level auth/throttle/admission queue in code. CORS is not caller authentication. A public browser route remains directly callable even if the normal UI only calls it on a button; client-side restrictions alone cannot make it private.

**Proposed low-complexity pre-production settings** (engineering values, not accepted product rules):

| Control | Proposed value/behavior | Reason / limit |
|---|---|---|
| Caller scope | A dedicated report-address-suggestion operation, invoked only after target selection and an explicit user action. No generic search/autocomplete API. Server validates coordinate syntax/range before provider use; service-area checks apply only after the §5 boundary gate is resolved. | Prevents accidental map-move traffic, but path/UI semantics are not authentication. Keep inventory geocoding internal and route all provider use through the same scheduler. |
| Upstream concurrency | One active geocoder call per process. | Expected single instance, low traffic; keeps process behavior understandable. |
| Pending queue | At most 4 waiting calls; beyond that reject immediately with manual fallback. | Bounded memory and latency. Four is a small pre-production backlog, not an SLA. |
| Queue wait | Maximum 5 seconds; expired queue item is rejected without provider request. | Avoid holding old coordinates after user has moved on. |
| Queue ordering / caller fairness | FIFO may define order among unique queued requests; it does **not** guarantee fairness between anonymous callers. One caller can occupy the global queue or budget. | Per-caller, edge, token, proxy, or other admission/fairness mechanism remains an owner/engineering decision. Do not infer authentication, an IP-rate policy, or a specific fairness mechanism. If selected, test against that approved contract. |
| Provider spacing | At least 1,100 ms between upstream starts while Nominatim or an unknown provider is configured; provider-specific lower limits may tighten this, never raise without owner evidence. One scheduler covers user and inventory requests. | Matches repo config and is stricter than Geoapify 5 rps; serial scheduling fixes the current concurrent-sleep race. |
| Daily ceiling | Proposed 2,000 provider calls per UTC day for the single owner-approved provider account/application, counting all application callers, with no automatic retry. | Numeric value remains unapproved and must be reconciled with selected provider terms and all usage. No extra account/project/key distribution to obtain more quota. |
| Upstream timeout | 4 seconds, abort upstream work. No transparent retry. | Bounds open requests; manual flow is available. |
| Result cache | Proposed in-memory LRU, maximum 128 entries, TTL 10 minutes; rounded key at no finer than current 5 decimal places; expiry deletes entries, restart clears them. No database/shared cache. | Low-memory, short task reuse; still holds potentially identifying coordinate+address in process memory. Owner/legal review may select no result cache. If provider requires caching (Nominatim policy recommends it), do not omit its terms. |
| In-flight duplicates | Coalesce only identical canonicalized coordinates while one lookup is pending; subscribers receive the same result/error; discard if the report target sequence changed on the client. | Avoid duplicate upstream calls without keeping a durable dedupe ledger. |
| Rejection/fallback | Queue full/expired/daily cap or other pre-provider rejection: explicit “address suggestion unavailable; enter it manually” response. Exact status/headers are still open. Never call another provider automatically. | Status contract and any caller-specific response remain owner-approved API design. All rejections preserve report flow. |
| Metrics/logs | Aggregate counters only: provider, outcome class, coarse latency/queue buckets, cache hit/miss, UTC hour/day. No URL/query, coordinates, address, report ID, IP, user agent or raw upstream body. Short-lived in-memory counters preferred. | Retention and any external monitoring sink need owner/legal review; code cannot establish deployment logs. |

The queue and limiter coordinate one Node process only. A second backend instance gives each process its own queue/cache/counter and can exceed application-wide provider limits. Before adding replicas, choose a shared coordinator or a single geocoder worker/egress service and re-open cost/privacy/availability analysis; do not add distributed infrastructure preemptively. FIFO is only an ordering rule; one anonymous caller may occupy global pending capacity or budget, and no fairness guarantee is claimed.

## 8. Coordinates, duplicate history, and persistence proposal

### Coordinate lifetime and privacy boundary

- Device coordinate, accuracy and timestamp: memory only in current map flow; clear on cancel, successful target transfer, route exit, or page teardown. No browser storage, URL, analytics, or automatic logs.
- Arbitrary map target: hold in router/app state only through confirmation and current report flow. The current query-string behavior is observable in `MapCustomLocationLayer.tsx`; replace it only in a separately approved implementation. If refresh loses state, return to map/reselect instead of writing precise coordinates into storage.
- Provider request: only after explicit lookup and legal/provider gate. Strip coordinates from app errors, tracing, access logs, and metric labels. Provider receives the coordinate by definition and may process network metadata; disclose that flow before enablement.
- Inventory coordinates remain durable in `light_points` as current system data; they are not a citizen device location. A report relation can nevertheless make a known location/user event more sensitive in context.
- No coordinate-bearing event or generic `integration_logs` payload for duplicate history. `integration_logs` currently contains a metadata-only simulated entry but remains distinct from actual issue lifecycle.
- Google Maps fallback, if later approved, must be an optional explicit external link, not automatic; see §9.

### Proposed known-light-point event whitelist

Duplicate assistance applies only when a confirmed `lightPointId` exists. An arbitrary coordinate has no `lightPointId`, no report history row and no duplicate count.

Candidate minimal fields:

| Field | Why needed | Constraint / treatment |
|---|---|---|
| `id` | Stable row identity for admin/debug correlation. | Database generated UUID or identity; no user-facing identifier required. |
| `light_point_id` | Restrict events to a known asset and enable history counts. | `NOT NULL` FK to `light_points`; proposed `ON DELETE RESTRICT` so history cannot silently orphan. Asset delete/archive behavior must be checked before adopting. |
| `created_at` / event time | Order/count reporting events. | `TIMESTAMPTZ NOT NULL DEFAULT now()`; server assigned, stored/queried as UTC; render local Europe/Bratislava. Do not use device clock. |
| `accepted_at` | Anchor a user-visible count to the time acceptance was confirmed, rather than confusing attempt creation time with external acceptance time. | Nullable `TIMESTAMPTZ`; server assigned only on authoritative transition to `accepted`. Proposed constraint: `submission_state='accepted'` requires non-null `accepted_at`; other states leave it null unless an approved reconciliation rule says otherwise. Whether a rolling count uses `accepted_at` or attempt `created_at` remains an O10 owner decision. |
| `fault_type_code` | Optional category-aware counts. | Required only for a valid service-2 category; `CHECK` against confirmed current VO codes or a canonical lookup table. No service-16/CSS values. |
| `location_block_code` | Potentially useful category breakdown. | Nullable and only if product demonstrates need; `CHECK` against current VO block codes. Omit if not needed. |
| `source` | Distinguish public web form from admin/internal sources. | Small controlled enum/check (initially `public_web_form` only); no arbitrary text. |
| `submission_state` | Avoid treating local simulation as accepted. | Controlled states such as `simulated`, `pending`, `accepted`, `rejected`, `unknown` require exact live contract/owner decision. Only authoritative `accepted` rows feed “previously reported” count. Never use `open/resolved` without an authoritative lifecycle integration. |
| `external_reference` | Operator correlation if a reference is legitimately returned in future. | Nullable; opaque reference only; store only for accepted external result if actual response contract permits; no full payload or URL. |

Normally exclude: name/email/phone, detail/free text, attachments/photo bytes or file names, exact device/custom coordinates, report multipart body, IP, User-Agent/fingerprint, auth/session token, and raw provider/AUSEMIO request/response. A point ID + category + timestamp can still be identifying in context; minimization does not itself prove non-personal status.

### State and transaction semantics (proposal; live AUSEMIO remains prohibited)

1. Local simulated form result is not a real report and must not enter duplicate history. Existing `integration_logs.status='simulated'` remains technical evidence, not accepted/open/resolved history.
2. If a future authorized external adapter needs durable attempt outcomes, create a metadata-only pending event in a short PostgreSQL transaction before the external request; commit before network I/O. Do not hold a DB transaction open across HTTP.
3. After a definitive provider response, update the event in a second transaction to an owner-defined state. Timeout/connection loss after dispatch is `unknown`, not `rejected` and not `accepted`; do not retry automatically absent an agreed idempotency/reconciliation contract.
4. Only confirmed `accepted` events count in duplicate-history UX. An event does not mean a fault is unresolved. Display wording such as “Reported recently” / “N reports in the last [owner-defined period]”; never “open”, “active”, or “unresolved”.
5. If the upstream response says accepted but the database update fails, the durable row remains pending/unknown and is not counted. Surface the uncertainty honestly; do not resend automatically. Reconciliation/retention is a later owner decision.
6. Use database constraints for FK, timestamp non-null, controlled state/source/category values, accepted-state timestamp consistency, and non-empty receipt when present. Add an index beginning `(light_point_id, created_at DESC)` for attempt/admin ordering and a partial accepted-state index on `(light_point_id, accepted_at DESC)` for counts if owner selects acceptance time; confirm query plan with a disposable PostgreSQL database. If count time remains attempt `created_at` or category counts are approved, test the corresponding index before adding it.

### Retention and migration gates

- The report-history time window and table-retention period are not the same: to answer a rolling window, retain at least that window plus a bounded deletion delay. Owner must select a finite period and deletion process; qualified legal review must validate purpose/basis/retention and backups/logs.
- Do not preserve previous values or add `mappingVersion`/compatibility mapping. Owner-provided pre-production state says old report/category values need no backfill. This is not independent runtime DB evidence.
- Before any schema change, P3 must select the canonical migration source. Currently runtime migration code uses `backend/src/db/migrations/` and an inline ALTER while duplicates live in `database/migrations/` (`backend/src/db/migrate.ts`).
- Once approved, make only an additive migration for the event table; no historical report mapping migration. Test empty schema, constraints, transaction boundaries, acceptance/unknown transitions, rollback, and concurrent counts against real disposable PostgreSQL matching supported major version. Mocks alone are insufficient for persistence claims.
- Do not store a full event for arbitrary coordinates. A static event row for every anonymous custom point would not support the required duplicate model and increases retention risk.

## 9. Google Maps fallback and tile-provider findings

### Google Maps coordinates link

Google Maps URLs can display/search a coordinate with a universal URL, work on Android/iOS/browser, and do not require a Google API key. That confirms technical feasibility. Clicking the link sends the coordinates to Google in the URL and hands off to the Google Maps app or browser. It is a new third-party disclosure; it is not a private/local fallback. Use only a clearly labelled user-click action with an external-service disclosure, `noopener`/`noreferrer`, and no automatic redirect. Provide **copy coordinates** as the local fallback. **Verdict:** technically feasible; product approval and qualified privacy/legal review are still required before enabling it. No legal or terms approval is made here.

### Tiles

| Provider | Official current evidence | Recommendation |
|---|---|---|
| OSM standard raster | OSMF Tile Usage Policy requires exactly `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, visible OSM attribution, browser User-Agent/Referer, HTTP cache honoring; no offline/prefetch; no personal/confidential data; availability best effort with no SLA. Current code uses `{s}.tile...` and subdomains, not the specified canonical URL. Browser sends viewed tile coordinates and network metadata to provider. | For low-traffic pre-production, keep an OSM-derived option only after switching to canonical URL and confirming app contact/referrer policy and attribution. This does not guarantee uptime. Provider selection still owner gate. |
| CARTO dark tiles | Terms last updated 2026-09-29 require a CARTO-issued API key; require visible OSM+CARTO attribution; free fair-use cap currently 5M tile requests/month non-commercial and 1M/month commercial; unkeyed responses may carry a watermark. Current code has a CARTO URL and attribution but no key. | Do not rely on current unauthenticated URL. Either owner accepts key-backed CARTO after registration, key restrictions, terms/privacy review and quota monitoring, or choose another dark style/provider. No key is added in this task. |
| Geoapify maps (candidate) | Free-plan pricing allows 3,000 credits/day; tile requests are metered and require key; provider/data attribution required; privacy policy describes request metadata and processors. | Credible single-provider option for geocoding plus tiles, but combines two data flows and more user request data to one provider. Compare only if privacy review approves; do not imply fewer disclosures. |

**Practical proposal:** one owner-selected provider/style per mode. Simplicity favors OSM canonical raster for light appearance and a licensed key-backed source for dark appearance; alternatively use one approved hosted provider for both. Map/tile requests should remain independent of report target and must never carry user/report IDs or coordinates as custom URL parameters.

## 10. Accessibility and browser/device test baseline

Recommended support target: current and previous stable major versions of Chromium-based desktop/mobile browsers, Firefox desktop, and Safari/iOS Safari where manual devices are available; keep a manual non-map path so the map is not the only operable control surface. “Supported” does not mean every browser/device, browser permission setting, or assistive technology combination.

| Matrix | Required checks |
|---|---|
| Chromium desktop and Android/mobile Chromium | Map-first layout, tile/data failure, touch target operation, granted/denied/unavailable/timeout geolocation, foreground/background/permission change, viewport/text scaling. |
| Firefox desktop | Map/markers, selection/confirmation, focus order, permission states and late async response. |
| WebKit automated project | Core route/target flow and layout at mobile viewport. Playwright WebKit is not branded Safari; treat as engine coverage only. |
| Native Safari on iOS (manual) | Permission prompt/persistence/revocation, OS location off, app/browser handoff, touch, viewport safe areas, keyboard/VoiceOver spot checks. Do not infer native Safari behavior from emulation. |
| Keyboard-only / screen reader | Select known target without pointer; accessible alternative for custom point; labelled controls, visible focus, dialog focus management, live status/error announcements, no keyboard trap, reading order and changed-target announcement. |
| Reduced motion / zoom / text size | Map controls remain usable; no essential information communicated by animation/color alone; confirmation/action UI reflows without clipping at 200%/400% where applicable. |
| Map unavailable fallback | Manual Košice locality/target route is reachable and completes with keyboard/touch when tiles, light-point API, or JS map interaction fail. |

Target WCAG 2.2 AA as a project acceptance goal. Pay particular attention to keyboard operation, focus visibility, status/error announcements, reflow, target size (2.5.8 minimum 24 CSS px subject to its exceptions), contrast, labels, and map alternatives. Automated axe is supporting evidence only, not a conformance determination. The current Playwright config uses one Desktop Chrome project (`frontend/playwright.config.ts`) and guards E2E behind `PROCESS_EGRESS_ISOLATED=1`; existing E2E setup blocks service workers and confines test API base URLs to loopback. Keep those network-egress boundaries when adding browser projects.

## 11. Tests-first implementation phases (future authorization required)

Every behavior phase starts by adding tests that fail against current behavior. No tests or implementation were added/run here. Use fake geocoder transport and synthetic coordinates; block all non-loopback network requests in E2E; verify no AUSEMIO request can be made. Acceptance assertions are finalized only after the corresponding O gate is resolved.

### Phase 0 — decision and evidence closure (no production changes)

Before provider-backed coordinate transfer, resolve O5/O6/O12 and applicable notice/contract details. Resolve O7 details before any coordinate persistence/logging. Resolve O9 before provider replacement or increasing tile use. Resolve O10 and P3 migration policy before event persistence. Resolve O11's numeric and caller/admission contract before fixing dependent acceptance criteria. The Košice service-boundary decision gates only in/out-of-area enforcement and its related tests; it does not block independent map/geolocation UI work. O2's entry-time attempt is accepted and does not wait for another product decision. Literature/standards consultation must happen before decisions whose thesis rationale depends on it; P7 only transfers already verified evidence.

### Phase 1 — boundary and target state tests

1. Pure coordinate syntax tests first: finite/WGS84 range, missing/malformed values, and no empty-string-to-zero coercion. These do not depend on the unresolved service-area geometry.
2. Component tests: all known markers remain represented; map initial city extent; exact confirmation/cancel; no report created from the recenter control. These UI tests can proceed independently from the boundary gate.
3. Boundary enforcement tests are gated until condition A or B in §5 is resolved. Then add polygon inside/on-edge/outside, multipart/hole if present, known asset fixture validity, client feedback, and authoritative server decision.
4. API/contract tests: after boundary approval, final server-side area validation; malformed/duplicate query handling; known asset ID remains authoritative; custom point is only created by explicit user selection; service-16 never generated.
5. E2E: map unavailable/manual fallback, focus and route transition, no lat/lng in URL. Use loopback-only stubs and synthetic geometry.

### Phase 2 — geolocation and map behavior tests

1. Assert exactly one initial one-shot `navigator.geolocation` attempt on map entry; no additional automatic attempts on pan, target selection, or ordinary rerender.
2. Cover granted, denied, unavailable, timeout, unsupported, insecure context/Permissions-Policy denied, delayed/suppressed prompt behavior, stale callback/unmounted component, and poor accuracy. Verify graceful city-map/manual fallback if the platform does not complete the initial attempt. Exercise a synthetic position outside the eventual approved boundary only after §5 is resolved; until then test marker/target separation without asserting service-area invalidity.
3. Confirm marker is visually distinct and shows uncertainty; recenter moves camera only; selecting device point is a separate action; no silent target creation/replacement.
4. Verify with and without a fix the accepted initial viewport and that inventory `fitBounds` cannot override the chosen center; all markers stay loaded.
5. Run across Chromium, Firefox, WebKit; manually validate native iOS Safari permission/device behavior before support claim.

### Phase 3 — confirmation, precedence and address suggestion tests

1. Known-light-point target, arbitrary point, and explicitly selected geolocation target each display correct confirmation. Continue routes only after confirm; cancel preserves map without event.
2. Target precedence tests: known ID beats device location; manually selected target beats prior suggestion; user edit wins; changing target resets only per accepted current form behavior; stale async lookup response cannot overwrite newer target/edit.
3. Assert zero reverse-geocode calls on pan/drag/keystroke/mount; exactly one on explicit lookup (coalesce repeated pending request).
4. Address response visibly marked automatic, editable, and manually replaceable. No result, provider failure, timeout, queue full and daily cap preserve manual submit path.
5. Assert local/simulated submit cannot fall back to `/api/reports/send` or any live external submit transport, including on local transport failure.
6. Google Maps fallback has no test/implementation path unless O6/O12/privacy/terms review approves it. If approved, test explicit external link only and no auto navigation; include copy-coordinates alternative.

### Phase 4 — reverse-geocoder service gateway tests

1. Fake transport tests for provider mapping, 4-second abort, queue expiry, queue full, daily limit/reset, FIFO order, one active call, 1,100ms spacing, identical in-flight coalescing, cache LRU/TTL/expiry/eviction, provider 4xx/429/5xx/network/invalid JSON, and no automatic retry/fallback.
2. For every request rejected before upstream start, assert the fake provider call count remains zero and no provider quota unit is consumed: malformed/invalid coordinate; caller/admission-policy rejection if an approved policy exists; queue-full; queue-expired before upstream work starts; daily/application-cap rejection; and every other pre-provider overload path in the final contract. If an upstream call has already begun before timeout/cancellation/expiry, do not assert zero calls; assert the correct single started call and no retry instead.
3. Verify both interactive lookup and existing inventory jobs share the selected provider limiter; no request stream bypasses it. Assert provider spacing/call-count and quota accounting at the transport boundary.
4. Abuse boundary: route only accepts the report address-suggestion contract, no general search/autocomplete, invalid service/target rejected, global caps apply, no raw IP/coordinates in logs. Any test that a caller cannot monopolize capacity must be parameterized by the eventually approved per-caller/edge admission policy; FIFO alone does not satisfy it.
5. Egress test: intercepted fake provider only, block all public outbound; assert zero real geocoder and zero AUSEMIO calls.

### Phase 5 — event persistence (only after O10/O12/P3)

1. Before persistence implementation, start with failing integration tests against a real disposable PostgreSQL instance of the supported major version. Apply the P3-selected migration to a fresh database, then invoke the canonical migration mechanism again according to P3's policy (skip an already-recorded migration where that is the policy, or re-execute if the selected contract requires idempotency). Verify no duplicate schema objects, rows, constraints, side effects, or invalid states; verify the resulting schema/data is equivalent after the repeated run. Where migration idempotency is selected, explicitly reapply that migration and assert equivalence. This test does not select the migration directory or policy; P3 must do so first.
2. Add failing checks for additive DDL from clean schema, FK/check/defaults, category validity, index-supported counts, transaction commit/rollback, concurrent count/insert, status transition and retention deletion.
3. Assert local simulated event is never counted or inserted into report history; arbitrary coordinates never create an event; only a known light point can.
4. Assert whitelist persistence exactly: lightPointId, server event time, approved VO category/block, fixed source, controlled state, optional legitimate receipt. Assert contact/free text/attachments/device/custom coords/IP/fingerprint/raw payload absent from SQL, DB row, API history response, and logs.
5. Test pending → accepted/rejected/unknown; acceptance counts only authoritative accepted; timeout after dispatch becomes unknown; no automatic retry; DB failure after provider acceptance does not trigger resend. Use fake external adapter only.
6. Test rolling window edge precisely in UTC, timezone display in Europe/Bratislava across DST, category count only if accepted, and message never equates reported with unresolved.
7. P3 chooses migration source and execution policy before these tests; owner-provided preproduction state means no historical mapping/data backfill or compatibility layer. This persistence-only prerequisite does not block unrelated map/geolocation phases.

### Phase 6 — accessibility, browser and integrated regression

1. Keyboard-only, screen reader, mobile touch, map fallback, 200%/400% zoom/reflow, reduced-motion, visible focus, live status/error, confirmation focus, and target-size checks.
2. Run Vitest unit/component, browser E2E against loopback only, both app test-source typechecks, builds, full required GitHub CI and disposable PostgreSQL tests when persistence exists.
3. No real provider credentials in test jobs; no production AUSEMIO URL can pass outbound guard. Record independent audit and remaining limitations before implementation checkpoint close.

## 12. Traceability and open questions

| Requirement / criterion | Tests first | Implementation/result later | Validation evidence | Independent audit | Thesis evidence |
|---|---|---|---|---|---|
| Map-first with Košice fallback and all assets | Phase 1/2 component + browser | Not started; `LightPointsMap`/`MapPage` seam | Not run in this planning checkpoint | Pending | Link this plan + browser/UX standards evidence |
| Entry-time geolocation attempt, distinct marker, no implicit target | Phase 2 unit/component/E2E | Not started; browser geolocation adapter + map state | Not run | Pending; browser compatibility fallback still needs validation | W3C + Chrome source refs below |
| Košice-only confirmed target | Coordinate syntax tests may proceed; polygon/API enforcement waits on §5 gate | Not started; shared approved boundary + backend validation | No geometry imported or runtime-tested in this checkpoint | Pending; owner defines municipality boundary or authoritative service-area evidence is obtained | GKÚ candidate dataset/CC-BY source |
| Explicit editable address suggestion and safe fallback | Phase 3 component/API | Not started; backend provider gateway | No live provider requests | Pending O5/O6/O11 | Provider policies + privacy note |
| Product-scoped bounded geocoder + no general-purpose abuse path | Phase 4 fake transport/API, including zero-call assertions for pre-provider rejection | Proposed only; current route remains as-is | No load or abuse test performed | Pending numeric and caller/edge parts of O11 | Policy/API documentation |
| Minimized target state and no precise URL/log persistence | Phase 3/5 assertions | Not started; router state and redacted logging | No runtime privacy test performed | Pending O7/O12 | GDPR/EDPB/SK source list |
| Known-point-only event counts | Phase 5 disposable PostgreSQL | Not started; additive table only after P3 | No DB writes/schema tests run | Pending O10/O12 | DB/data-minimization literature if cited in thesis |
| Accessibility/browser contract | Phase 6 keyboard/AT/device matrix | Not started | No conformance claim/test run | Owner direction accepted; exact support matrix and implementation evidence pending | WCAG 2.2 + browser standards |

Questions still open:

1. Which condition establishes the Košice enforcement boundary: explicit owner definition of the municipality boundary as product scope independent of operator responsibility, or authoritative evidence of the lighting service-area polygon?
2. Is Geoapify acceptable for the actual coordinate transfer, project use, applicable Free-plan limitations, account/endpoint, attribution, DPA/subprocessors, and notice? Provider confirmation is required; quota must not be expanded by account/project splitting.
3. Which map/tile providers and key/referrer/privacy conditions are accepted?
4. What event states, count period and time anchor, retention/deletion/backups, access rules, category/block presentation, and external-reference semantics are desired?
5. What concrete O11 queue/cap/timeout/cache/rejection values and anonymous caller/edge fairness contract are approved? FIFO alone is not a fairness guarantee; tests depend on the approved policy.
6. Is an approved non-production AUSEMIO/staging environment and documented acceptance response in scope for some future checkpoint? This task does not authorize live writes; service 16/CSS remains out of scope.
7. Which migration source and execution/idempotency policy will P3 select, and who owns DB restore and retention in the actual deployment?
8. Which controller/processor roles, lawful basis, notice, rights handling and impact assessment apply? Qualified legal review required; not determined by this repo or plan.

## 13. Official source register

Sources checked 2026-10-05 unless a version/date is explicitly given. Quotas, terms, and provider privacy statements must be rechecked before implementation.

| Topic | Official/primary source and version/date | Evidence used / limit |
|---|---|---|
| Geolocation API | [W3C Geolocation Candidate Recommendation Snapshot 2026-03-26](https://www.w3.org/TR/2026/CR-geolocation-20260326/) | Secure context, express browser permission, WGS84/accuracy radius, one-shot/watch methods, timeout vs permission wait, `maximumAge`, high-accuracy battery/latency. Guidance is not this product's legal basis. |
| Permission prompt timing | [Chrome Lighthouse: requests geolocation permission on page load](https://developer.chrome.com/docs/lighthouse/best-practices/geolocation-on-start) (official page; guidance last updated 2019-05-02) | Says avoid page-load request; ask after user action and offer fallback. It establishes Chrome's guidance/UX risk, not that all browsers technically reject automatic calls. |
| Geolocation API support | [MDN Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API) (checked 2026-10-05) | Broad modern support and secure-context note; implementation behavior and permission UI still vary. |
| Košice stats | [Official City of Košice cartographic data](https://www.kosice.sk/city/basic-information-cartographic-data) (2024 figures; checked 2026-10-05) | Area 24,373.4 ha; 29 cadastral areas. Does not define public-lighting service area. |
| Boundary data/license | [GKÚ ZBGIS downloads](https://www.skgeodesy.sk/gku/produkty-sluzby/na-stiahnutie/zbgis.html) (data current 2026-06-30; CC-BY 4.0; checked 2026-10-05) | Official polygon administrative/cadastral boundaries, CRS S-JTSK; establish source and attribution, but final selected Košice geometry must be retrieved/verified separately. |
| Public Nominatim | [OSMF Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/) and [Reverse API manual](https://nominatim.org/release-docs/latest/api/Reverse/) (manual 5.3.2; checked 2026-10-05) | Aggregate max 1 rps, identification/attribution, no personal/confidential data, no autocomplete; nearest suitable object not exact interpolation. |
| Geoapify | [Pricing](https://www.geoapify.com/pricing/), [Reverse Geocoding docs](https://apidocs.geoapify.com/docs/geocoding/reverse-geocoding/), [Terms v5 dated 2024-02-02](https://www.geoapify.com/terms-and-conditions/), [Privacy Policy](https://www.geoapify.com/privacy-policy/) | Pricing page currently lists 3,000 credits/day and up to 5 rps, and says production/commercial Free use is allowed under plan limits/attribution. Terms v5 qualifies production use as subject to limitations and says to contact Geoapify for details; terms prohibit quota/billing circumvention, including distributing calls among multiple accounts/projects. Treat production eligibility as unresolved provider-contract review. Privacy/retention claims remain vendor statements requiring review. |
| Geoapify EU endpoint | [Geoapify GDPR/location APIs guidance dated 2026-08-27](https://www.geoapify.com/maps-geocoding-routing-apis-gdpr-compliant-application/) | Vendor describes `api-eu.geoapify.com` path and processors; a vendor statement, not independent verification or a compliance conclusion. |
| OpenCage | [Pricing](https://opencagedata.com/pricing), [API v1 docs](https://opencagedata.com/api), [GDPR/privacy](https://opencagedata.com/gdpr), [Terms](https://opencagedata.com/terms), [FAQ](https://opencagedata.com/faq) | Free trial is testing-only at 1 rps/2,500 daily; paid production tier; `no_record`; EU/log retention claims; indefinite result storage and attribution FAQ. Vendor statements. |
| Nominatim self-host | [Nominatim 5.3.2 Import manual](https://nominatim.org/release-docs/5.3.2/admin/Import/) | Regional extract reduces import size/time; import/update operations are nontrivial. Published planet estimates are not Košice sizing. |
| OSM raster tiles | [OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) (checked 2026-10-05) | Canonical URL, attribution, cache, no prefetch/offline, no personal/confidential data, best effort/no SLA. |
| CARTO basemaps | [CARTO Basemaps Terms](https://carto.com/legal/basemap-terms/) last updated 2026-09-29; [key/pricing page](https://carto.com/basemaps/apikey/) | API key required, attribution, 5M/month non-commercial and 1M/month commercial free limits on checked terms; unauthenticated watermark possible. |
| Google Maps fallback | [Google Maps URLs docs](https://developers.google.com/maps/documentation/urls/get-started) | Coordinate search URL supported across platforms, no API key; click transfers coordinates to Google. Legal/privacy acceptability not determined. |
| EU data protection | [GDPR Regulation (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng) | Articles 4, 5, 6, 13, 25 and 35 are relevant starting points; no lawful basis/compliance conclusion is made. |
| Slovak privacy law | [Act 18/2018 Z. z., effective-time version 2026-08-18](https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/2018/18/20260818) | Current official Slov-Lex version; qualified Slovak review is required to establish application and interaction with EU law. |
| EDPB principles/design | [EDPB Basic Principles](https://www.edpb.europa.eu/topics/key-gdpr-concepts/basic-principles_en); [Guidelines 4/2019 v2.0](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_201904_dataprotection_by_design_and_by_default_v2.0_en.pdf) | Data minimization, purpose, storage limitation, access limits, deletion/anonymization principles. Not a product-specific legal opinion. |
| Accessibility | [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) (Recommendation 2023-10-05) | Proposed AA target and success criteria; does not itself prove conformance. |
| Browser testing | [Playwright Browser docs](https://playwright.dev/docs/browsers), [device emulation](https://playwright.dev/docs/emulation) (checked 2026-10-05) | Playwright supports Chromium/Firefox/WebKit and emulation; Playwright WebKit is not branded Safari/iOS Safari. |

## 14. Readiness and validation performed

- Inspected repository structure, current map/form/geocoder/report services, routes, database schema/migrations, configuration, and test/browser configuration at the SHA above.
- Read the owner request and preserved owner-provided facts as such; did not query a runtime database.
- Checked official primary/official sources listed in §13 on 2026-10-05; separated provider assertions, technical facts, recommendations, and legal unknowns.
- No AUSEMIO URL was opened. No live geocoder requests, production writes, tests, builds, dependency commands, or schema operations were run.
- Documentation/static validation only is permitted. Independent audit remains pending for this new amendment.

**Current state:** P2c owner-decision research and implementation plan is ready for independent plan audit. O1–O4, O8, and the minimized-coordinate/product-only directions in O5/O7/O10/O11 are accepted; provider selection/contracts, exact O7/O10/O11 sub-decisions, O9, and the Košice enforcement boundary remain open. O6/O12 require qualified legal review. No production implementation or live coordinate transfer is authorized by this document. Service 16/CSS remains out of scope.

`P2C OWNER-DECISION RESEARCH + IMPLEMENTATION PLAN READY FOR INDEPENDENT AUDIT`
