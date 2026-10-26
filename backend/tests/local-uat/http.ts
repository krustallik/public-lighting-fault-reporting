import express, { type Request } from 'express';
import { createServer, type Server } from 'node:http';
import { isLocalUatAddressScenario, type LocalUatAddressProvider, type LocalUatEmailProvider } from './fakes.js';

const BACKEND_PORT = 5000;
const EMAIL_INBOX_PORT = 5001;
const LOOPBACK = '127.0.0.1';

const EMAIL_INBOX_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Local UAT fake email inbox</title>
<style>body{font:16px system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1rem;color:#18212b}main{border:1px solid #aab5bf;border-radius:12px;padding:1.5rem}code{font-size:1.8rem;font-weight:700;letter-spacing:.15em}button{padding:.7rem 1rem}p{line-height:1.5}</style></head>
<body><main><h1>Local UAT fake email inbox</h1>
<p>This loopback-only inbox displays only the latest one-time code kept in memory by the local fake provider. It does not retain the recipient address, and no email is sent.</p>
<p id="message" role="status" aria-live="polite">Waiting for a verification request…</p>
<button type="button" id="refresh">Refresh inbox</button>
<p><small>Codes disappear when the local UAT backend stops.</small></p></main>
<script>
const output=document.getElementById('message');
async function refresh(){try{const response=await fetch(new URL('api/latest',location.href),{cache:'no-store'});const body=await response.json();if(!body.message){output.textContent='No verification code has been requested yet.';return;}const message=body.message;output.textContent='Code requested at '+new Date(message.sentAt).toLocaleTimeString()+'. Code: '+message.code;}catch{output.textContent='The local fake inbox is temporarily unavailable.';}}
document.getElementById('refresh').addEventListener('click',refresh);refresh();setInterval(refresh,1500);
</script></body></html>`;

function requestIsLoopback(request: Request, port: number, allowedRemoteAddress?: string): boolean {
  const address = request.socket.remoteAddress?.toLowerCase();
  const allowedAddress = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' ||
    Boolean(allowedRemoteAddress && (address === allowedRemoteAddress || address === `::ffff:${allowedRemoteAddress}`));
  const host = request.get('host')?.toLowerCase();
  const allowedHosts = port === BACKEND_PORT
    ? new Set([`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1:5173', 'localhost:5173', '127.0.0.1:5174', 'localhost:5174'])
    : new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return allowedAddress && host !== undefined && allowedHosts.has(host);
}

function noStore(response: express.Response): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
}

export function createLocalUatTools(
  addressProvider: LocalUatAddressProvider,
  emailProvider: LocalUatEmailProvider,
  options: { port?: number; allowedRemoteAddress?: string } = {}
): express.Express {
  const port = options.port ?? BACKEND_PORT;
  const app = express();
  app.use(express.json({ limit: '1kb', strict: true }));
  app.use((request, response, next) => {
    noStore(response);
    if (!requestIsLoopback(request, port, options.allowedRemoteAddress)) {
      response.status(403).json({ success: false, code: 'LOCAL_UAT_LOOPBACK_ONLY' });
      return;
    }
    next();
  });
  app.get('/api/dev/local-uat/status', (_request, response) => {
    response.json({
      mode: 'local-uat',
      email: { enabled: true, delivery: 'in-memory fake; no email sent', codeAvailable: Boolean(emailProvider.latest()) },
      address: { provider: 'Geoapify adapter with an in-memory fake transport', scenario: addressProvider.scenario(), transportRequests: addressProvider.requestCount() },
      submission: 'local metadata history only; no AUSEMIO request',
    });
  });
  app.post('/api/dev/local-uat/address-scenario', (request, response) => {
    const body: unknown = request.body;
    const scenario = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).scenario
      : undefined;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 || !Object.hasOwn(body, 'scenario') ||
      !isLocalUatAddressScenario(scenario)) {
      response.status(400).json({ success: false, code: 'LOCAL_UAT_INVALID_SCENARIO' });
      return;
    }
    addressProvider.setScenario(scenario);
    response.json({ success: true, scenario: addressProvider.scenario() });
  });
  app.all('*', (_request, response) => response.status(404).json({ success: false, code: 'LOCAL_UAT_NOT_FOUND' }));
  return app;
}

export function createEmailInboxServer(
  emailProvider: LocalUatEmailProvider,
  port = EMAIL_INBOX_PORT,
  allowedRemoteAddress?: string
): Server {
  return createServer((request, response) => {
    const host = request.headers.host?.toLowerCase();
    const address = request.socket.remoteAddress?.toLowerCase();
    if (
      (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1' &&
        address !== allowedRemoteAddress && address !== `::ffff:${allowedRemoteAddress}`) ||
      (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
    ) {
      response.writeHead(403, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    const requestUrl = new URL(request.url ?? '/', `http://${LOOPBACK}:${port}`);
    if ((request.method === 'GET' || request.method === 'HEAD') && requestUrl.pathname === '/') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      }).end(request.method === 'HEAD' ? undefined : EMAIL_INBOX_HTML);
      return;
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && requestUrl.pathname === '/api/latest') {
      const latest = emailProvider.latest();
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      }).end(request.method === 'HEAD' ? undefined : JSON.stringify({ message: latest ?? null }));
      return;
    }
    response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
  });
}
