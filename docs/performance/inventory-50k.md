# Inventory performance evidence: 50,000 synthetic points

Measured 2026-10-30 against baseline `08d718ab52121a00e4be462821592114d8d9f214` plus the uncommitted performance changes in this worktree. The benchmark used deterministic synthetic records in disposable PostgreSQL 16/PostGIS database `p3_50k_benchmark_test`; no owner inventory, production database, provider, or VPS was involved.

The local Docker engine reported 12 CPUs and 32.47 GB memory available (Windows host: 12 logical processors and 30.9 GiB installed RAM). PostgreSQL was 16.9 with PostGIS 3.5.2. The benchmark and app containers had no explicit CPU or memory quotas, so these numbers describe the host environment and results should not be treated as a VPS capacity guarantee.

## Import baseline and result

The previous importer processed records one at a time. On the same 50,000-row CSV fixture it spent 30.3 s in preview and 415.0 s applying rows (about 120 rows/s), with 247.9 MiB peak application RSS. The optimized worker applies up to 100 pending rows in one atomic data-modifying statement; constraint failures fall back to per-row processing so the existing row-level error contract is retained.

| Format and scenario | Bytes | Parse | Preview | Apply | Throughput | Peak app RSS |
|---|---:|---:|---:|---:|---:|---:|
| CSV, first import | 5,926,059 | 316 ms | 1,390 ms | 7,338 ms | 6,814 rows/s | 256.4 MiB |
| JSON, repeat with updates disabled | 11,173,180 | 234 ms | 2,533 ms | 1,780 ms | 28,090 rows/s | 395.4 MiB |
| GeoJSON, repeat with updates enabled, unchanged data | 13,823,220 | 218 ms | 2,104 ms | 1,912 ms | 26,151 rows/s | 324.7 MiB |

The repeat cases deliberately distinguish skipped rows from unchanged existing rows. Each 50K preview was confirmed by two concurrent requests; both returned the same batch ID and PostgreSQL contained exactly one batch for that confirmation key. All three completed 50,000 rows with zero failures. Measured process CPU was 1,750 ms for CSV, 1,642 ms for JSON, and 1,309 ms for GeoJSON. The peak observed database connection count was 3 and no lock waiters were sampled.

## Search and pagination

The benchmark measures the real PostgreSQL-backed `listStreetLights` service with 20 sequential samples per case after `ANALYZE`. These are service/database timings, not full browser-to-HTTP timings.

| Query | p95 |
|---|---:|
| Partial inventory number | 163.4 ms |
| Internal ID | 161.3 ms |
| External ID | 170.4 ms |
| Unicode address | 84.6 ms |
| Unicode district | 84.4 ms |
| Lamp type | 87.9 ms |
| Status filter | 3.3 ms |
| Combined filters | 13.8 ms |
| First / middle / last page | 34.6 / 57.4 / 87.5 ms |
| 100 concurrent requests, per-request p95 | 27.43 ms |

The slowest measured p95 was 170.4 ms, below the 500 ms target. `EXPLAIN ANALYZE` reported 0.199 ms for the representative partial search and used the inventory trigram index; the plan reported all five search trigram indexes. PostgreSQL indexing was sufficient for this workload, so no external search service was introduced.

## Streaming exports

All formats streamed 50,000 records through the real export service to a throttled HTTP file consumer, exercising response backpressure. The test parsed the resulting file, checked the complete row count, Unicode and coordinate values, CSV escaping, and matched a canonical checksum against PostgreSQL.

| Format | Bytes | Transfer | Client RSS delta | SHA-256 |
|---|---:|---:|---:|---|
| CSV | 8,714,980 | 2.18 s | 39.7 MiB | `9c725963383b398000b325e125c1274be910698e97d11a077efd20a9e48b898f` |
| JSON | 15,948,719 | 6.94 s | 38.9 MiB | `552c264c3bae89b68f52b126cf0176464d0d69558e8c8c3bfb31682b24ee9b6e` |
| GeoJSON | 18,598,749 | 6.07 s | 23.7 MiB | `dde6af4406407eaa29f26b2d2212c4a555ad6307f14c590f1cc7d490957d5319` |

Existing PostgreSQL export tests continue to cover cancellation/disconnect behavior; the 50K benchmark adds complete-stream and backpressure evidence.

The PostgreSQL import regression also exercises one batch containing both an existing and a new inventory point. Its assertions cover the skipped/created counters, unchanged existing record, created record, and exactly one create audit. The insert anti-join is correlated to each staged row so an existing record no longer forces unrelated new rows into another worker pass.

## Browser UX regression

An isolated Playwright E2E scenario returns a 50,000-row server-paginated result shape to the real admin UI and verifies that only 20 rows render, page 2 requests the right range, and debounced search replaces the results promptly. The API response is intentionally synthetic in this UI-only scenario; PostgreSQL latency is established by the separate benchmark above. Browser E2E runs used the explicit local request allowlist, synthetic tiles, disabled Geoapify/Resend, and the local test sink. No AUSEMIO or provider request was made.

The E2E run found stale assertions in the existing admin workflow: it searched for the import link under a header after the link moved into the sidebar, and expected the old “Technické logy” page title. The test now follows the accessible link and current “Prevádzkové záznamy” title; the targeted admin browser suite passed after these corrections.

## Verification gates

Vitest enforces 85% line and 85% branch coverage independently for frontend and backend. The final local runs passed at 91.78% / 88.01% for frontend and 86.63% / 85.03% for backend. Backend coverage ran the PostgreSQL CI integration flags, including P3 persistence/migrations, report history/API, OTP persistence, and production-foundation backup/restore tests, as a non-root process against disposable databases. No runtime modules were excluded and no coverage threshold was lowered.

The optional PostgreSQL 50K benchmark passed all 7 cases on 2026-10-30 in a fresh disposable PostGIS container with Docker network mode `none` (no egress). The final browser E2E run passed 34/34 in a separate egress-isolated disposable PostGIS environment. Frontend typecheck/build and backend test typecheck/build/compiled-migration smoke passed. These are local validation results; no GitHub Actions run was triggered because this work was not pushed.

A read-only independent review found one optimization gap in the batch insert predicate for mixed existing/new rows. The predicate was correlated by staged row ID, and the mixed PostgreSQL regression plus full P3 persistence suite and backend coverage were rerun successfully. The reviewer confirmed the finding closed and reported no additional scoped findings.

## Reproduction and limits

Run the optional backend benchmark only against a disposable local PostGIS database whose exact name is `p3_50k_benchmark_test`, with `INVENTORY_50K_BENCHMARK=true` and `INVENTORY_50K_DISPOSABLE_DB=p3_50k_benchmark_test`. The test refuses other database names and cleans only its run-specific `BENCH50K-<run-id>` records.

Measurements describe one local disposable environment and synthetic data, not a production capacity guarantee. Generated points are distributed over a Košice bounding box and are not evidence that each point lies within the service-area polygon. UI timing in the browser test uses a mocked paginated API response; real service/database query timing is separately measured above. No live tile/geocoder/mail calls, AUSEMIO traffic, deployment, or production data were part of this validation.
