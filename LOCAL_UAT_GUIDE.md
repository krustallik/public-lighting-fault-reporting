# Local user acceptance testing

This guide provides two explicitly selected, loopback-only modes over the same disposable PostgreSQL/PostGIS database:

- `OFFLINE_UAT` uses fake email and address providers plus labelled synthetic map tiles. Report completion goes to the local simulated sink.
- `LIVE_PROVIDER_UAT` uses the real Resend, Geoapify and CARTO adapters after the owner supplies private local configuration and explicitly opts into provider calls. It still uses the same disposable local database and local simulated report sink. It never sends a report to AUSEMIO.

The current checkout is running `OFFLINE_UAT`. At the time of this update, the dedicated local PostGIS database had 255 inventory rows. This is a row count only; persisted admin changes can alter row provenance, and live status does not claim that every row is a synthetic fixture. No non-empty Resend, Geoapify or CARTO key was found in the local UAT files or process environment; provider account readiness is unknown. No live provider request has been made.

## Local boundaries and data

- Public reporting remains anonymous and follows the existing VO/service 2 flow.
- `EMAIL_VERIFICATION_ENABLED=true` is set only for local UAT. Offline mode injects the in-memory fake mail provider; live mode injects the real `ResendEmailVerificationProvider` and restricts it to one owner-approved recipient.
- Live-mode OTP state uses the existing PostgreSQL-backed verification store and existing cryptography, expiry, attempt limits, resend cooldown, and one-time capability consumption. OTP values are not added to status responses or application logs.
- Live Geoapify calls happen only when the public report flow asks for address assistance. Service-area validation remains local and authoritative; no Nominatim fallback or automatic inventory geocoding is enabled.
- Live CARTO raster requests originate in the owner’s browser after the public map opens. The map reports actual tile-load and tile-error events in its local live-mode status line. The CARTO key is browser-visible by design and must be a separate restricted development key.
- The backend and Vite servers bind to `127.0.0.1`; the dedicated PostGIS container publishes only `127.0.0.1:5433`. Provider adapters use their fixed allowlisted HTTPS origins. The live backend starts without sending provider requests.
- The local simulated report sink consumes the OTP capability, validates the service-2 payload, discards attachment contents, and returns a clearly labelled local result. It does not persist citizen reports and does not prove DPMK/AUSEMIO acceptance.
- The disposable database, synthetic inventory, admin account, OTP tables, audit/history data and imports persist across ordinary stop/start. Do not use the reset command unless a clean synthetic state is specifically wanted.

## Prerequisites and first start

Windows PowerShell, Node.js 22 or compatible, npm and a running local Docker Desktop engine are required. Install dependencies once if needed:

```powershell
Push-Location backend; npm ci; Pop-Location
Push-Location frontend; npm ci; Pop-Location
```

The UAT Docker wrapper verifies and pins the local Docker Desktop named-pipe context. It will not use `DOCKER_HOST` or `DOCKER_CONTEXT` overrides. It uses the dedicated `plfr-local-uat` Compose project and volume, not the general development Compose project. The UAT backend and Vite servers are separate host processes.

Start the default offline mode:

```powershell
.\scripts\local-uat\start.ps1
.\scripts\local-uat\status.ps1
```

Ports `5000`, `5001`, `5173`, `5174` and `5433` are checked. Port `5432` and other databases are never used or changed. The launcher runs migrations against the exact disposable UAT database and seeds only a newly initialized database. Existing UAT data is preserved on later starts.

The launcher clears inherited provider, database, JWT, admin-bootstrap, `*_FILE`, `DOTENV_KEY`, `NODE_OPTIONS`, `NODE_PATH` and `VITE_*` values before applying each child’s explicit environment. Live mode does not invoke dotenv; standard local modes reject dotenv files in the state tree. Vite reads only the protected empty `.local-uat/frontend-env` directory. `.local-uat/` is Git-ignored; its ACL is restricted to the current Windows account and rechecked before use. Do not move individual UAT files outside that directory.

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

Enter each value locally in a text editor. Never send keys, the approved recipient address, passwords, or OTPs in chat, commit them, put them in dotenv files, or capture them in screenshots. Startup checks presence and basic shape only; it does not ping accounts or prove that keys are valid.

| Provider | Signup / dashboard | Exact owner action | Needed key / domain / DNS | Local private setting | Present now | Live test status |
| --- | --- | --- | --- | --- | --- | --- |
| Resend | [resend.com](https://resend.com/) and [Domains](https://resend.com/docs/dashboard/domains/introduction) | Create/verify the Resend account; add a sending domain you control; publish the exact DNS records shown in the dashboard; wait until the domain is verified; choose a sender address on that domain; create a server API key; approve one mailbox controlled by the owner. | Resend currently documents that at least one owned sending domain must be added and verified. DNS access is therefore a prerequisite for the real inbox test. | `resend-api-key.txt`, `resend-from-email.txt`, `resend-approved-recipient.txt` → backend-only `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `LOCAL_UAT_APPROVED_EMAIL_RECIPIENT` | Missing locally; owner stated no Resend key is available yet. Account/domain status unknown. | `BLOCKED` — no key/domain evidence and no send attempted. |
| Geoapify | [MyProjects](https://myprojects.geoapify.com/) and [API key help](https://myprojects.geoapify.com/help/api-keys/) | Create or select an owner-controlled project; create a separate development/server key; apply suitable restrictions (fixed outgoing IP where practical); review current account plan/usage; enter the key locally. | Server-side Geoapify key; EU API origin remains fixed as `https://api-eu.geoapify.com`. | `geoapify-api-key.txt` → backend-only `GEOAPIFY_API_KEY` | Missing locally; account status unknown. | `BLOCKED` — no key/account evidence and no request attempted. |
| CARTO Basemaps | [CARTO key request](https://www.carto.com/basemaps/apikey/) and [key dashboard](https://dashboard.basemaps.carto.com/) | Request a separate development key; choose the correct non-commercial/commercial classification for this project; restrict the key to the local host `127.0.0.1` where supported; review current terms and request quota. | Browser-visible public key. CARTO’s key form distinguishes `localhost` and `127.0.0.1`; this UAT uses `127.0.0.1`. Required visible OpenStreetMap and CARTO attribution must remain on the map. | `carto-public-key.txt` → public build-time `VITE_CARTO_PUBLIC_KEY` | Missing locally; account status unknown. | `BLOCKED` — no key and no tile request attempted. |

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

## Current acceptance status (checked 2026-10-18)

| Area | Current evidence | Current status |
| --- | --- | --- |
| Local PostGIS | Dedicated `plfr-local-uat` PostGIS 16 container, loopback port 5433; current inventory row count 255; local services report healthy. | Count verified locally; row provenance is not independently verified by the status endpoint. |
| Database migrations | Local server startup checks migration ledger before serving requests. | Live mode has not been started in this change; exact current ledger will be reported by local status at next start. |
| Admin export | Previous browser run was inconclusive because it checked only the export response and did not inspect the browser’s downloaded file. Export now uses the authenticated fetch/download path; targeted client test asserts a blob download and server errors are surfaced; egress-isolated Playwright now asserts the downloaded CSV header and synthetic rows. | Automated regression added; actual browser download remains to be confirmed by owner’s next local run/CI. |
| Resend | No local key/domain setup; no real request. | `BLOCKED` pending account, verified domain/DNS, key, sender and owner-controlled approved recipient. |
| Geoapify | No local key/account evidence; no real request. | `BLOCKED` pending account/project and restricted server key. |
| CARTO | No local public key/account evidence; no real tile request. | `BLOCKED` pending dev key and correct use classification/restrictions. |
| AUSEMIO | Local sink only. | `ON_HOLD — NO EXTERNAL SUBMISSION`. |
| Manual mobile/keyboard UX | Previous offline session covered the ordinary map/report/OTP path. Live-provider mobile checks have not run; desktop UI automation could not be safely initialized in this session. | Owner manual checklist required. |

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
