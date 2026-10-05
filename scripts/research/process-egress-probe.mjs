import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { createConnection } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const probeIp = process.env.PROBE_IPV4;
const chromeBin = process.env.CHROME_BIN ?? 'google-chrome';
const role = process.argv[2];

if (!probeIp) throw new Error('PROBE_IPV4 must be resolved before entering the isolated namespace.');

function externalTcpAttempt(label) {
  return new Promise((resolveAttempt) => {
    let settled = false;
    const socket = createConnection({ host: probeIp, port: 443 });
    const finish = (blocked, code) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveAttempt({ label, destination: `tcp://${probeIp}:443`, blocked, code });
    };
    const timer = setTimeout(() => finish(true, 'ETIMEDOUT'), 3000);
    socket.once('connect', () => {
      clearTimeout(timer);
      finish(false, 'CONNECTED');
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      finish(true, error.code ?? error.name);
    });
  });
}

function startServer(serverRole, backendPort) {
  const server = createServer((request, response) => {
    if (serverRole === 'backend' && request.url === '/health') {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end('synthetic-backend-ok');
      return;
    }

    if (serverRole === 'frontend' && request.url === '/health') {
      response.end('synthetic-frontend-ok');
      return;
    }

    if (serverRole === 'frontend' && request.url === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html>
<html><head><title>waiting</title></head><body>
<p id="probe-result">waiting</p>
<script>
fetch('http://127.0.0.1:${backendPort}/health')
  .then((response) => response.text())
  .then((value) => { document.title = value; document.querySelector('#probe-result').textContent = value; })
  .catch(() => { document.title = 'loopback-failed'; document.querySelector('#probe-result').textContent = 'loopback-failed'; });
</script>
</body></html>`);
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    process.stdout.write(`${JSON.stringify({ event: 'ready', role: serverRole, port: address.port })}\n`);
  });

  process.once('SIGTERM', () => server.close(() => process.exit(0)));
}

async function runServerMode(serverRole) {
  const networkAttempt = await externalTcpAttempt(`${serverRole}-process`);
  process.stdout.write(`${JSON.stringify({ event: 'egress', ...networkAttempt })}\n`);
  if (!networkAttempt.blocked) process.exitCode = 1;
  const backendPort = Number(process.env.BACKEND_PORT ?? '0');
  startServer(serverRole, backendPort);
}

function chromeDump(url, extraArgs = []) {
  const profile = mkdtempSync(join(tmpdir(), 'form-hardening-egress-'));
  try {
    const result = spawnSync(chromeBin, [
      '--headless=new',
      '--disable-gpu',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-proxy-server',
      `--user-data-dir=${profile}`,
      '--virtual-time-budget=4000',
      '--timeout=10000',
      '--dump-dom',
      ...extraArgs,
      url,
    ], { encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
    if (result.error) throw result.error;
    return { exitCode: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

function waitForJsonEvent(child, eventName, outputLines) {
  return new Promise((resolveEvent, rejectEvent) => {
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      outputLines.push(line);
      try {
        const event = JSON.parse(line);
        if (event.event === eventName) resolveEvent(event);
      } catch {
        // Keep raw child output for the retained diagnostic evidence.
      }
    });
    child.stderr.on('data', (chunk) => outputLines.push(String(chunk).trim()));
    child.once('error', rejectEvent);
    child.once('exit', (code, signal) => {
      if (eventName === 'ready' && code !== null && code !== 0) {
        rejectEvent(new Error(`Child server exited before readiness (${code}/${signal ?? 'no signal'}).`));
      }
    });
  });
}

async function startChildServer(serverRole, backendPort, evidenceLines) {
  const child = spawn(process.execPath, [scriptPath, `--server=${serverRole}`], {
    env: { ...process.env, BACKEND_PORT: String(backendPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const egress = waitForJsonEvent(child, 'egress', evidenceLines);
  const ready = waitForJsonEvent(child, 'ready', evidenceLines);
  const egressResult = await egress;
  if (!egressResult.blocked) throw new Error(`${serverRole} process reached the external probe endpoint.`);
  const readyResult = await ready;
  return { child, port: readyResult.port, egress: egressResult };
}

async function runProof() {
  const evidenceLines = [];
  const attempts = [];
  const children = [];
  const runnerAttempt = await externalTcpAttempt('test-process');
  attempts.push(runnerAttempt);
  if (!runnerAttempt.blocked) throw new Error('The isolated test process reached the external probe endpoint.');

  try {
    const backend = await startChildServer('backend', 0, evidenceLines);
    children.push(backend.child);
    attempts.push(backend.egress);

    const frontend = await startChildServer('frontend', backend.port, evidenceLines);
    children.push(frontend.child);
    attempts.push(frontend.egress);

    const frontendHealth = await fetch(`http://127.0.0.1:${frontend.port}/health`);
    if (await frontendHealth.text() !== 'synthetic-frontend-ok') {
      throw new Error('Loopback frontend endpoint did not respond with the expected synthetic result.');
    }

    const browserLocal = chromeDump(`http://127.0.0.1:${frontend.port}/`);
    if (browserLocal.exitCode !== 0 || !browserLocal.stdout.includes('synthetic-backend-ok')) {
      throw new Error('Headless Chrome could not use loopback frontend-to-backend communication.');
    }

    const chromeVersion = spawnSync(chromeBin, ['--version'], { encoding: 'utf8' });
    if (chromeVersion.status !== 0) throw new Error('Could not determine the headless Chrome version.');
    const externalBrowser = chromeDump('https://example.com/', [
      `--host-resolver-rules=MAP example.com ${probeIp}`,
    ]);
    const browserError = externalBrowser.stdout.match(/ERR_(?:INTERNET_DISCONNECTED|ADDRESS_UNREACHABLE|NETWORK_UNREACHABLE|CONNECTION_FAILED|CONNECTION_TIMED_OUT|CONNECTION_REFUSED|CONNECTION_RESET)/)?.[0];
    if (!browserError || /Example Domain/i.test(externalBrowser.stdout)) {
      throw new Error('Headless Chrome did not provide affirmative evidence that its external navigation was blocked.');
    }
    attempts.push({
      label: 'headless-chrome-navigation',
      destination: 'https://example.com/',
      blocked: true,
      code: browserError,
    });

    const command = (file, args) => spawnSync(file, args, { encoding: 'utf8' });
    const ipAddress = command('ip', ['-brief', 'address', 'show', 'lo']);
    const ipRoute = command('ip', ['route', 'show']);
    const evidence = {
      observedAtUtc: new Date().toISOString(),
      runner: process.env.RUNNER_OS ?? 'GitHub-hosted ubuntu-24.04 job',
      nodeVersion: process.version,
      chromeVersion: chromeVersion.stdout.trim(),
      probeHost: 'example.com',
      resolvedProbeIpv4: probeIp,
      namespaceLoopback: ipAddress.stdout.trim(),
      namespaceRoutes: ipRoute.stdout.trim(),
      loopbackFrontendToBackend: 'PASS in headless Chrome',
      externalAttempts: attempts,
      noAusemioRequests: true,
      setupAndGitHubRunnerControlStayOutsideNamespace: true,
      rawChildEvidence: evidenceLines,
    };
    const evidenceFile = process.env.EGRESS_EVIDENCE_FILE;
    if (evidenceFile) writeFileSync(resolve(evidenceFile), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    for (const child of children.reverse()) child.kill('SIGTERM');
  }
}

if (role?.startsWith('--server=')) {
  await runServerMode(role.slice('--server='.length));
} else {
  await runProof();
}
