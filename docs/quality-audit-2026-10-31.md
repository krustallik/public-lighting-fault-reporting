# Комплексний quality, security, privacy та provider-аудит

**Дата перевірки:** 2026-10-31 (Europe/Bratislava)

**Репозиторій:** `krustallik/public-lighting-fault-reporting`

**Перевірена база:** `40b7f4d8bf2ed64298a7a8a8bcd6cb3d53ec26d9`

**Гілка:** `quality/deep-audit-40b7f4d`
**Стан:** зміни незакомічені; цей документ не є CI, production deployment або юридичним висновком.

## 1. Вердикт

**BLOCKED / NOT READY для реальних звернень громадян і повного security sign-off.**

У локальних ізольованих перевірках підтверджено основні public/admin/API/DB сценарії та виправлено один дефект CI. Залишаються два release-рівня privacy gates: немає затвердженої політики строку зберігання fault history, а privacy link веде на політику міста Košice при неясному статусі міста як контролера цього застосунку. Deep Security Scan заблокований через відсутність managed filesystem permission profile; його не повторювали й не обходили. Поточні зміни не мають exact-head GitHub CI, тому цей звіт не заявляє повний independent Code Audit PASS.

`EMAIL_VERIFICATION_ENABLED`, AUSEMIO, Resend, Geoapify та CARTO не активувалися в межах цього аудиту. AUSEMIO submissions, live provider requests, production VPS/DB mutations і deployment не виконувалися.

## 2. База та робочий tree

- `HEAD`, локальний `master` і `origin/master` на момент перевірки: `40b7f4d8bf2ed64298a7a8a8bcd6cb3d53ec26d9`.
- Поточна робоча гілка: `quality/deep-audit-40b7f4d`; робоче дерево було вже змінене до продовження цього аудиту.
- Відстежувана дельта містить 60 файлів (`git diff --stat`: 1,678 вставок / 2,743 видалення); зараз є 21 untracked файл, разом 81 status paths. Нові файли охоплюють regression tests, цей звіт, privacy decision draft і `DEPLOYMENT_CONTINUATION_CONTEXT_2026-10-28.md`. Цей continuation-файл був наявний до цього аудиту, не відкривався й не змінювався. Не всі попередні незакомічені UI/admin/Docker зміни були створені цим аудитом.
- `git worktree list` показує ще три detached worktrees: `plfr-baseline-coverage-3269d45b67b2441bafce335cac3ebc4f` і `public-lighting-email-otp-baseline-da0ccaa` на `da0ccaa` (по 384 status paths кожен), та `plfr-toolchain-audit-40b7f4d` на `40b7f4d` (4 status paths). Це поза поточним diff; їхні файли не інспектувалися і не змінювалися через невідому власність/призначення.
- `.env` існує лише як ignored local file; він не відкривався і не потрапив до Git tracking. Deployment continuation context залишено без змін.
- Після локальних перевірок GitHub CI не запускався для незакоміченого дерева. Немає commit, PR, push, merge або deploy.

## 3. Фактична архітектура та критичні межі

- Два React/TypeScript/Vite клієнти: public і admin (`frontend/apps/public`, `frontend/apps/admin`). Backend — TypeScript/Express (`backend/src`), PostgreSQL 16/PostGIS, послідовні SQL migrations, Docker/Compose; production static frontend обслуговує Nginx.
- `backend/src/app.ts:72-112` монтує health, public address suggestion, verification, inventory, local submit і захищені admin routes. У цьому active app не монтується legacy `reports.routes.ts`; тестовий/local persistence route монтується через `mountLocalTestSubmitRoutes`.
- `backend/src/routes/ausemioTest.routes.ts:229-249` дозволяє development/test sink лише з явним flag, а production local persistence — лише коли `NODE_ENV=production` і `REPORT_SUBMISSION_MODE=local-persistence`. Він зберігає fault metadata у PostgreSQL. `backend/src/services/aussemio.service.ts:6-8,35-56` — legacy simulated logger: код не робить POST і повертає `simulated`; це не підтверджує зовнішнє прийняття. Не плутати його з активним production route.
- PostGIS `fault_report_history` у `backend/src/db/migrations/0004_privacy_safe_fault_history.sql:1-29` містить час, service 2, locality, fault/block codes, target kind, selected ID/geometry і automatic notes; у схемі немає опису, email, телефону, IP, attachments чи OTP. `report_submission_attempts` має opaque UUID receipt та expiry 30 днів (`0005_report_submission_idempotency.sql:1-11`).
- Email OTP зберігає keyed digests і тимчасові rate counters (`0003_email_verification.sql:1-38`); server cleanup запускається на startup та кожні 15 хвилин (`backend/src/index.ts:12-31`). Реальна Resend доставка в цьому аудиті не перевірялася.
- Для обраного інвентарного світильника canonical coordinates/history читаються з PostgreSQL; custom/device/manual target не отримують recurrence notes. Запис/OTP capability consumption відбуваються в межах транзакції; submit retry серіалізується advisory lock. Це перевірено PostgreSQL tests, не лише mocks.
- `NOMINATIM_AUTO_GEOCODE=false` лишається вимогою production config; report-time Geoapify address suggestions — окремий backend provider path. CARTO key використовується public browser tiles; key є видимим клієнту та має обмеження на origin/quota.

## 4. Тестова якість та функціональна перевірка

### Автоматичне покриття

| Проєкт / suite | Результат | Що це доводить |
|---|---:|---|
| Frontend unit/component coverage | 411 tests passed; 53 files; 92.54% lines, 85.07% branches, 90.47% functions | UI/state/schema branches із Vitest; independent frontend threshold виконаний |
| Backend coverage | Повторно на поточному дереві: 710 passed, 9 skipped; 71 files passed, 2 skipped; 89.16% lines, 85.06% branches, 88.61% functions (Vitest 4.1.12 у disposable runner) | Backend suite включав PostgreSQL integration suites; обидва backend thresholds виконані |
| PostgreSQL integration | 66 tests passed у чотирьох змінених/релевантних suites; migrations `0001`–`0007` застосовані | реальні SQL/constraints/transactions у disposable PostgreSQL; не production DB |
| Playwright browser E2E | 35/35 passed | Chromium у Docker `NetworkMode=none`, synthetic inventory/tiles та fake providers; AUSEMIO/Geoapify/CARTO/Resend egress неможливий |
| Typecheck/build | backend test typecheck і production build passed; frontend public/admin typechecks і production builds passed | компіляція/type contracts; frontend build використовував лише synthetic build-time CARTO value, без tile request |
| Dependency audit | `npm audit --audit-level=moderate` у frontend і backend: 0 vulnerabilities | npm advisory database на час виконання; не є повним security scan |
| Workflow regression guard | `python scripts/research/test_contained_workload_workflow.py` passed; CI YAML parse passed; `git diff --check` passed | перевіряє потрібну передачу `GITHUB_RUN_ID` у probe allowlist; не запускає egress probe |

Повторний backend unit/API прогін виконано командою `npm test -- --reporter=dot` у disposable runner на Node 20.20.2 / Vitest 4.1.12, з точними synthetic CI параметрами `p3_ci_test` і `p5_e2e_email_otp`, PostgreSQL 16.15/PostGIS у локальному isolated namespace та без provider credentials. Успішне завершення: 62.81 s. Повторно виконані `npm audit --audit-level=moderate` для обох package locks — 0 vulnerabilities. YAML parse, workflow regression guard і `git diff --check` пройшли цього checkpoint.

Браузерний E2E охоплює admin auth/inventory import/history/export, 50k server-paginated inventory path, public map/form, local sink, OTP gates, draft + attachments reload, service-area allow/reject, browser geolocation permission denial/retry, map selection, service-2/Q99 validation, accessibility і mobile viewport. Це контрольований synthetic/offline browser evidence; не ручний public Internet UAT і не proof працездатності live accounts.

PostgreSQL suites перевіряли OTP replay/concurrency/rate limits/expiry/transaction rollback, fault-history thresholds і точні часові межі, serialізацію concurrent submissions для одного light, idempotent receipts, privacy-safe rows, locality/geometry validation, імпорт/експорт та 50k inventory pagination. Тестові assertions перевіряють фактичні rows/HTTP contracts; частина provider/failure unit tests, навпаки, свідомо використовує fake transport.

### Mutation testing

- Широкий targeted campaign: 979 mutants; 458 killed, 259 survived, 261 no-coverage, 1 timeout, 0 errors. Загальний score 46.88%; score серед covered mutants 63.93%. Це сигнал для покращення оракулів, а не універсальна якість.
- Crypto-focused campaign: 61 mutants; 59 killed, 2 survived, 0 timeout/no-coverage/errors (96.72% killed). Survivors стосувалися мутантів TTL-константи і guard на порожній ключ, хоча є прямі assertions на TTL=600 і відхилення порожнього ключа. Причину розбіжності mutation-tool/oracle не доведено; не заявляти, що ці мутанти вбиті.
- Фінальний focused campaign на п’яти production-модулях (`emailVerificationCrypto.ts`, `emailVerification.service.ts`, `faultReportHistory.service.ts`, `reportAddressProof.ts`, `serviceArea.ts`) та п’яти відповідних unit suites: 917 mutants; 474 killed, 201 survived, 241 no-coverage, 1 timeout, 0 errors; Stryker total score 51.80%, covered score 70.27%. Per-module: crypto 59/61 killed (96.72%, 2 survived); OTP service 52/77 killed (67.53% total, 76.47% covered; 16 survived, 9 no coverage); fault history/idempotency/recurrence 170/441 killed (38.55% total, 80.19% covered; 42 survived, 229 no coverage); address proof 51/65 killed (78.46%, 14 survived); service-area validation 142/273 killed (52.38% total, 52.96% covered; 127 survived, 3 no coverage, 1 timeout). The selected tests did not include PostgreSQL concurrency tests in the mutant runner; persistence/concurrency evidence comes from the separately passing PostgreSQL integration tests. Mutation survivors are assertion-evidence gaps, not proven runtime defects. The TTL=600 and missing-key mutants remained survivors despite direct source assertions; their mutation-tool/oracle discrepancy is unresolved.
- The service-area timeout was reproduced in a focused rerun: Stryker mutant 237 changes `polygonIndex += 1` at `backend/src/domain/serviceArea.ts:101` to `polygonIndex -= 1`; a covered MultiPolygon path then does not terminate and reaches Stryker's 1501/1500 ms limit. This is a deliberately introduced loop mutant classified as `Timeout`, not a defect in the unmutated implementation; it is not counted as killed.
- Broad campaign не повторювався після останніх точкових assertions. На частині критичних модулів лишаються багато surviving/no-coverage mutants; до завершення цих assertions не можна заявляти повне mutation adequacy або відсутність defect.

## 5. Підтверджені виправлення та регресійні перевірки

### Закритий P1 у CI probe

- **Root cause:** `.github/workflows/ci.yml` викликав `sudo --preserve-env=...` без `GITHUB_RUN_ID`, але `scripts/research/contained-workload.sh` у спільному `env -i` environment вимагав це значення. Egress probe завершувався до browser stage.
- **Fix:** workflow додає `GITHUB_RUN_ID` до explicit allowlist і перед probe запускає `scripts/research/test_contained_workload_workflow.py`.
- **Regression evidence:** guard перевіряє саме named workflow step та exact env allowlist; guard проходить. Shell syntax окремо пройшов на LF-normalized копії в Linux container, бо Windows checkout має `core.autocrlf=true` та `w/crlf`. Реальний egress characterization probe навмисно не запускався.
- **Незалежна перевірка:** окремий review agent повторно перевірив цю зміну і підтвердив виправлення; він не запускав мережевий probe.

### Підсилені regression tests у backend tree

- `adminFaultHistoryRoutes.test.ts` тепер перевіряє відхилення unsafe/negative pagination offsets до DB call; root cause — округлення великого unsafe offset могло утворити неправильну сторінку.
- `emailVerificationCrypto.test.ts` перевіряє digest vectors, нормалізацію/межі email, OTP/token shape і HMAC binding до purpose/email/intent/code/token, missing key і TTL.
- `emailVerificationApi.test.ts` підтверджує, що default adapter status path не надсилає email, а IP fallback для socket/unknown address проходить через fake service.
- `legacyReportsController.test.ts` підтверджує проходження конкретної Multer upload помилки без її перетворення на success.
- Точкові E2E/DB tests перевіряють persistence, rate-limit reset, idempotency та report-history privacy. Жоден тест не використовував live Resend/AUSEMIO.
- Після попереднього повного backend run повторно запущено targeted regressions: 4 files / 28 tests passed (`adminFaultHistoryRoutes`, `emailVerificationCrypto`, `emailVerificationApi`, `legacyReportsController`).
- Після public response-type fix повторно запущено `frontend npm run typecheck` (public, admin і test configs — passed) та `npm test -- tests/unit/ReportFormPage.component.test.tsx tests/unit/localTestSubmissionApi.test.ts` (2 files / 58 tests passed).
- Незалежний review виявив необов'язкове `duplicate?: boolean` у public response type при обов'язковому runtime parser/backend field; type узгоджено до `duplicate: boolean`, а 16 component-test response fixtures доповнено фактичним `duplicate: false`. Runtime parser regression уже перевіряє відсутність поля.

### Документована помилка виправлена у цьому checkpoint

`docs/fault-history.md:9` казав, що оператор бачить UTC timestamp, тоді як `backend/src/services/faultReportHistory.service.ts:137-143,163-170` форматує його для `Europe/Bratislava`. Документацію узгоджено з реальною поведінкою; UTC зберігання/порівняння не змінювалися.

## 6. API/DB correctness, security та reliability

- Не знайдено підтверджених P0/P1 code defect у розглянутих public/API/DB flows. Саме це не є доказом повної відсутності вразливостей.
- Admin APIs використовують host boundary, CSRF guard, HTTP-only cookie auth та серверну authorization; email OTP підписує/хешує короткоживучий verification capability і атомарно споживає його. Інтеграційні tests перевіряють role/status boundaries і rollback.
- Upload boundary перевіряє resource limits і зберігає/обробляє attachment bytes лише в межах request; fault-history store persist-ить metadata, а не attachments. Browser drafts натомість можуть зберігати attachments та поля у local storage/indexed browser state до 30 днів і очищаються при наступному відкритті після expiry або успішного submit; це явно показується користувачу.
- `npm audit` обидва проєкти: 0 advisories рівня audit. Локально доступних `semgrep`, `gitleaks`, `trivy`, `syft`, `osv-scanner`, `codeql`, `sqlfluff` або ESLint CLI у перевіреному середовищі не було; package scripts не мають lint command. Git status підтвердив `.env` ignored, але окремого повного secret-scanner run немає.
- Deep Security Scan: **BLOCKED — MISSING MANAGED FILESYSTEM PERMISSION PROFILE**. Повторного виклику та permission обходу не було. OWASP-подібний ручний перегляд важливих auth/CSRF/host/upload/API boundaries і тестове evidence — fallback evidence, не еквівалент Deep Scan.
- Повний live TLS/production topology, production DB права/міграції, backup/restore recovery, external firewall, Resend/Geoapify/CARTO account/quota і production logs не перевірялися.

## 7. Privacy, GDPR та checkbox

### Data inventory (фактичні категорії)

| Категорія | Призначення / місце | Persistence і доступ | Зовнішній отримувач / строк |
|---|---|---|---|
| Email/OTP | OTP request + verification | backend PostgreSQL зберігає keyed digests і timestamps, не raw email/code/IP; cleanup expiry | при live доставці Resend бачить recipient email, OTP email content і delivery metadata; акаунтні строки/регіон мають бути розкриті |
| Report fields і attachments | browser draft/form; поточний submit request | browser draft до 30 днів; backend обробляє request в пам'яті; fault history не зберігає user description, email, phone чи attachments | live Geoapify може одержати address/coordinates для suggestions; у цьому аудиті запитів не робили |
| Fault history metadata | PostgreSQL `fault_report_history` | timestamp, locality, service/fault codes, target kind/ID або координати, operator notes; доступ admin history; без user/claimant identifier | поточної automatic retention/deletion policy немає; рядки залишаються після видалення inventory point |
| CARTO request telemetry | public browser tile/style requests | client робить запит безпосередньо з браузера; API key є public client value | CARTO може отримувати request IP, referrer, user-agent, API key, timestamps і volumes згідно з Terms; за Terms logs truncated IPs зберігаються 30 днів у США |
| Geoapify suggestion request | backend address suggestion | product does not enable automatic Nominatim geocoding; Geoapify call — лише report-time suggestion path | у типовому запиті передаються пошукова адреса/координати; account validity і actual payload у live не перевірялися |

### Висновок щодо checkbox і notice

Checkbox із текстом “розумію, що запис буде збережений локально і не вважається офіційно прийнятим містом” корисний як acknowledgement про статус сервісу. Сам по собі він **не доводить lawful basis і не замінює privacy notice**. Production copy підміняє лише частину тексту, а `frontend/apps/public/src/config/externalLinks.ts:1-2` веде privacy link на сторінку `kosice.sk`. У той же час повідомлення застосунку прямо каже, що запис зберігається у локальній БД і не є офіційно прийнятим містом (`frontend/apps/public/src/i18n/reportFormMessages.ts:633-650`). Хто є контролером і чи поширюється на цей незалежний сервіс міська політика — **не встановлено**.

До приймання реальних citizen reports owner/компетентний privacy reviewer має затвердити контролера/contact, цілі та legal basis, retention, права суб'єктів, recipients/transfers (особливо Resend і provider telemetry) та точну policy URL. Це відповідає інформаційному питанню GDPR Art. 13, але цей технічний огляд не визначає застосовність права чи lawful basis. Джерело: [GDPR, Articles 5 and 13](https://eur-lex.europa.eu/legal-content/EN/TXT/?qid=1500591478697&uri=CELEX%3A32016R0679).

> Slov-Lex, з редакцією, вибраною параметром URL `ucinnost=18.10.2026`, окремо називає lokalizačné údaje серед прикладів ідентифікаторів (§ 2), вимагає конкретної визначеної мети, мінімізації та обмеження зберігання (§§ 6–10) і перелічує правові підстави обробки (§ 13). Це підсилює потребу оцінити точні координати/історію у фактичному контексті, але не означає автоматичного висновку, що кожна точка у цій системі є персональними даними або що конкретна підстава відсутня. Остаточну застосовність має встановити відповідальний privacy reviewer. [Закон 18/2018 Z. z., часова версія, вибрана параметром `ucinnost=18.10.2026`](https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/2018/18/?ucinnost=18.10.2026). Словацький Úrad na ochranu osobných údajov пояснює, що коли постачальник діє як sprostredkovateľ, його відносини з prevádzkovateľ мають бути врегульовані письмовим договором або іншим правовим актом із точним обсягом, метою та гарантіями безпеки; конкретний статус Resend/Geoapify/CARTO треба визначати з їхніх актуальних умов/DPA та фактичної конфігурації, а не припускати. [Úrad — sprostredkovateľ](https://www.dataprotection.gov.sk/sk/legislativa-metodiky/slovnik-gdpr/s/sprostredkovatel/).

## 8. Providers та зовнішні контракти

Технічні/правові сторінки перевірено read-only 2026-10-31. Жоден ключ не перевірявся live.

| Provider | Фактично потрібне застосунку | Evidence / поточний стан | Gate |
|---|---|---|---|
| CARTO Basemaps | Public browser basemap styles/tiles | Атрибуція OSM + CARTO має бути помітною. Terms 29.09.2026: free fair-use до 5M requests/month non-commercial та 1M commercial; Terms передбачають, що з 01.12.2026 commercial use підпадає під 1M free cap. При використанні в мапі key є публічним; доменні restrictions/quota/account validity не перевірені. | Підтвердити класифікацію use (академічний/non-commercial проти міського/операційного), прийняті Terms/ключ і quota. [Terms](https://carto.com/legal/basemap-terms/), [attribution](https://carto.com/attribution/). |
| Geoapify | Backend report-time address suggestions; EU endpoint enforced by production config | Geoapify завжди вимагає OSM attribution; Free plan також вимагає Geoapify attribution. DPA (2024-08-15) каже, що detailed personally-identifiable info за звичайних умов зберігається не довше 24 годин; provider key/quota/real address match не перевірені. Terms допускають restricted commercial production use; account terms і attribution мають бути checked. [Terms](https://www.geoapify.com/terms-and-conditions/), [DPA](https://www.geoapify.com/data-processing-agreement/), [Geocoding API](https://www.geoapify.com/geocoding-api/). | Перевірити актуальний account plan/key, attribution у UI, бюджет/quota та повідомлення про сторонню обробку location/address. Не запускати live tests без окремо погодженого контрольованого сценарію. |
| Resend | OTP transactional email лише за flag/credentials | Resend надсилає на email recipient та обробляє message content/metadata. Офіційно: потрібні API key і verified sending domain; stored data розміщені у США незалежно від EU sending region; email/log data утримується 30 днів на вказаних планах. DPA та account execution не перевірені. [Sending prerequisites](https://resend.com/docs/send-with-phoenix), [Security/retention](https://resend.com/security), [DPA](https://resend.com/legal/dpa). | Verified domain/from-domain match, sending key з мінімальними правами, owner-approved recipient UAT, обробка retention/US transfer у privacy notice і account DPA. Ніякого API request не робили. |
| AUSEMIO | Наразі лише майбутній VO/service 2 boundary | Активний app не має production HTTP adapter/active external route. Legacy code є local simulated logger. `docs/research/ausemio/contract-audit.md` має evidence date 2026-10-03; це public-client evidence, не server contract. `kosice.ausem.io` та `kosice.ausemio.io` не вважалися тим самим host. | До окремого contract verification/owner approval — жодних POST/submission. Реальна зовнішня acceptance semantics, endpoint, headers, server validation/file limits та idempotency — UNKNOWN. |

CARTO офіційні Terms також забороняють caching >30 днів та server-side proxy/cache і вимагають видимої атрибуції OSM+CARTO; у браузері attribution control присутній у source (`frontend/apps/public/src/config/mapTiles.ts`). Geoapify Terms мають quota та можливість suspension/overage; multiple-account circumvention заборонено. Resend DPA описує email, metadata і message content як персональні дані, а офіційна security сторінка вказує US storage і строки, які треба врахувати у notice. Ці документи не підтверджують, що конкретний account/key активний чи що застосунок має законне право на конкретну live-передачу.

## 9. Findings

### P0

Не виявлено у перевіреному source/test scope. Це не означає доведену відсутність всіх critical vulnerabilities: Deep Scan та production review не виконані.

### P1 — потрібне закриття до реальних звернень

1. **Немає retention/deletion policy для постійної історії.** Evidence: `docs/fault-history.md:13-27` прямо фіксує відсутність строку; migration `backend/src/db/migrations/0004_privacy_safe_fault_history.sql:3-29` не має expiry/deletion policy; inventory delete не каскадує history. Consequence: точна target geometry/location + fault metadata можуть зберігатися невизначено довго, а відновити старий запис можна оператору. Minimal direction: owner/legal затверджує мету, строк та винятки; після цього реалізувати саме схвалене retention і DB regression tests. Політику не вигадувати в коді.
2. **Privacy link/controller невизначені.** Evidence: `frontend/apps/public/src/config/externalLinks.ts:1-2` вказує на міську privacy page, а production copy говорить, що застосунок не є офіційним прийманням міста (`reportFormMessages.ts:633-650`). Consequence: користувач може не отримати точну identity/contact/legal-basis/retention/recipient інформацію для фактичного оператора цього сервісу. Minimal direction: owner встановлює контролера/правову основу; компетентний reviewer затверджує application-specific Article 13 notice і URL; UI link має вести саме туди. Це owner/legal gate, не вигаданий coding fix.

### P2 — зафіксовані/не release-blocking

1. **Contained probe CI env bug — FIXED у робочому tree.** `scripts/research/contained-workload.sh:165` вимагає `GITHUB_RUN_ID`, а probe `sudo --preserve-env` раніше його губив; виправлено у `.github/workflows/ci.yml` і додано `scripts/research/test_contained_workload_workflow.py`. Offline regression passed. Exact-head GitHub CI поки невідомий.
2. **Mutation survivors/no-coverage.** Broad run: 259 survived + 261 no-coverage. Focused run на історії/ідемпотентності та географії також залишив 42/229 і 127/3 відповідно, OTP service — 16/9; це значний test-oracle gap, але сам по собі не доводить runtime defect. Не знижувати coverage threshold і не трактувати no-coverage як killed або як підтверджений runtime bug.
3. **AUSEMIO evidence частково stale.** `docs/research/ausemio/contract-audit.md` датований 2026-10-03; публічні assets/settings змінні. Це blocker лише перед наступним інтеграційним/активаційним рішенням, не defect preparation path.
4. **Timestamp документації — FIXED у цьому checkpoint.** `docs/fault-history.md:9` виправлено на `Europe/Bratislava`, що збігається з `faultReportHistory.service.ts:137-143`.
5. **Public response type mismatch — FIXED у цьому checkpoint.** `frontend/apps/public/src/types/localTestSubmit.ts:4` тепер робить `duplicate` required, як вимагають parser `frontend/apps/public/src/services/api.ts:91-104` і backend response `backend/src/routes/ausemioTest.routes.ts:367-372`. Це не було runtime acceptance defect, але type contract тепер відповідає реальній обов'язковій перевірці.

## 10. Незалежний review та його межі

- `/root/review_api_db` зробив read-only review API/DB paths/tests і не повідомив підтверджених дефектів у цьому підобсязі.
- `/root/review_release_all` виконав окремий read-only static review усього поточного modified code/config/test diff (60 tracked paths плюс наявні untracked source/test files), із фокусом на public/admin/API/DB/auth/OTP/provider/Docker і disposable DB guard. P0/P1 не виявлено. Він знайшов P2 у документації: дата Slov-Lex була надто категоричною; privacy fact sheet не включав sessionStorage verification capability; Geoapify reverse lookup був описаний без умови. Усі три формулювання виправлені лише в docs; reviewer підтвердив їх у follow-up. Фінальний review не запускав tests/CI, external calls чи production access.
- Це independent source review, але не GitHub CodeQL/deep security scan, не exact-head CI і не production audit. Не називати його доказом, що весь security surface без вразливостей.

## 11. Що не було перевірено

- Deep Security Scan цього working-tree diff не виконували. Попередній запуск зупинився на managed filesystem permission gate; у поточному deep-scan workflow dirty-tree diff не є дозволеним target, тож gate не обходився і актуальна доступність іншого режиму тут не перевірена. Локальні Semgrep/CodeQL/gitleaks/Trivy/Syft/OSV scans також не запускалися.
- Live Geoapify suggestion, CARTO tile response/account limits, Resend inbox delivery/account DPA, AUSEMIO server acceptance.
- Production public/admin browser flows, production TLS, production persistence, live external requests, real admin bootstrap, restore/backup on VPS.
- Complete legal assessment, lawful basis, city/controller relationship, data-subject rights workflow, retention periods, account-level provider agreements.
- Реальний multi-browser manual UAT і production browser egress. Offline E2E був із network isolation.
- Full GitHub CI на актуальній незакоміченій tree. Від попереднього exact-head CI не можна робити висновок про поточний dirty diff.

## 12. Найменші наступні кроки та deferred work

1. Owner/privacy reviewer визначає контролера, policy URL, lawful basis, retention та provider recipients/transfers; це розблоковує тільки privacy release decision.
2. Не запускати live citizen reports до схвалення retention та notice. Після рішення реалізувати retention з тестом на PostgreSQL і audit trail з дозволеним складом metadata.
3. Після legal/provider gates провести контрольований exact-origin CARTO/Geoapify/Resend UAT з allowlisted synthetic/owner-controlled data; AUSEMIO лишити заблокованим до окремого прийнятого contract.
4. Перед будь-яким merge виконати актуальний full CI на exact SHA й отримати незалежний огляд саме цього фінального diff. Поточний branch залишається uncommitted.
5. `admin-query late side effects`, `Phase A provisioning recovery`, `retention test assertion gap` лишаються вже відомим technical debt із попередніх етапів; цей checkpoint не переаудіював їх. Розміщення: admin-query — admin operational correctness stage; provisioning recovery — provisioning/restore readiness stage; retention assertion gap — разом із затвердженням/реалізацією retention policy.

Фактичний data-flow і draft privacy copy з owner/legal questions зібрано в `docs/privacy-decision-2026-10-31.md`; документ має статус DRAFT і не змінює UI/правові рішення.

Дрібні UI improvements, які не впливають на correctness/accessibility, можна відкласти за окремим UX review. Не додавати нові продукт-функції як умову цього аудиту.

## 13. Відтворення основних перевірок

```text
frontend: npm run coverage
frontend: npm run typecheck
frontend: npm run build  # build-only synthetic VITE_CARTO_PUBLIC_KEY; no map request
backend: npm run coverage
backend: npm run typecheck:tests
backend: npm run build
backend focused mutation (run from backend in Windows checkout):
  .\node_modules\.bin\stryker.cmd run --mutate 'src/services/emailVerificationCrypto.ts,src/services/emailVerification.service.ts,src/services/faultReportHistory.service.ts,src/domain/serviceArea.ts,src/services/reportAddressProof.ts' --testFiles 'tests/unit/emailVerificationCrypto.test.ts,tests/unit/emailVerificationService.test.ts,tests/unit/faultReportHistory.test.ts,tests/unit/serviceArea.test.ts,tests/unit/reportAddressProof.test.ts' --coverageAnalysis perTest --testRunner vitest --reporters clear-text,json --tempDirName 'D:\Temp\plfr-stryker-focused-20261031' --cleanTempDir always --concurrency 3 --maxConcurrentTestRunners 2 --timeoutMS 10000 --logLevel warn
PostgreSQL: emailVerification.postgres.test.ts, faultReportHistory.postgres.test.ts,
            publicAdminApi.postgres.test.ts, productionFoundation.postgres.test.ts
Browser: npm run e2e:prepare-db; npm run test:e2e; npm run e2e:cleanup-db
Dependency audit: npm audit --audit-level=moderate (each project)
CI static regression: python scripts/research/test_contained_workload_workflow.py
CI syntax: python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
Patch whitespace: git diff --check
```

Тимчасові E2E ресурси працювали у Docker network `none`; створені лише для цього запуску контейнери/volumes під `plfr-audit-e2e-*-20261031`, disposable `plfr-audit-final-pg-20261031` і scratch copy були очищені за точними іменами/шляхом після збереження результатів. Існуючий coverage runner та інші UAT/CI ресурси не змінювалися.

## Джерела зовнішніх вимог, перевірені 2026-10-31

- [Geoapify Terms](https://www.geoapify.com/terms-and-conditions/) та [DPA](https://www.geoapify.com/data-processing-agreement/): free-plan attribution, usage rules, EU processing statement і звичайний 24-годинний строк для детальних PII у DPA.
- [CARTO Basemap Terms](https://carto.com/legal/basemap-terms/) та [attribution guide](https://carto.com/attribution/): usage limits, request metadata, caching і OSM/CARTO attribution.
- [Resend send prerequisites](https://resend.com/docs/send-with-phoenix), [security/retention](https://resend.com/security), [DPA](https://resend.com/legal/dpa), [subprocessors](https://resend.com/legal/subprocessors): verified domain/API key, email data flow, US storage/retention/subprocessors.
- [GDPR Regulation (EU) 2016/679, Articles 5 and 13](https://eur-lex.europa.eu/legal-content/EN/TXT/?qid=1500591478697&uri=CELEX%3A32016R0679).
- [Slovak Act 18/2018 Z. z., temporal version selected with `ucinnost=18.10.2026`](https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/2018/18/?ucinnost=18.10.2026): definitions, processing principles and legal bases referenced above.
- [Slovak Data Protection Authority — processor definition and written agreement](https://www.dataprotection.gov.sk/sk/legislativa-metodiky/slovnik-gdpr/s/sprostredkovatel/).

Ці офіційні джерела пояснюють provider/legal facts, але не підтверджують правовий статус конкретного акаунта і не є юридичною консультацією.
