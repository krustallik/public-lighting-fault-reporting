# P2c Phase A implementation draft

## Status

Draft implementation on `feature/p2c-implementation-draft`; not merged and not approved for production release. The Phase A map, geolocation, target-selection and confirmation flow is implemented locally. The exact service-area enforcement activation remains blocked until the owner either selects the Košice municipal boundary as the product boundary or authoritative evidence supplies the lighting service-area boundary. No geometry was invented.

## Implemented behavior

- `/map` is the primary entry. Known database light points remain available through markers and an accessible point list. Data, tile, or map-render failure leaves a manual form continuation available.
- Map entry requests browser geolocation with a fresh, high-accuracy hint. A usable fix centers the map and appears as a distinct marker with its reported accuracy radius; otherwise the initial Košice city view remains. Recenter only moves the map. Selecting device location as a target and confirming it are separate actions.
- Map points, known light points, device points, and manual continuation each use an accessible confirmation dialog. Cancel preserves the current selection and returns focus. Late location callbacks do not move the map after a newer selection or manual coordinate entry begins.
- Target data transfers through React Router state. The report URL contains no coordinates or point ID, and no app-controlled local/session storage is used. A direct report entry without recognized router state returns to the map. Browser history state may survive reloads; its exact lifetime remains part of the O7 retention review. Known-point form autofill/user-edit precedence remains in place. Device targets are identified separately from custom map targets.
- No reverse-geocoding call, report-history persistence, local/session storage for target coordinates, exact-coordinate analytics, or AUSEMIO transport was added. Service `2` / VO remains the only product flow; service `16` / CSS remains out of scope.

## Service-area and provider gates

`backend/src/domain/serviceArea.ts::classifyServiceAreaPoint` is a generic server-side classification seam with synthetic unit tests for inside, boundary, outside, malformed input, holes, and an unconfigured boundary. It is not wired into an API route or used as an enforcement decision. Known database light points continue through their existing path. Custom-target production enforcement remains blocked pending the owner boundary decision and authoritative geometry; edge inclusion also remains undecided.

The existing OSM/CARTO tile configuration was not changed. Automatic centering on device coordinates changes which existing tile areas the browser requests, so provider terms, disclosure, and privacy review under O9 remain necessary before production use. Browser E2E fixtures fulfill recognized map tiles with synthetic image bytes and block every other non-loopback request; E2E was not run locally because `frontend/playwright.config.ts` requires the proven process-egress namespace. That guard was not bypassed.

## Validation on the draft

- Frontend unit/component tests: **149 passed** across 17 files.
- Frontend test-source typecheck: **passed**.
- Frontend build: **passed**; Vite reports a large-chunk advisory (>500 kB).
- Backend tests: **56 passed** across 8 files.
- Backend test-source typecheck and build: **passed**.
- Browser E2E and the Linux process-egress containment workload: **not run** in this Windows environment; browser E2E remains subject to the configured isolation guard.
- No dependencies, database schema/migrations, or application persistence behavior were changed. No AUSEMIO page/network access or production write occurred.
