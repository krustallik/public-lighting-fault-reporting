import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const requireFromFrontend = createRequire(path.join(process.cwd(), 'package.json'));
const { chromium } = requireFromFrontend('@playwright/test');

const origin = 'https://kosice.ausem.io';
const ledger = [];
const assets = [];
let settingsShape = null;
let browser;
let navigation = { ok: false, status: null, error: null };
let rendered = { title: '', bodyText: '', fields: [] };
let interaction = { attempted: false, error: null };

function safePath(pathname) {
  if (pathname.startsWith('/rails/active_storage/')) return '/rails/active_storage/[signed path redacted]';
  return pathname;
}

function isRelevantAsset(pathname) {
  return pathname === '/implementation/all_settings' ||
    /\/(application|PublicIssuesNew|RulesMixin|InputFile|jsonToFormData)-[^/]+\.(js|css)(\.map)?$/.test(pathname);
}

try {
  browser = await chromium.launch({
    headless: true,
    channel: 'msedge',
    args: [
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-proxy-server',
    ],
  });
  const context = await browser.newContext({ serviceWorkers: 'block' });

  // This route exists before any page is created or navigation can begin.
  await context.route('**/*', async (route) => {
    const request = route.request();
    let requestUrl;
    try {
      requestUrl = new URL(request.url());
    } catch {
      ledger.push({ method: request.method(), origin: 'invalid', path: '', action: 'blocked' });
      await route.abort('blockedbyclient');
      return;
    }

    const allowed = requestUrl.origin === origin && ['GET', 'HEAD'].includes(request.method());
    ledger.push({
      method: request.method(),
      origin: requestUrl.origin,
      path: safePath(requestUrl.pathname),
      resourceType: request.resourceType(),
      action: allowed ? 'allowed' : 'blocked',
    });
    if (!allowed) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  const page = await context.newPage();
  await page.addInitScript((allowedOrigin) => {
    const safeUrl = (value) => {
      try { return new URL(String(value), location.href); } catch { return null; }
    };
    const safeMethod = (method) => method === 'GET' || method === 'HEAD';

    addEventListener('submit', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    try {
      Object.defineProperty(HTMLFormElement.prototype, 'submit', {
        configurable: false, writable: false, value() {},
      });
      Object.defineProperty(HTMLFormElement.prototype, 'requestSubmit', {
        configurable: false, writable: false, value() {},
      });
    } catch {}

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const url = safeUrl(input instanceof Request ? input.url : input);
      const method = String(init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (!url || url.origin !== allowedOrigin || !safeMethod(method)) {
        return Promise.reject(new TypeError('Blocked by read-only research guard'));
      }
      return originalFetch(input, init);
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__readonlyResearchMethod = String(method).toUpperCase();
      this.__readonlyResearchUrl = safeUrl(url)?.href ?? '';
      return originalOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      const url = safeUrl(this.__readonlyResearchUrl);
      if (!url || url.origin !== allowedOrigin || !safeMethod(this.__readonlyResearchMethod)) {
        throw new TypeError('Blocked by read-only research guard');
      }
      return originalSend.apply(this, args);
    };
    if (navigator.sendBeacon) navigator.sendBeacon = () => false;
    for (const name of ['WebSocket', 'EventSource']) {
      try {
        Object.defineProperty(window, name, {
          configurable: false,
          value() { throw new TypeError('Blocked by read-only research guard'); },
        });
      } catch {}
    }
  }, origin);

  page.on('response', async (response) => {
    const request = response.request();
    const url = new URL(response.url());
    if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method()) || !isRelevantAsset(url.pathname)) return;
    try {
      const body = request.method() === 'HEAD' ? Buffer.alloc(0) : await response.body();
      assets.push({
        method: request.method(), path: safePath(url.pathname), status: response.status(),
        bytes: body.length,
        sha256: createHash('sha256').update(body).digest('hex'),
      });
      if (url.pathname === '/implementation/all_settings') {
        const json = JSON.parse(body.toString('utf8'));
        const settings = json.settings ?? {};
        const publicForm = settings.public_form ?? {};
        const template = publicForm.template_assignment ?? {};
        const assignments = Array.isArray(template.field_assignments) ? template.field_assignments : [];
        const voKeys = new Set([
          'vyber_sluzby', 'ulica_miesto_poruchy_lokalita', 'detail_decription',
          'lokalizacia_blok', 'typ_poruchy', 'iny_druh_poruchy', 'tel_cislo',
        ]);
        settingsShape = {
          version: settings.version,
          publicForm: {
            enabled: publicForm.enabled,
            templateAssignmentId: publicForm.template_assignment_id,
            steps: { step1: publicForm.step_1, step2: publicForm.step_2, step3: publicForm.step_3 },
          },
          attachmentSettings: {
            maxFileSize: settings.doc_max_size,
            compressionDimension: settings.doc_compress_dimension,
          },
          assignmentCount: assignments.length,
          voAssignments: assignments.filter(({ field }) => voKeys.has(field?.key)).map((assignment) => {
            const field = assignment.field ?? {};
            const options = field.options && typeof field.options === 'object' ? field.options : {};
            const condition = field.condition ?? null;
            return {
              order: assignment.order,
              key: field.key,
              label: field.name,
              type: field.data_type,
              required: assignment.required,
              multiselect: field.multiselect,
              optionCount: Object.keys(options).length,
              options: field.key === 'vyber_sluzby'
                ? { '2': options['2'] }
                : field.key === 'ulica_miesto_poruchy_lokalita'
                  ? undefined
                  : options,
              conditionField: condition?.field_key ?? null,
              conditionValues: condition?.value && typeof condition.value === 'object'
                ? [...new Set(Object.values(condition.value).flat().map(String))].sort()
                : [],
            };
          }),
        };
      }
    } catch {
      assets.push({ method: request.method(), path: safePath(url.pathname), status: response.status(), bodyUnavailable: true });
    }
  });

  try {
    const response = await page.goto(`${origin}/#/public/issues/new`, {
      waitUntil: 'domcontentloaded', timeout: 25000,
    });
    navigation = { ok: true, status: response?.status() ?? null, error: null };
    await page.waitForTimeout(3000);
    const captureForm = () => page.evaluate(() => ({
      title: document.title,
      bodyText: (document.body?.innerText ?? '').slice(0, 6000),
      fields: Array.from(document.querySelectorAll('input,select,textarea')).map((element) => ({
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute('type'),
        name: element.getAttribute('name'),
        value: element instanceof HTMLInputElement ? element.value : undefined,
        id: element.id || null,
        required: element.hasAttribute('required'),
        multiple: element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? element.multiple : false,
        accept: element instanceof HTMLInputElement ? element.accept : null,
        checked: element instanceof HTMLInputElement && element.type === 'radio' ? element.checked : undefined,
        labels: Array.from(element.labels ?? []).map((label) => label.innerText.trim()).filter(Boolean),
        optionCount: element instanceof HTMLSelectElement ? element.options.length : undefined,
        options: element instanceof HTMLSelectElement
          ? Array.from(element.options).slice(0, 12).map((option) => ({ value: option.value, label: option.textContent?.trim() ?? '' }))
          : undefined,
      })),
    }));
    rendered = await captureForm();
    interaction.attempted = true;
    try {
      await page.locator('input[type="radio"]').first().evaluate((element) => {
        element.click();
      });
      await page.waitForTimeout(1000);
      await page.locator('input[type="radio"]').last().evaluate((element) => {
        element.click();
      });
      await page.waitForTimeout(500);
      rendered = await captureForm();
    } catch (error) {
      interaction.error = String(error).split('\n')[0].slice(0, 240);
    }
  } catch (error) {
    navigation = { ok: false, status: null, error: String(error).split('\n')[0].slice(0, 240) };
  }
} finally {
  if (browser) await browser.close();
}

console.log(JSON.stringify({
  capturedAtUtc: new Date().toISOString(),
  browser: 'Microsoft Edge via repository @playwright/test chromium channel',
  guards: {
    contextRouteBeforeNavigation: true,
    allowedOrigin: origin,
    allowedMethods: ['GET', 'HEAD'],
    serviceWorkers: 'blocked',
    formSubmitAndRequestSubmit: 'blocked',
    fetchAndXhr: 'restricted to allowed GET/HEAD origin',
    sendBeacon: 'blocked',
    websocketAndEventSource: 'blocked',
    thirdPartyEgress: 'blocked',
  },
  navigation,
  interaction,
  requests: {
    total: ledger.length,
    allowedGetHead: ledger.filter((entry) => entry.action === 'allowed').length,
    blocked: ledger.filter((entry) => entry.action === 'blocked').length,
    unsafeMethodAttempts: ledger.filter((entry) => !['GET', 'HEAD'].includes(entry.method)).length,
    thirdPartyAttempts: ledger.filter((entry) => entry.origin !== origin).length,
    relevantAllowedPaths: [...new Set(ledger.filter((entry) => entry.action === 'allowed')
      .map((entry) => entry.path)
      .filter((path) => path === '/' || path === '/implementation/all_settings' ||
        /\/(application|PublicIssuesNew|RulesMixin|InputFile|jsonToFormData)-[^/]+\.(js|css)(\.map)?$/.test(path)))],
    blockedAttempts: ledger.filter((entry) => entry.action === 'blocked').map((entry) => ({ method: entry.method, origin: entry.origin, path: entry.path })),
  },
  assets,
  settingsShape,
  rendered: {
    title: rendered.title,
    fields: rendered.fields.filter(({ labels }) => labels.some((label) =>
      ['VO - Verejné osvetlenie', 'Ulica / Miesto poruchy / Lokalita',
        'Bližší popis / orientačný bod / číslo stožiara', 'Pred blokom', 'Vedľa bloku', 'Za blokom',
        'Svietidlo vôbec nesvieti', 'Svietidlo sa rozsvieti a po určitom čase / niekoľkých minútach zhasne',
        'Nesvieti celá skupina svietidiel', 'Poškodený stožiar', 'Odkryté elektrické zariadenie / kabeláž',
        'Poškodená pätica / pätka / betónový základ', 'Krivý alebo nahnutý stožiar / výložník / svietidlo',
        'Potrebný orez drevín - zarastený stožiar / rozvádzač', 'Iný druh poruchy',
        'Tel. kontakt na Vás', 'Súbory', 'Váš kontaktný email',
        'Súhlasím s ďalším spracovávaním mojich osobných údajov'].includes(label)))
      .map(({ tag, type, name, value, required, multiple, accept, checked, labels }) => ({
      tag, type, name, value, required, multiple, accept, checked, labels,
    })),
  },
}, null, 2));
