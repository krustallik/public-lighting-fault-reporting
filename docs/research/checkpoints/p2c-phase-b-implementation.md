# P2c Phase B implementation draft

## Status

Phase B local implementation draft on `feature/p2c-implementation-draft`; not merged and not approved for production release. Explicit report-address suggestion UI and a provider-independent, bounded backend seam are implemented. Production external reverse-geocoder transport remains disabled.

## Implemented behavior

- The report form shows an explicit `Navrhnúť adresu podľa polohy` action only for a confirmed custom-map or device-derived target. It does not request an address on form mount, target selection, map activity, or typing. The selected coordinates are displayed and can be copied locally; no external-map link or automatic Google Maps transfer is present.
- Address results can fill the detail field and an exact matching VO locality. The form identifies the result as an automatic suggestion and asks the user to review it. Both fields remain editable. The existing `AutofillPrecedenceTracker` preserves manual edits across later responses. Abort/sequence/target-identity checks discard stale responses and pending requests are aborted on target change/unmount.
- If suggestion fails or is disabled, manual locality/detail entry remains available. Known light-point inventory autofill continues on its separate path.
- The client uses `POST /api/reports/address-suggestion` with a strict JSON contract: numeric WGS84 latitude/longitude, `targetKind` (`custom` or `device`), and UI language (`sk` or `en`). The backend rejects missing, malformed, out-of-range, unsupported-target, and unexpected fields before provider work. It returns only normalized address/locality fields and does not persist the request.
- The former public generic `GET /api/geocode/reverse` route/controller were removed. Existing inventory reverse geocoding through `backend/src/services/geocoding.service.ts::reverseGeocode`, `lightPoints.service.ts`, and the manual inventory script remains separate and unchanged.

## Provider, admission, cache, and privacy boundaries

- `backend/src/services/reportAddressSuggestion.service.ts` defines the provider contract. No Geoapify, Nominatim, OpenCage, Google, or other report-coordinate provider adapter is registered. The production app always selects the disabled service (HTTP 503); an injected provider service is accepted only by the non-production test seam. No environment variable can enable a production provider in this draft.
- The generic admission controller takes explicit validated settings for `maxPending`, `maxActive`, `queueExpiryMs`, `timeoutMs`, and `minStartIntervalMs`; tests supply small synthetic values. It supports FIFO queue ordering, identical in-flight coalescing, pre-start queue expiry, synchronous admission and budget hooks, deterministic overload errors, and bounded active work. FIFO is queue order only and does not provide caller fairness. There are no IP/auth/CAPTCHA rules, retries, provider fallback, Redis, or distributed coordination.
- Provider timeout aborts the adapter. The active slot remains occupied until the adapter acknowledges abort or finishes, preserving the active-work limit if an adapter ignores cancellation. Any future provider adapter must honor `AbortSignal` for timely capacity recovery.
- Optional in-memory cache settings require both a finite entry limit and TTL. Keys include provider ID, language, and exact normalized coordinates; successful normalized results only are cached, with LRU eviction. Rejections and provider failures are not cached. Production has no provider and therefore no report-address cache. No database cache or coordinate-key logging was added.
- The optional admission and budget hooks are extension points only. No daily cap, caller/edge fairness policy, numeric production limits, or quota is selected here. Queue, cache, counters, and budget hooks are process-local; correctness and aggregate provider limits are not shared across multiple backend instances. Current pre-production topology remains one backend instance.
- The route, service, and malformed-JSON error path do not log coordinates, addresses, provider URLs, or request bodies. Counters expose aggregate counts only. No report/contact/file/IP/fingerprint data is stored or forwarded to a provider.

## Test and validation evidence

- Backend unit/API tests: **87 passed** across 10 files. New tests cover provider-disabled production, strict request validation, fake success and malformed/error responses, timeout/abort, active/pending bounds, FIFO order, queue full/expiry, coalescing, cache TTL/size/language keying, spacing/budget rejection, zero fake-provider calls for pre-provider rejection, aggregate-only counters, and malformed-body log redaction.
- Frontend unit/component tests: **156 passed** across 18 files. New component checks cover explicit-only trigger, editable automatic suggestions, manual-edit precedence, target-stale response rejection, manual fallback, local coordinate display/copy, and the product API client contract.
- Backend and frontend test-source typechecks: **passed**. Backend TypeScript build: **passed**. Frontend TypeScript build and Vite build: **passed**; Vite reports the existing large-chunk advisory (549.95 kB minified JavaScript, above its 500 kB warning threshold).
- Browser E2E cases were added for fake-provider success and provider-disabled manual fallback. They were **not run locally**: `frontend/playwright.config.ts` rejects startup unless `PROCESS_EGRESS_ISOLATED=1` is proven. The Linux containment helper was inspected but not run from Windows; it requires Linux root, creates an OS user, changes workspace ownership, and enters new namespaces. The guard was not bypassed.
- No real address-provider request, AUSEMIO page/network access, AUSEMIO submit, report persistence, database/schema migration, dependency change, or production AUSEMIO behavior change occurred. No real user coordinates or PII were used.

## Remaining gates and assumptions

- Provider selection and external transfer remain blocked on the existing O5/O6/O12 owner/provider/legal decisions. This draft intentionally leaves production report-coordinate transport disabled.
- O11 production admission numbers, daily/application quota policy, and caller/edge fairness remain owner decisions. FIFO alone is not fairness.
- The one-backend assumption is explicit. A multi-instance deployment would multiply local queue/cache/budget state and would not enforce process-wide concurrency, spacing, cache deduplication, or aggregate provider quota.
- Phase A's Košice/service-area boundary decision remains unresolved and is unaffected by this address-suggestion draft. Service `2` / VO is the only product scope; service `16` / CSS remains out of product scope.
