# P2c Phase A implementation draft

## Status

Draft implementation on `feature/p2c-implementation-draft`; not merged and not approved for production release. The Phase A map, geolocation, target-selection and confirmation flow is implemented locally. The exact service-area enforcement activation remains blocked until the owner either selects the Košice municipal boundary as the product boundary or authoritative evidence supplies the lighting service-area boundary. No geometry was invented.

## Implemented behavior

- `/map` is the primary entry. Known database light points remain available through markers and an accessible point list. Data, tile, or map-render failure leaves a manual form continuation available.
- Map entry requests browser geolocation with a fresh, high-accuracy hint. Until the O9 tile-provider decision is approved, the map stays on the default Košice view rather than expanding tile requests around an exact device-derived position. The fix remains separately selectable as a report target only after explicit confirmation; city/manual fallbacks remain available.
- Map points, known light points, device points, and manual continuation each use an accessible confirmation dialog. Cancel preserves the current selection and returns focus. Late location callbacks do not move the map after a newer selection or manual coordinate entry begins.
- Target data transfers through React Router state. The report URL contains no coordinates or point ID, and no app-controlled local/session storage is used. A direct report entry without recognized router state returns to the map. Browser history state may survive reloads; its exact lifetime remains part of the O7 retention review. Known-point form autofill/user-edit precedence remains in place. Device targets are identified separately from custom map targets.
- No reverse-geocoding call, report-history persistence, local/session storage for target coordinates, exact-coordinate analytics, or AUSEMIO transport was added. Service `2` / VO remains the only product flow; service `16` / CSS remains out of scope.

## Service-area and provider gates

`backend/src/domain/serviceArea.ts::classifyServiceAreaPoint` is a generic server-side classification seam with synthetic unit tests for inside, boundary, outside, malformed input, holes, and an unconfigured boundary. It is not wired into an API route or used as an enforcement decision. Known database light points continue through their existing path. Custom-target production enforcement remains blocked pending the owner boundary decision and authoritative geometry; edge inclusion also remains undecided.

The existing OSM/CARTO tile configuration was not changed. Automatic device-coordinate centering is disabled because it expands tile requests around a precise position before provider terms, disclosure, and privacy review under O9. Device target selection and confirmation remain available, and no location-derived tile request is initiated by application camera code. Browser E2E fixtures fulfill recognized map tiles with synthetic image bytes and block every other non-loopback request; E2E was not run locally because `frontend/playwright.config.ts` requires the proven process-egress namespace. That guard was not bypassed.

## Prompt-7 targeted correction

The implementation draft keeps the O9-dependent device recenter sub-feature disabled pending the owner tile-provider decision. Queue admission now counts requests waiting on start-spacing against `maxPending`; request disconnect cancels queued lookups and aborts active provider work when no coalesced caller remains. Local test receipt responses omit submitted fields and file names, returning only status and aggregate file count. These are draft corrections, not production approval.

## Prompt-7 correction validation (2026-10-06)

- Frontend unit/component suite: `frontend/node_modules/.bin/vitest.cmd run` — **156 passed / 18 files**.
- Backend suite: `backend/node_modules/.bin/vitest.cmd run` — **94 passed / 10 files**.
- Frontend test-source typecheck (`tsc -p tsconfig.test.json --noEmit`), app typecheck (`tsc -b`), backend test-source typecheck, and backend build (`tsc`) — **passed**.
- Frontend Vite build — **passed** with the existing advisory that the main minified chunk exceeds 500 kB.
- Browser E2E was attempted with `frontend/node_modules/.bin/playwright.cmd test` and stopped at the configured guard before launching a browser or server: `PROCESS_EGRESS_ISOLATED=1` is required. The guard was not bypassed. The Linux process-egress containment workload cannot be run from this Windows host and remains for isolated CI.
- No SQL/schema check applied because no database files changed. Tests used synthetic fixtures and fake provider transports; no AUSEMIO or external geocoder request was made. Remote CI evidence is recorded separately after the branch push.

## Initial implementation validation (before Prompt-7 targeted corrections)

- Frontend unit/component tests: **149 passed** across 17 files.
- Frontend test-source typecheck: **passed**.
- Frontend build: **passed**; Vite reports a large-chunk advisory (>500 kB).
- Backend tests: **56 passed** across 8 files.
- Backend test-source typecheck and build: **passed**.
- Browser E2E and the Linux process-egress containment workload: **not run** in this Windows environment; browser E2E remains subject to the configured isolation guard.
- No dependencies, database schema/migrations, or application persistence behavior were changed. No AUSEMIO page/network access or production write occurred.
