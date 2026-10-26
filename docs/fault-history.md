# Anonymous service-2 fault history

## Owner-approved behavior

For a report that explicitly selects an inventory light from the database, the local submission boundary calculates prior-report context for that same light only. Windows are rolling elapsed durations (72, 720 and 168 hours), evaluated by PostgreSQL in UTC-independent timestamp arithmetic:

- At least 2 prior reports during the preceding 3 days: include the recent count.
- At least 5 prior reports during the preceding 30 days: include the 30-day count, and include the 3-day count in that same note if its threshold is also met.
- Otherwise, if the latest prior report is no more than 7 days old, include its timestamp in UTC.

These rules are evaluated before the current report is inserted. The inventory row is locked while recurrence is calculated so simultaneous submissions for one light are ordered. Custom, device and manual targets never receive recurrence notes. Counts are not deduplicated by claimant; no claimant identity is stored or inferred.

## Privacy and persistence

`fault_report_history` stores only service-2 fault metadata: submission time, canonical locality, optional VO block/fault codes, target kind, selected inventory ID or validated coordinate snapshot, and generated automatic notes. The schema has no columns for user description, other-fault free text, email, phone, IP, attachments or OTP state. User-provided free text and contact values are processed only for the current request in this report-history path. Attachments are counted and discarded by the local sink. Inventory deletion does not erase historical rows; each selected-light row retains its numeric light ID and coordinate snapshot and deliberately has no inventory foreign key.

The existing email-verification subsystem is separate: while a code is active, PostgreSQL stores keyed email/IP digests and OTP/token digests, not raw addresses, IPs or codes. Expiry cleanup bounds that temporary verification/rate-limit state. In offline UAT, the fake inbox keeps only the latest OTP and timestamp in memory; it does not keep the recipient address.

The backend composes the original description followed by the automatic operator notes in memory as `OperatorReportPayload.additionalInfo`. That complete object is not returned to the public client or written to PostgreSQL. The authenticated admin history page exposes only the stored metadata and automatic notes. This is the currently selected local UAT review behavior, not an AUSEMIO contract.

The local simulated sink is not external delivery. It never calls AUSEMIO and does not claim that an external operator has received a report. No production AUSEMIO transport is implemented by this history layer.

## Transactions and limits

For the local sink, OTP capability consumption and metadata insertion share a PostgreSQL transaction. A failed metadata insert rolls the capability consumption back. The selected inventory row lock serializes recurrence calculation for concurrent submissions to the same asset; PostgreSQL integration tests cover this behavior.

The table currently has no retention/deletion policy. Therefore its use is limited to synthetic local UAT until the owner approves a production privacy/retention policy and deployment safeguards. Do not enter real citizen reports in the UAT environment.

## Verification evidence (2026-10-26)

- Exact-head PR #38 CI run `40347391438` passed on `75099b3676c07a96a138ee99599d0a12aacdc9ff`: frontend coverage 94.52% lines / 86.54% branches and backend 87.13% lines / 85.14% branches. Each project independently enforces blocking thresholds of 85% lines and branches.
- PostgreSQL tests use the disposable `p3_ci_test` database. The fault-history suite passed 6/6, including exact and one-microsecond-outside 72, 720 and 168 hour boundaries, concurrent selected-light reports, metadata privacy, inventory deletion snapshots, and OTP rollback. The public/admin API PostgreSQL suite passed 3/3, including multipart local submit → PostgreSQL → authenticated admin history, with the public receipt and persisted row checked for absent description/contact/attachment values.
- The local Docker UAT stack was rebuilt using production static frontend images, Nginx edge, backend and the separate synthetic PostGIS volume. Health and public/admin/fake-inbox routes returned HTTP 200; migrations `0001`–`0004` and 255 inventory rows were present. The local status endpoint reported fake email/address providers and metadata-only local submission; no external provider or AUSEMIO request was made. Its map tiles are intentionally synthetic fixtures rather than Košice geography; actual CARTO tiles require the separately approved live-provider mode.
- The egress-isolated Playwright browser E2E job passed on the exact head and uploaded browser/accessibility/request-ledger/trace/egress artifacts. This is not a completed owner/manual browser walkthrough: the desktop computer-use policy check stopped before navigation because it could not establish the current browser URL. Direct HTTP and API checks are not represented as manual browser acceptance. Live-provider browser acceptance is also pending: the five documented `.local-uat/private/` provider files were absent at this check.
- An initial backend attempt in run `40345406730` hit a timing-sensitive restoration assertion; the exact same head was rerun and all jobs then passed. The failed assertion is reported by the test harness only as `assertionerror`, so its root cause is not established. A prior exact CI run on the backend code had passed; treat this as a flaky signal to observe rather than a proven product defect.
- Local backend unit-only coverage is not the final gate: with PostgreSQL integration flags unset it reported 56.81% lines / 84.92% branches and failed the thresholds. A CI-style run against local PostGIS with the safe available suites passed 477 tests but reported 72.27% / 86.18%; this Windows Docker image lacks the CI's PostgreSQL 16 client and `age` tools, and local retention guards require loopback DB config. The canonical CI job provisions those dependencies and integration suites; its successful exact-head result is the accepted coverage evidence above.
