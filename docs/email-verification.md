# Підтвердження e-mail у public reporting

Стан цього документа відповідає реалізації в гілці Email OTP. Публічний звіт і далі надходить лише до локального симульованого приймача. Реального endpoint надсилання звернень і AUSEMIO adapter немає.

## Feature flag

Єдиний перемикач функції — `EMAIL_VERIFICATION_ENABLED`; його значення за замовчуванням `false`.

- `false`: public форма зберігає чинний двокроковий потік; backend не створює Resend adapter, не читає `RESEND_API_KEY_FILE`, не вимагає Resend credentials і не надсилає OTP.
- `true`: сторінка читає стан з `GET /api/reports/email-verification/status`; backend вимагає налаштовані `RESEND_API_KEY` і `RESEND_FROM_EMAIL`, а також сильний `JWT_SECRET`. Неочікуване значення flag зупиняє конфігурацію.
- Встановлення flag не виконує мережевих запитів. Resend викликається лише після явної дії користувача «Надіслати код».
- Після перевірки email public форма відкриває окремий фінальний крок. Local test endpoint незалежно перевіряє й атомарно споживає capability разом із multipart запитом. Клієнтський стан не є доказом перевірки.

У локальному `.env` для майбутнього тестового ввімкнення потрібні `EMAIL_VERIFICATION_ENABLED=true`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` та випадковий base64url `JWT_SECRET` не коротший за 32 байти. Для production Compose передбачено `RESEND_API_KEY_FILE`; API key не вбудовується у frontend bundle і не зберігається в Git.

## Архітектура та межі

1. `POST /api/reports/email-verification/request` створює intent UUID і надсилає шестизначний OTP. Для resend клієнт передає той самий intent UUID; зміна e-mail у UI скидає intent, код і локальний verification capability.
2. `POST /api/reports/email-verification/verify` перевіряє код і повертає випадковий submission token лише при успіху. Intent, normalized email і OTP криптографічно зв’язані.
3. `POST /api/dev/ausemio-test-submit` приймає intent і token тільки за увімкненої перевірки. Backend перевіряє адресу з report payload і споживає token однією умовною `UPDATE`; паралельні або повторні submissions не можуть використати його вдруге.
4. Немає прихованого AUSEMIO client чи зовнішнього report transport. Локальний приймач продовжує відхиляти service 16; підтримується лише service 2 / VO.

Основні модулі: `backend/src/routes/emailVerification.routes.ts`, `backend/src/services/emailVerification.service.ts`, `backend/src/services/emailVerificationStore.ts`, `backend/src/services/emailVerificationProvider.ts`, `backend/src/db/migrations/0003_email_verification.sql` і `frontend/apps/public/src/pages/ReportFormPage/ReportFormPage.tsx`.

## Security та зберігання

- OTP має 6 цифр, діє 10 хвилин, допускає щонайбільше 5 перевірок і 3 доставки на intent з паузою щонайменше 60 секунд між доставками.
- PostgreSQL атомарно обмежує надсилання на normalized e-mail (3 на годину) та IP digest (15 на годину), а перевірки — на e-mail digest (15 на годину) та IP digest (30 на годину). Підрахунки спільні між backend workers, бо зберігаються в PostgreSQL.
- Для rate-limited відповідей `Retry-After` обчислюється за залишком відповідного PostgreSQL вікна (береться найдовший reset серед заблокованих e-mail/IP лімітів); cooldown resend використовує час з БД. Вичерпання спроб окремо не блокує кнопку нового resend на довільну годину.
- В обох таблицях зберігаються keyed HMAC digests, а не plaintext email, IP, OTP чи submission token. OTP digest містить intent UUID і email digest; verification token digest має окремий domain separator. HMAC key походить із серверного `JWT_SECRET`; його ротація інвалідовує незавершені OTP intents.
- Код існує в пам’яті лише під час запиту та виклику provider adapter. Відповіді API і помилки provider не містять коду, адреси чи provider body. В application code немає request-body logging.
- Public UI відраховує TTL/cooldown від wall-clock дедлайнів і перераховує їх після повернення у вкладку або фокус. Це відображення стану; серверний час і PostgreSQL state лишаються авторитетними, зокрема якщо системний годинник клієнта змінився.
- OTP та submission token перевіряють `expires_at` на стороні PostgreSQL. Expired challenge зберігається до години для зрозумілої expired-відповіді, після чого видаляється обмеженим batch cleanup; старі rate-limit digest рядки видаляються після 48 годин. Database-only cleanup запускається під час старту HTTP runtime і кожні 15 хвилин незалежно від feature flag, тому вимкнення нових verification запитів не зупиняє retention.
- Provider failure fail closed: непідтверджений challenge видаляється, клієнт отримує загальну помилку й не може перейти до submit. Test seam приймає fake provider; він не змінює runtime provider.

## Технічні джерела

Resend adapter використовує офіційний `POST https://api.resend.com/emails` REST endpoint, `Authorization: Bearer ...` і поля `from`, `to`, `subject`, `text`, як у [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email). Для майбутнього домену потрібні записи DNS, які Resend показує для вибраного домену; типи і статуси записів треба звірити у dashboard під час активації. Resend описує перевірку DKIM/SPF та очікування DNS propagation у своєму [процесі перевірки домену](https://resend.com/changelog/domain-verification-events).

HMAC, cryptographic random, TTL, one-time consumption і rate limits є локальними рішеннями застосунку; це не вимоги Resend API. SQL constraints та conditional updates задають межу між паралельними request workers.

## Перед майбутньою live Resend активацією

1. Отримати погоджений домен і доступ до DNS; додати його у Resend та внести лише показані Resend DNS записи, включно з потрібними для sending DKIM/SPF.
2. Дочекатися підтвердження домену у Resend dashboard і погодити адресу `RESEND_FROM_EMAIL` на цьому домені.
3. Створити окремий least-privilege API key для надсилання, передати його через секретний файл `RESEND_API_KEY_FILE`, а не Git чи Vite environment.
4. Налаштувати сильний серверний `JWT_SECRET`, перевірити міграцію `0003` у цільовому середовищі, узгодити приватність/retention повідомлень з власником продукту та лише після окремого рішення змінити flag на `true`.
5. До зміни flag перевірити реальну доставку контрольованою адресою, spam-folder поведінку, sender/reply policy та provider failure handling. Ці кроки ще не виконувались; домену та DNS доступу поки немає.

Resend відповідає за прийняття API запиту, але наявний код не має delivery webhook/receipt. API `2xx` означає, що provider прийняв повідомлення, а не гарантує inbox delivery. Реальна відправка зараз вимкнена й не тестувалась.

## Evidence та відомі обмеження

- Unit/API тести використовують fake provider, перевіряють disabled/enabled flag, delivery failure, invalid/expired code, changed email, replay, exhausted attempts, cooldown, recipient limit та concurrent verification/submission. У цих тестах немає зовнішнього Resend запиту.
- PostgreSQL integration suite створює окрему schema лише за явного `P5_E2E_ALLOW_DB_RESET=true` і local database з назвою `p5_e2e_*`. Вона перевіряє одноразовість та атомарність реальної SQL persistence; без цієї змінної suite позначається skipped.
- Browser E2E використовує тестовий backend на loopback, fake mail transport та disposable PostGIS database. Його process egress isolation залишається обов’язковою умовою; звичайний локальний браузерний запуск поза containment не дозволений.
- Надсилання завжди обмежене чинним локальним report receiver. Результат не означає, що зовнішня організація отримала звернення. AUSEMIO endpoint і contract не були реалізовані чи викликані.

## Coverage gate та тестове evidence

Coverage вимірюється окремо для frontend і backend; обидва Vitest config вимагають щонайменше 85% lines і 85% branches. GitHub Actions запускає звичайний `npm run coverage` у кожному job, тому порушення порога завершує job помилкою. Coverage artifacts лишаються увімкненими.

| Проєкт | Baseline `da0ccaa48fb5d9ff0f433d85562bac57046b05ce` | Поточна реалізація | Поріг |
| --- | ---: | ---: | ---: |
| Frontend | 83.16% lines / 84.26% branches | 94.57% lines / 87.13% branches | 85% / 85% |
| Backend | 75.61% lines / 79.15% branches | 87.04% lines / 85.12% branches | 85% / 85% |

Baseline виміряний на окремому checkout зазначеного SHA; backend baseline та фінальна метрика використовують свіжі disposable PostgreSQL бази. Поточні повні локальні запуски: frontend — 35 test files, 252 tests passed; backend — 48 test files, 441 passed і 1 наявний export test skipped. У CI backend job окремо створює `p5_e2e_email_otp` для OTP persistence tests; browser job використовує окрему disposable socket database. У coverage denominator входять runtime модулі проєктів; production code не виключений. Єдине frontend coverage exclusion — `vite-env.d.ts`, TypeScript declaration file.

Змістовне розширення тестів покриває admin API/CRUD/import/history flows, карту й публічні компоненти та legacy helpers, а для OTP — flag/provider/API/service boundaries, frontend verification/reset/error/retry/expiry стани та PostgreSQL concurrency, replay, recipient binding, expiry з урахуванням database clock, залишковий час rate window і пакетне очищення. PostgreSQL перевіряє реальну persistence та атомарні операції, а не лише mocks.

Локальний browser E2E не запускався: repository Playwright guard вимагає process-level egress isolation, якої локальне середовище не надає. CI зберігає browser E2E job і запускає його лише після containment gate; його результат перевіряється окремо перед злиттям. Реальні Resend/AUSEMIO запити не є частиною тестів.
