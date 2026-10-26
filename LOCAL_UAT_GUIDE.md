# Local user acceptance testing

This guide provides explicitly selected local acceptance modes over disposable PostgreSQL/PostGIS state:

- `OFFLINE_UAT_DOCKER` is the no-provider Docker browser stack. It uses fake email/address providers, labelled synthetic map tiles, the public/admin frontend, local backend and isolated PostGIS database. The fixture tiles are not Košice geography and make no CARTO requests. Its edge is published only at `127.0.0.1:8097`.
- `OFFLINE_UAT` uses fake email and address providers plus labelled synthetic map tiles. Report completion goes to the local simulated sink.
- `LIVE_PROVIDER_UAT` uses the real Resend, Geoapify and CARTO adapters after the owner supplies private local configuration and explicitly opts into provider calls. It still uses the same disposable local database and local simulated report sink. It never sends a report to AUSEMIO.

The current owner-authorized local Docker UAT uses `LIVE_PROVIDER_UAT_DOCKER`: real CARTO browser tiles, a restricted Geoapify address-assistance adapter and allowlisted Resend OTP delivery, with reports still going only to the local metadata sink. This is not production and does not enable AUSEMIO. `OFFLINE_UAT_DOCKER` remains available when provider calls are not wanted.

Provider credentials and readiness are owner-machine-specific and are not recorded as fixed values in this guide. File presence is not proof of account validity, domain verification, quota or successful delivery. This guide's configuration instructions do not make provider requests.

## Local boundaries and data

- Public reporting remains account-free and follows the existing VO/service 2 flow; the form still collects an email for OTP and a contact phone when the flag is enabled.
- The isolated UAT backend sets `EMAIL_VERIFICATION_ENABLED=true`: offline mode injects the in-memory fake mail provider, while live mode injects `ResendEmailVerificationProvider` and restricts sends to one owner-approved recipient. The general Compose default remains false.
- Live-mode OTP state uses the existing PostgreSQL-backed verification store and existing cryptography, expiry, attempt limits, resend cooldown, and one-time capability consumption. OTP values are not added to status responses or application logs.
- Live Geoapify calls happen only when the public report flow asks for address assistance. Service-area validation remains local and authoritative; no Nominatim fallback or automatic inventory geocoding is enabled.
- Live CARTO raster requests originate in the owner’s browser after the public map opens. The map reports actual tile-load and tile-error events in its local live-mode status line. The CARTO key is browser-visible by design and must be a separate restricted development key.
- Host-process UAT binds backend/Vite to loopback. Docker UAT publishes only its edge at `127.0.0.1:8097` and `127.0.0.1:8443`; backend and PostgreSQL are private to the Docker networks. Provider adapters use fixed HTTPS origins. Starting the live stack does not itself send provider requests.
- The local simulated report sink consumes the OTP capability, validates the service-2 payload, discards attachment contents, and returns a clearly labelled local result. For a submission that explicitly selects an inventory light, it stores only the timestamp, service/fault metadata, locality, target metadata and generated operator notes in `fault_report_history`. Manual/custom/device reports do not generate recurrence notes. That history never stores the user description, raw email, phone, IP, attachment names/bytes, OTP or full submission payload. The existing email-verification subsystem separately stores keyed digests temporarily for verification/rate limiting; it does not store the raw email/IP in that state. The local fake inbox holds only the latest code and time in memory, not the recipient. The stored report metadata is visible only in the authenticated admin history page; it does not prove DPMK/AUSEMIO acceptance.
- During one request, the backend assembles the original description plus operator notes in memory for the future operator boundary. The local sink returns neither text. The local admin history shows only allowed metadata and notes, as selected by the owner.
- The recurrence thresholds are owner-approved: at least 2 prior reports for the same inventory light in 3 days; at least 5 in 30 days; otherwise a latest-prior note when the last report was within 7 days. Overlapping counts are reported once. No claimant identity matching is done.
- Each Docker UAT mode uses a separate named volume and application/data networks; only the edge is published, and the stack does not claim a network-level egress deny. First initialization applies migrations and seeds the repository inventory into that UAT volume; later starts preserve it. Live Docker publishes HTTP on loopback port 8097 and HTTPS on loopback port 8443. Its local certificate has a localhost SAN but is self-signed/untrusted; do not bypass browser warnings or change the trust store for this UAT. Admin Secure-cookie roundtrip over trusted HTTPS remains unverified. Retention/deletion for fault metadata is not yet defined, so use synthetic UAT reports only until the owner approves a production retention/privacy policy.
- The existing host-process UAT stack and its `plfr-local-uat_uat_data` volume are separate. Do not reset either stack unless a clean synthetic state is specifically wanted.

## Full offline Docker/browser UAT

The full stack builds the public and admin apps as static images and runs them with the backend and a dedicated PostGIS service. It uses no provider credentials, never starts Resend/Geoapify/CARTO adapters, and has no AUSEMIO transport.

```powershell
.\scripts\local-uat\start-docker.ps1
.\scripts\local-uat\status-docker.ps1
```

Open the URLs printed by the start command (public app at `http://localhost:8097/map`, admin at `/panel-svietidla/login`, fake OTP inbox at `/fake-inbox/`). The admin cookie is configured with `Secure` for this explicit container mode. Browser cookie behavior over HTTP `localhost` remains to be verified; the stack does not publish its internal HTTPS listener. Only `127.0.0.1:8097` is published. Offline mode does not configure live provider endpoints, but Docker networking does not prove a hard egress block for the edge. The stack uses a distinct project, database volume and internal subnets; it leaves existing Compose projects and their volumes alone. If that port is occupied by another process, startup stops without touching it.

Stop it while preserving its synthetic database and history:

```powershell
.\scripts\local-uat\stop-docker.ps1
```

Do not use `docker compose down -v` or the separate database reset command as an ordinary stop. The existing host-process `start.ps1`/`stop.ps1` commands continue to control only the older `plfr-local-uat` project.

## Prerequisites and first start

Windows PowerShell, Node.js 22 or compatible, npm and a running local Docker Desktop engine are required. Install dependencies once if needed:

```powershell
Push-Location backend; npm ci; Pop-Location
Push-Location frontend; npm ci; Pop-Location
```

The UAT wrappers verify and pin the local Docker Desktop named-pipe context. They will not use `DOCKER_HOST` or `DOCKER_CONTEXT` overrides. `start-docker.ps1` uses the separate `plfr-local-uat-docker` project and its own volume. The existing `start.ps1` path continues to use `plfr-local-uat` with host backend/Vite processes.

Start the default offline mode:

```powershell
.\scripts\local-uat\start.ps1
.\scripts\local-uat\status.ps1
```

Ports `5000`, `5001`, `5173`, `5174` and `5433` are checked. Port `5432` and other databases are never used or changed. The launcher runs migrations against the exact disposable UAT database and seeds only a newly initialized database. Existing UAT data is preserved on later starts.

The launcher clears inherited provider, database, JWT, admin-bootstrap, `*_FILE`, `DOTENV_KEY`, `NODE_OPTIONS`, `NODE_PATH` and `VITE_*` values before applying each child’s explicit environment. Live mode does not invoke dotenv; standard local modes reject dotenv files in the state tree. Vite reads only the protected empty `.local-uat/frontend-env` directory. `.local-uat/` is Git-ignored; its ACL is restricted to the current Windows account and rechecked before use. Do not move individual UAT files outside that directory.

## Environment files and defaults

- The tracked repository-root `.env.example` is a provider-off **development Docker Compose template**, not a production environment file. It contains empty provider credential fields, turns email verification, Geoapify, CARTO tiles, automatic Nominatim geocoding and the local test submission endpoint off by default, and binds its published services to `127.0.0.1`. A blank development `JWT_SECRET` uses the backend's development-only fallback; a strong secret is required before enabling OTP or using production.
- A repository-root `.env` is owner-specific, Git-ignored and read by Docker Compose for `${...}` interpolation in the general development stack. Compose passes only the variables declared by its services. `DB_HOST` is a direct-host-backend setting; Compose fixes its backend connection to private `db:5432`, while `DB_PORT` controls the host-published database port. Compose also fixes frontend `VITE_API_URL=/api` and the proxy target, so a root `.env` `VITE_API_URL` entry does not override them. A backend run directly from its package directory uses that process's environment/dotenv path and does not automatically consume the repository-root file.
- In the general Compose stack, setting provider flags and keys can enable real provider requests when someone uses the map, address-assistance or email-verification controls. Do not use this stack for the approved live-provider UAT; use the guarded UAT mode and private files below.
- The UAT launcher deliberately does **not** inherit those root `.env` provider values. It clears inherited environment variables, skips backend dotenv loading in live mode, and points Vite at `.local-uat/frontend-env`. Provider UAT credentials must be entered into the protected `.local-uat/private/` files below. No automatic import or secret copying is performed.
- The two configuration contexts have different purposes: the general Compose template is safely provider-off; `LIVE_PROVIDER_UAT` explicitly enables the needed live adapters after private-file validation and the owner confirmation switch. `OFFLINE_UAT` continues to inject fake providers and the local simulated submission sink.

For `LIVE_PROVIDER_UAT`, keep `NOMINATIM_AUTO_GEOCODE=false`; Geoapify is enabled by the live launcher for report-time address suggestions only. UAT submission remains a local simulation, and AUSEMIO stays on hold.

## URLs and admin handoff

| Purpose | URL |
| --- | --- |
| Public map and report flow | <http://127.0.0.1:5173/map> |
| Admin login | <http://127.0.0.1:5174/panel-svietidla/login> |
| Sanitized local provider/database status | <http://127.0.0.1:5000/api/dev/local-uat/status> |
| Offline fake inbox only | <http://127.0.0.1:5001/> |

The generated synthetic admin username/password handoff is in `.local-uat/private/admin-credentials.txt`. The file is ignored and ACL-protected. Do not paste its contents into chat. The fake inbox exists only in `OFFLINE_UAT`; live mode does not create or expose one.

## Prepare local provider files

First start `OFFLINE_UAT` at least once so the private UAT state and its ACL exist. Then create the empty local files:

```powershell
.\scripts\local-uat\prepare-provider-files.ps1
```

Enter each value locally in a text editor. Never send keys, the approved recipient address, passwords, or OTPs in chat, commit them, or capture them in screenshots. For this isolated UAT, do not put provider values in dotenv files: the launcher will not read them. If the owner has a candidate key in the general development `.env`, manually copy it locally only after checking that it is the intended owner-controlled development key. The launcher checks private-file presence and basic shape only; it does not ping accounts or prove that keys are valid.

| Provider | Signup / dashboard | Owner prerequisites | Exact UAT private file(s) → child setting(s) |
| --- | --- | --- | --- |
| Resend | [Resend](https://resend.com/) and [Domains](https://resend.com/docs/dashboard/domains/introduction) | Owner-controlled account; verified sending domain and its DNS records for domain sending; sender address on that domain; server API key; one approved recipient mailbox controlled by the owner. | `resend-api-key.txt` → backend-only `RESEND_API_KEY`; `resend-from-email.txt` → `RESEND_FROM_EMAIL`; `resend-approved-recipient.txt` → `LOCAL_UAT_APPROVED_EMAIL_RECIPIENT`. |
| Geoapify | [MyProjects](https://myprojects.geoapify.com/) and [API key help](https://myprojects.geoapify.com/help/api-keys/) | Owner-controlled project and a suitable server-side development key; review restrictions, plan and quota. The fixed EU origin is `https://api-eu.geoapify.com`. | `geoapify-api-key.txt` → backend-only `GEOAPIFY_API_KEY`. |
| CARTO Basemaps | [CARTO key request](https://www.carto.com/basemaps/apikey/) and [key dashboard](https://dashboard.basemaps.carto.com/) | Separate development key; confirm use classification, restrictions for `127.0.0.1`, quota and attribution. The key is browser-visible by design. | `carto-public-key.txt` → public build-time `VITE_CARTO_PUBLIC_KEY`. |

The owner can check only whether the private files are missing, empty or present without displaying their contents:

```powershell
$files = @('resend-api-key.txt','resend-from-email.txt','resend-approved-recipient.txt','geoapify-api-key.txt','carto-public-key.txt')
foreach ($name in $files) {
  $path = Join-Path '.local-uat/private' $name
  $state = if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { 'MISSING' }
    elseif ((Get-Item -LiteralPath $path).Length -eq 0) { 'EMPTY' }
    else { 'PRESENT' }
  '{0}: {1}' -f $name, $state
}
```

This reports file presence only, not valid key shape, email format, ACL, provider account or domain verification. The live launcher validates shape and private-state protections before it starts. Do not use the live start command merely as a status check: once started, opening the public map can request CARTO tiles.

Geoapify recommends separate environment keys, server-side storage for server calls and restrictions appropriate to each request source; CORS alone is not a key restriction. CARTO keys are public in browser URLs, so use a distinct, restricted development key. See the linked official key guidance and current provider terms before use.

Resend’s documented event-testing addresses (for example `delivered@resend.dev`) simulate delivery events; they are not proof that a message reached the owner’s mailbox. This UAT’s acceptance requires the owner to receive the real OTP at the one approved recipient and confirm receipt. A Resend HTTP success is reported as `api_accepted`, not as inbox delivery. See [Resend Send Email](https://resend.com/docs/api-reference/emails/send-email) and its [test email event guide](https://resend.com/changelog/sending-test-emails).

## Explicit live-mode gate

After all five private files contain valid values and the owner has verified the provider account/key setup and approved the exact recipient, stop offline mode and explicitly opt into provider egress:

```powershell
.\scripts\local-uat\stop.ps1
.\scripts\local-uat\start.ps1 -Mode LIVE_PROVIDER_UAT -ConfirmLiveProviderCalls
.\scripts\local-uat\status.ps1
```

`-ConfirmLiveProviderCalls` is an owner-action gate: the public map can request real CARTO tiles immediately when opened, a report address-suggestion action can call Geoapify, and the OTP request button can send email through Resend. No startup health probe, seeding command or status request contacts those providers. If the flag or any required private file is missing, startup stops before launching application services. There is no fake-provider fallback in live mode.

Live limits are deliberately small: Resend is restricted to the exact approved recipient and at most three send attempts for one backend process; Geoapify is capped at ten outbound requests for one backend process. Geoapify request observations show only counts/outcome classes, never address, coordinates, key or URL. Restarting the live backend resets these in-memory caps, so stop after the planned manual checks. CARTO tile traffic is generated by interactive browser map use and is governed by the owner’s CARTO key/account limits; avoid unnecessary repeated pan/zoom.

To turn provider access off, stop local UAT and restart without a live mode argument:

```powershell
.\scripts\local-uat\stop.ps1
.\scripts\local-uat\start.ps1
```

This returns to fake email, fake Geoapify transport and synthetic tiles. Stop preserves the UAT database volume. The default start never activates Resend or Geoapify.

## LIVE_PROVIDER_UAT manual checklist

Start only after the explicit gate above. Use a small number of owner-controlled requests.

### Provider status and map

1. Open <http://127.0.0.1:5000/api/dev/local-uat/status>. Check `mode`, database migration/inventory evidence, provider configuration booleans, zero initial request counts, and `submission.status=ON_HOLD`. The database field is a plain inventory row count, not proof of fixture provenance. This endpoint never returns key values, recipient address, OTP, report coordinates or provider origins/request URLs.
2. Open <http://127.0.0.1:5173/map>. Wait for the map’s live CARTO tile status to change from loading to loaded, confirm Košice streets and context, and visually confirm both OpenStreetMap and CARTO attribution are visible. A failed status means live tiles did not pass; there is no synthetic fallback in live mode.
3. Inspect a small representative view in both light and dark theme, use zoom and one short pan, and confirm marker clusters/popups remain usable. Do not copy tile URLs or the public key into evidence. The local status endpoint does not claim tile delivery; the accessible map status is based on Leaflet tile load/error events.

### Public OTP and report flow

1. Select one inventory light or one custom point, complete the service-2 form, and enter only the approved owner-controlled email. Confirm the UI’s request button is the only action that starts a Resend request.
2. Enter an incorrect OTP once and confirm it is rejected. Check the resend cooldown; the backend remains authoritative for cooldown, expiry and attempt limits. Request no unnecessary additional emails.
3. Confirm the owner receives the message in the actual mailbox, then enter the received OTP and proceed through **Back → Continue → review**. Check the status endpoint: Resend `apiAccepted` is provider API acceptance; `inboxReceipt` remains `owner_confirmation_required` until the owner records their observation outside the status API.
4. Submit once. The final result must say local simulation only and show no external issue identifier. It is not DPMK/AUSEMIO acceptance. Do not press or instrument an AUSEMIO submit path.
5. Do not repeatedly test expiry by waiting ten minutes unless necessary; automated fake-provider tests cover expiry/replay. Do not exceed three Resend attempts in this backend process.

### Geoapify

1. Use one or two known Košice control points by selecting a custom map location and following the report-address flow. The report form should show the returned address suggestion as optional enrichment.
2. Confirm the status endpoint reports `response_received` and increments its request count. Confirm coordinate/service-area acceptance remains based on local validation; a provider result is not the authority for a valid target.
3. If a provider error occurs, keep it as a failed live check. The form must remain usable through its existing recoverable manual-address flow; there is no fake response or Nominatim fallback. Avoid retry loops.
4. For an explicitly selected inventory light whose `light_points.address` is empty, a successful Geoapify reverse result is stored in that inventory row's `address` field with `address_geocoded_at`; later selections read the stored address and do not call Geoapify again. Existing inventory addresses are never overwritten. This is a one-point, user-triggered Geoapify enrichment path, not bulk/automatic Nominatim geocoding. Provider failures and no-result responses are not cached, so retry only after resolving the cause.

### Admin and actual export file

1. Open <http://127.0.0.1:5174/panel-svietidla/login> and use the private admin handoff. Confirm login, inventory count/search/filter/pagination, logout, and unauthenticated access rejection.
2. Use a clearly synthetic test inventory row for create/edit/delete and remove it when finished. Preview the valid and invalid CSV examples; if confirming an import, inspect its queue/history result and remove only the synthetic rows created for this run.
3. Click **Export CSV** and verify a real browser download with a dated `.csv` filename. The downloaded file should contain the actual current inventory rows, beginning with the expected header. The admin API now uses its authenticated fetch/refresh path, surfaces error responses to the page, and creates a download from the returned response body rather than navigating an unobserved anchor.
4. Check the admin history/log pages and pagination. Keep evidence limited to synthetic rows; do not include passwords, session cookies, keys or private report data.

### Mobile and accessibility

Test a narrow viewport such as 390×844. Traverse map controls and report target selection, all required report fields, OTP request/input/resend, attachment selection, review/back/continue and final local result with keyboard only. Confirm visible focus, readable validation/error/loading states, an accessible live CARTO status, and no horizontal overflow. Browser automation is run only inside the repository’s egress-isolated CI; do not disable its isolation guard to call live providers.

## Sanitized evidence rules

The sanitized JSON status endpoint is the provider request evidence surface. It reports Resend attempts and outcomes (`api_accepted`, `rejected`, `ambiguous`), Geoapify response classes and bounded counts, PostGIS/migration/inventory facts, and the local-only submission boundary. It intentionally does not report the recipient, OTP, address, coordinates, provider key, provider origin/request URL or response body. CARTO evidence is the live map status line plus visual attribution and owner’s browser observation.

For a screenshot, hide/redact browser network request URLs and any address bar/query string containing the public CARTO key. Never include a real OTP, personal address, inbox header, credential file or private API response body. A timeout is `ambiguous`, not a confirmed provider rejection or acceptance. Keep separate records for API acceptance and the owner’s actual inbox observation.

## Local UAT evidence status (checked 2026-10-26)

| Area | Current evidence | Current status |
| --- | --- | --- |
| Local Docker/PostGIS | Current `plfr-local-live-provider-uat` stack has five healthy containers, loopback edge at `127.0.0.1:8097` and `:8443`, PostGIS verified, migrations current and 255 inventory rows. Its dedicated database volume is synthetic UAT state. | Read-only status and container health checks passed after rebuild. HTTPS certificate is self-signed; Secure-cookie browser roundtrip remains unverified. No host/VPS or production database was accessed. |
| CARTO map | Public browser rendered the geographic Košice basemap with CARTO/OSM attribution; map status showed 66 loaded tiles after zoom/cluster expansion. The status API intentionally reports tile evidence as `not_reported_to_backend`. | Real map appearance and tile loading were visually observed in the owner browser. Browser map load makes provider tile requests; do not confuse this with a report submission. |
| Resend OTP | One allowlisted UAT OTP send was API-accepted, the owner confirmed receipt, entered the code and reached the verified review flow. A local report submission completed after consent. After the latest backend rebuild, in-memory counters reset and current status reads zero attempts; the successful prior delivery/verification is historical browser evidence. | The feature works in this local flow; no further email was sent after the rebuild. Provider account/domain validity beyond the observed accepted send is not inferred. |
| Geoapify | In the current `LIVE_PROVIDER_UAT_DOCKER` process, one synthetic Košice coordinate request to the local `/api/reports/address-suggestion` endpoint returned HTTP 200 with an address. Sanitized status then reported 1 request, 1 response, 0 rejected, 0 ambiguous. No personal data was sent. | This verifies the real provider roundtrip through the local backend API, not the new selected-inventory persistence path. The latter is covered by fake-provider/API tests and gated disposable-PostgreSQL integration tests; no additional live Geoapify call was made for this change. Automatic inventory geocoding via Nominatim remains off. |
| Fault-history persistence | The successful public submission went to the local sink. Current status confirms `externalRequests: 0`; the database schema stores allowed fault metadata only. The backend composes user description plus approved recurrence notes in request memory; the sink persists neither full text nor attachments/contact data. | The owner completed the local-only submit. Admin history review and recurrence-note rendering were not performed in this live Docker session; tests cover metadata persistence and per-light note rules. |
| Coverage | Historical exact-head PR #38 CI run `40359511397` passed on `fa1f78fe7825c758930148c52904a9fc6ad07046`: frontend 94.52% lines / 86.54% branches; backend 87.13% lines / 85.17% branches. Both projects have blocking 85/85 thresholds. On this uncommitted checkout, the latest frontend run passed 291/291 tests at 93.01% lines / 86.85% branches, with typecheck/build passing. Backend disposable PostGIS coverage evidence from this task: 531 passed, 1 optional heavy-resource test skipped; 87.13% lines / 85.15% branches. | Historical CI is not exact-head evidence for the current uncommitted work. No CI run exists for the dirty working tree. |
| Admin export | The first manual CSV download failed when a 256-row unfiltered export requested its second PostgreSQL chunk. Root cause was a cursor predicate emitted as `AND` even when no filter `WHERE` existed. The query now uses `WHERE` for an unfiltered cursor page and `AND` after existing filters. A disposable PostgreSQL regression exported 260 fixture rows across the chunk boundary and asserted all fixture row numbers in order; frontend regression and egress-isolated Playwright download checks also pass. The local browser previously downloaded a 255-row CSV with the expected header after the fix. | Fixed and covered by PostgreSQL integration. Current browser tool did not surface a second download event after the latest image rebuild; no UI error or backend error was visible in that attempt. |
| AUSEMIO | Local sink only. | `ON_HOLD — NO EXTERNAL SUBMISSION`. |
| Browser evidence | Owner completed the live-provider public flow from inventory-point choice and form through reload persistence, Resend OTP, verified review, consent and local result. The owner-provided current review screenshot shows the consent checked and the local-only submit control. Review consent is also covered by a component regression: unchecked submit is disabled, checking enables it, and Back → Continue preserves the choice. A post-rebuild browser pass confirmed consent on step 2 and Space-key toggle. The current image rendered the real CARTO map, zoomed to 90 loaded tiles, expanded clusters to inventory markers, and opened the selected-point confirmation/form. Mobile viewport 390×844 had no horizontal overflow and manual target selection worked. | The completed public submit reached a local-only result; AUSEMIO status remained on hold with zero external requests. Admin login, synthetic CRUD, CSV export, and one-row import were exercised in the live stack; the final status API reports the original 255 inventory rows. History review and recurrence-note rendering were not exercised live. No attachment was included in the owner’s live submission. Simulated IndexedDB deletion failure tests cover retry-marker persistence and the manual-cleanup warning when marker/draft removal both fail; no real browser storage failure was injected. Keyboard-only traversal beyond native checkbox Space and trusted HTTPS admin-cookie behavior remain unverified. |

The offline Docker mode intentionally shows synthetic tiles. The currently running `LIVE_PROVIDER_UAT_DOCKER` renders the real geographic basemap by sending browser tile requests to CARTO. Use it only while owner-approved local provider testing is intended; report submission still terminates in the local metadata sink.

## OFFLINE_UAT regression checklist

Offline mode remains the default and continues to use the existing isolated synthetic UAT setup:

1. Select an inventory light or custom point; complete the service-2 form; request/verify a code in the local fake inbox; test wrong code and the verified **Back → Continue → review** path.
2. Attach `.local-uat/private/test-files/valid-synthetic-attachment.txt`; confirm the local result is labelled simulation. Optionally verify the oversize fixture is rejected.
3. Use fake address scenarios through `scripts/local-uat/set-address-scenario.ps1`; they do not send Geoapify requests.
4. Test synthetic admin login, CRUD, import preview/confirm/history and export against the disposable PostGIS database.

To reset synthetic inventory and UAT-only state, stop the app and run the separately guarded command only when a clean test database is desired:

```powershell
.\scripts\local-uat\reset.ps1 -ConfirmDisposableUatReset
```

The reset guard requires the dedicated Compose project and exact database name/user/host/port. It does not remove the volume or target other databases. Do not run it as part of an ordinary provider setup or verification session.

## Provider activation prerequisites outside local UAT

This local mode does not authorize production activation or deployment. Production must keep `EMAIL_VERIFICATION_ENABLED=false` until separately approved. Geoapify remains server-side with `GEOAPIFY_ENABLED=true` only after the owner approves account, quota, privacy notice and key restrictions. `NOMINATIM_AUTO_GEOCODE=false` remains the selected behavior. CARTO production builds require a separate approved public key and current usage/attribution review.

AUSEMIO remains on hold until the owner obtains and approves a verified VO/service-2 external contract and test receiver in a separate package. Nothing in this live-provider local UAT sends an AUSEMIO request, uploads a report externally or claims DPMK acceptance. No VPS, production DB, production credential or university server was inspected or modified here.
