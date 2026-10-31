# Privacy decision package — DRAFT

**Status:** technical fact sheet and proposed wording for owner/qualified privacy review. Not approved, not legal advice, and not published in the application. No privacy UI, provider, or retention behavior was changed for this document.

## 1. Data flows visible in the current code

| Category | Current handling evidenced in source | Retention / destination |
|---|---|---|
| Report fields | The browser submits locality, fault/block codes, target, free-text description, phone, email, and selected files as the report request. The local submit route reads attachments as a stream and keeps only file metadata for the request result; it does not persist file bytes. | The permanent `fault_report_history` table stores service 2, submission time, locality, fault/block codes, target kind, selected inventory ID or target geometry, and operator notes. It has no deletion/expiry column or cleanup policy. It excludes description, email, phone, attachment content, network address, and citizen ID. See migration `0004_privacy_safe_fault_history.sql` and `ausemioTest.routes.ts:45-95,309-353`.
| Browser draft | Report form data, including contact fields and description, is kept in same-origin `localStorage`; uploaded files are retained in IndexedDB so the form can survive reload. | Draft data expires 30 days after its last update and expired data is cleaned when the app next opens. The owner approved this 30-day browser-draft period in the conversation. Browser storage is on the user’s device; it is separate from server history. See `frontend/apps/public/src/utils/reportDraftStorage.ts:8-11,140-154,216,399-442`.
| Browser verification state | When verification is enabled, the browser stores the normalized email, intent ID, timestamps, and bearer verification capability in same-origin `sessionStorage` so verification can survive a page reload in that tab. | This is separate from the 30-day report draft and backend OTP digests. Expired state is rejected and removed on the next read or cleanup; it is also removed on explicit reset or when the browser session storage is discarded. The source does not define a separate fixed retention period beyond capability expiry. See `frontend/apps/public/src/utils/reportDraftStorage.ts:34-40,354-381`.
| Email verification | When `EMAIL_VERIFICATION_ENABLED=true`, the backend sends a one-time code through its Resend adapter. PostgreSQL stores keyed digests of email, OTP, and verification capability plus attempt/cooldown timestamps; it does not store those values in plaintext. | A code expires after 10 minutes. Cleanup runs at startup and periodically; rows become eligible for cleanup one hour after expiry and cleanup is bounded, so deletion is not an exact deadline. Rate-limit rows use keyed digests and are similarly temporary. See `backend/src/db/migrations/0003_email_verification.sql`, `emailVerificationCrypto.ts`, `emailVerificationStore.ts`, and `index.ts`. Resend’s own processing/retention is provider-controlled and has not been verified for the owner’s account.
| Retry receipt | An opaque submission-attempt UUID prevents duplicate local writes. | `report_submission_attempts.expires_at` is 30 days; expired receipts are removed by the service’s cleanup path. This receipt is not a citizen identifier. See migration `0005_report_submission_idempotency.sql` and `faultReportHistory.service.ts`.
| Address/map providers | With Geoapify enabled, address-suggestion searches send the user’s query to Geoapify. Reverse geocoding can send selected coordinates when no usable address is already available (for example, a custom location or an inventory point with no saved address); a stored inventory address is returned directly. The public browser loads CARTO map tiles directly and includes its public map key in tile requests. | Geoapify can receive address text or coordinates; CARTO can receive the browser network/request metadata and the requested tile coordinates. Current ignored local `.env` was not read, so this audit does not establish which provider flags are enabled in a particular local runtime. No live provider calls were made for this audit.
| Admin account/audit | Admin account hashes and admin activity identity snapshots are persistent application data. | These concern administrators and operations, not citizen report fields. The repository does not establish an approved retention period for these records.
| AUSEMIO | The configured production path in this tree persists only the allowed report metadata locally. The audit found no active AUSEMIO request path used by that submission route. | No AUSEMIO requests or submissions were made. Do not describe this local record as city acceptance.

Application and proxy logs, VPS backups, provider account settings, and their retention periods were not inspected. The code’s metadata-only history contract does not prove that infrastructure logs or provider systems retain no request metadata.

## 2. Current checkbox and privacy-notice gaps

In production local-persistence copy the checkbox says the report is saved locally and is not officially accepted by the city (`frontend/apps/public/src/i18n/reportFormMessages.ts:633-636,660-663`). That accurately describes the AUSEMIO boundary and the metadata-only permanent history. The current text is incomplete if read as a complete account of data processing: it does not explain the 30-day browser draft, the fields sent to Geoapify when address assistance runs, CARTO tile/request metadata, or Resend processing when OTP is enabled. The checkbox is an acknowledgement gate; it does not establish a lawful basis by itself.

The privacy link currently points to a Košice city privacy page (`frontend/apps/public/src/config/externalLinks.ts:1-2`). The code and current copy do not establish that the city is the controller for this application. A product-specific notice is missing confirmed controller identity/contact, purpose, lawful basis, complete recipient/provider information, retention/deletion periods, data-subject rights/contact route, and the approved notice URL. A qualified reviewer must determine which elements apply and approve the final notice.

The main statement that description, phone, and files are absent from permanent fault history is supported by the schema and PostgreSQL assertions. Do not broaden that statement to “never processed” or “never retained”: those values are present in the browser draft and in the submission request, and infrastructure/provider log retention remains unknown.

## 3. Retention decisions still needed

- **Permanent fault history:** no retention/deletion period is implemented. The owner/privacy reviewer must choose the period and deletion rules for exact location, fault metadata, and automatic operator notes before real citizen-report operation.
- **Browser draft:** 30 days from last update is implemented and owner-approved; users should be told that contact details, description, and files can remain in this browser until expiry, successful cleanup, or manual site-data deletion.
- **OTP state:** 10-minute code TTL is implemented; cleanup is periodic and permits an extra one-hour grace before rows become eligible. Confirm whether this technical window is acceptable and accurately described.
- **Idempotency receipt:** a 30-day expiry is implemented for the opaque retry receipt; confirm that operational purpose and period in the final notice if it is in scope.
- **Logs, backups, admin activity, and providers:** repository evidence does not establish deployed retention. Owner/operator must obtain and record the actual log/backup policy and provider account/DPA retention before claiming an end-to-end deletion period.

## 4. Decisions for the owner and qualified reviewer

1. Name the legal controller/operator, contact address, privacy contact/DPO if applicable, and the entity responsible for operating the VPS and database.
2. Confirm whether the city is formally involved and whether its privacy page is applicable. If not, choose an application-specific notice URL.
3. Approve the purposes, lawful basis, and required/optional status for report fields, OTP, rate limiting, address assistance, map loading, and recurrence history. Do not assume the checkbox is the lawful basis.
4. Choose the retention period and deletion process for permanent fault history and automatic notes; establish log, backup, and admin-audit retention.
5. Confirm the actual Geoapify, CARTO, and Resend accounts, applicable provider terms/DPA, recipients/subprocessors, transfer locations, and provider retention. Decide separately whether live OTP may be enabled.
6. Approve the final notice and exact wording with a qualified privacy/legal reviewer. This package intentionally does not decide legal applicability or recommend a particular lawful basis.

## 5. Proposed Slovak wording — DRAFT with placeholders

> **NÁVRH — NESCHVÁLENÉ.** Prevádzkovateľom tejto aplikácie je **[NÁZOV A PRÁVNA IDENTITA]**, kontakt: **[ADRESA A KONTAKT]**. Hlásenie sa v súčasnosti uloží do databázy prevádzkovateľa; neodošle sa do systému AUSEMIO ani mestu a mesto jeho prijatie nepotvrdzuje. Aplikácia preto neposkytuje oficiálne potvrdenie mesta.
>
> Na **[SCHVÁLENÝ ÚČEL]** sa spracúvajú údaje o poruche **[PRESNÉ KATEGÓRIE]** a **[POTREBNÉ KONTAKTNÉ/PRÍLOHOVÉ ÚDAJE]**. Právny základ: **[ZÁKLAD POTVRDENÝ PRIVACY REVIEWEROM]**. Trvalá história porúch obsahuje **[PRESNÉ POLIA Z DATABÁZY]** a uchováva sa **[SCHVÁLENÁ LEHOTA A PRAVIDLÁ VYMAZANIA]**. Rozpracované údaje a prílohy sa môžu uložiť v tomto prehliadači najviac 30 dní od poslednej zmeny.
>
> Ak je zapnuté overenie e-mailu, e-mailová adresa a jednorazový kód sa spracúvajú prostredníctvom **[POTVRDENÝ POSKYTOVATEĽ A PODMIENKY]**. Pri vyhľadávaní alebo doplnení adresy sa príslušný vyhľadávací text alebo súradnice môžu odoslať službe **[POTVRDENÝ POSKYTOVATEĽ]**; mapové podklady poskytuje **[POTVRDENÝ POSKYTOVATEĽ A ODKAZ NA PODMIENKY]**. Podrobnosti o príjemcoch, lehote uchovávania, právach dotknutej osoby a uplatnení práv: **[SCHVÁLENÝ ODKAZ NA OZNÁMENIE]**.

**Checkbox wording — DRAFT:** `☐ Rozumiem, že toto hlásenie sa uloží iba do databázy [PREVÁDZKOVATEĽA] a mesto ho oficiálne neprijíma.` This acknowledges the service status only; it must not be presented as a substitute for the approved privacy notice or as a lawful basis unless qualified review explicitly approves that design.

## Evidence limits

This is a source-code/data-flow review, not a legal opinion, production configuration inspection, provider account verification, or proof of deployed log/backup deletion. The local ignored `.env` was not opened. No provider credentials, citizen data, live Geoapify/CARTO/Resend requests, or AUSEMIO requests were used.
