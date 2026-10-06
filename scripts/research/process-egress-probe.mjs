import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { createConnection } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function processIdentity() {
  const status = readFileSync('/proc/self/status', 'utf8');
  const value = (name) => status.match(new RegExp(`^${name}:\\s+(\\S+)`, 'm'))?.[1] ?? 'UNKNOWN';
  return {
    pid: process.pid,
    uid: process.getuid?.() ?? null,
    euid: process.geteuid?.() ?? null,
    gid: process.getgid?.() ?? null,
    egid: process.getegid?.() ?? null,
    groups: process.getgroups?.() ?? [],
    capEff: value('CapEff'),
    capBnd: value('CapBnd'),
    noNewPrivs: value('NoNewPrivs'),
  };
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

    if (serverRole === 'frontend' && request.url?.split('?', 1)[0] === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html>
<html><head><title>waiting</title></head><body>
<p id="probe-result">waiting</p>
<p id="external-egress">not-requested</p>
<script>
fetch('http://127.0.0.1:${backendPort}/health')
  .then((response) => response.text())
  .then((value) => { document.title = value; document.querySelector('#probe-result').textContent = value; })
  .catch(() => { document.title = 'loopback-failed'; document.querySelector('#probe-result').textContent = 'loopback-failed'; });
if (new URLSearchParams(location.search).has('external')) {
  fetch('https://example.com/', { mode: 'no-cors', cache: 'no-store' })
    .then(() => { document.querySelector('#external-egress').textContent = 'response-received'; })
    .catch(() => { document.querySelector('#external-egress').textContent = 'request-blocked'; });
}
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
  process.stdout.write(`${JSON.stringify({ event: 'egress', ...networkAttempt, processIdentity: processIdentity() })}\n`);
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
    rmSync(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
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
  egressResult.role = `probe-${serverRole}`;
  const readyResult = await ready;
  return { child, port: readyResult.port, egress: egressResult };
}

async function runProof() {
  const evidenceLines = [];
  const attempts = [];
  const children = [];
  const childProcessIdentities = [];
  const identity = processIdentity();
  let browserDiagnostic;
  let chromeVersion;
  let namespaceNetwork;
  const runnerAttempt = await externalTcpAttempt('test-process');
  attempts.push(runnerAttempt);
  if (!runnerAttempt.blocked) throw new Error('The isolated test process reached the external probe endpoint.');

  try {
    const backend = await startChildServer('backend', 0, evidenceLines);
    children.push(backend.child);
    attempts.push(backend.egress);
    childProcessIdentities.push({ role: backend.egress.role, ...backend.egress.processIdentity });

    const frontend = await startChildServer('frontend', backend.port, evidenceLines);
    children.push(frontend.child);
    attempts.push(frontend.egress);
    childProcessIdentities.push({ role: frontend.egress.role, ...frontend.egress.processIdentity });

    const command = (file, args) => spawnSync(file, args, { encoding: 'utf8' });
    const namespaceInterfaces = command('ip', ['-brief', 'address', 'show']);
    const namespaceIpv4Routes = command('ip', ['route', 'show']);
    const namespaceIpv6Routes = command('ip', ['-6', 'route', 'show']);
    if (
      namespaceInterfaces.status !== 0 ||
      namespaceIpv4Routes.status !== 0 ||
      namespaceIpv6Routes.status !== 0
    ) {
      throw new Error('Could not inspect the isolated namespace interfaces and routes.');
    }
    namespaceNetwork = {
      interfaces: namespaceInterfaces.stdout.trim(),
      ipv4Routes: namespaceIpv4Routes.stdout.trim(),
      ipv6Routes: namespaceIpv6Routes.stdout.trim(),
    };
    const interfaceLines = namespaceNetwork.interfaces.split('\n').filter(Boolean);
    if (
      interfaceLines.length !== 1 ||
      !interfaceLines[0].startsWith('lo ') ||
      namespaceNetwork.ipv4Routes !== '' ||
      namespaceNetwork.ipv6Routes !== ''
    ) {
      throw new Error(`The isolated namespace has a non-loopback interface or route: ${JSON.stringify(namespaceNetwork)}`);
    }

    const frontendHealth = await fetch(`http://127.0.0.1:${frontend.port}/health`);
    if (await frontendHealth.text() !== 'synthetic-frontend-ok') {
      throw new Error('Loopback frontend endpoint did not respond with the expected synthetic result.');
    }

    const browserLocal = chromeDump(`http://127.0.0.1:${frontend.port}/`);
    if (browserLocal.exitCode !== 0 || !browserLocal.stdout.includes('synthetic-backend-ok')) {
      throw new Error('Headless Chrome could not use loopback frontend-to-backend communication.');
    }

    const chromeVersionResult = spawnSync(chromeBin, ['--version'], { encoding: 'utf8' });
    if (chromeVersionResult.status !== 0) throw new Error('Could not determine the headless Chrome version.');
    chromeVersion = chromeVersionResult.stdout.trim();
    const externalBrowser = chromeDump(`http://127.0.0.1:${frontend.port}/?external=1`, [
      `--host-resolver-rules=MAP example.com ${probeIp}`,
      '--virtual-time-budget=10000',
    ]);
    const externalOutcome = externalBrowser.stdout.match(/id="external-egress">([^<]+)/)?.[1];
    browserDiagnostic = {
      exitCode: externalBrowser.exitCode,
      externalOutcome,
      stdout: externalBrowser.stdout.slice(0, 4000),
      stderr: externalBrowser.stderr.slice(0, 2000),
    };
    if (externalBrowser.exitCode !== 0 || externalOutcome !== 'request-blocked') {
      throw new Error(`Headless Chrome did not affirmatively show its synthetic external GET was blocked: ${JSON.stringify(browserDiagnostic)}`);
    }
    attempts.push({
      label: 'headless-chrome-fetch',
      destination: 'https://example.com/ (no-cors GET from loopback fixture)',
      blocked: true,
      code: 'request-rejected-before-response',
    });

    const evidence = {
      observedAtUtc: new Date().toISOString(),
      runner: process.env.RUNNER_OS ?? 'GitHub-hosted ubuntu-24.04 job',
      nodeVersion: process.version,
      processIdentity: identity,
      childProcessIdentities,
      chromeVersion,
      probeHost: 'example.com',
      resolvedProbeIpv4: probeIp,
      namespaceNetwork,
      loopbackFrontendToBackend: 'PASS in headless Chrome',
      externalAttempts: attempts,
      noAusemioRequests: true,
      setupAndGitHubRunnerControlStayOutsideNamespace: true,
      rawChildEvidence: evidenceLines,
    };
    const evidenceFile = process.env.EGRESS_EVIDENCE_FILE;
    if (evidenceFile) writeFileSync(resolve(evidenceFile), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    const evidenceFile = process.env.EGRESS_EVIDENCE_FILE;
    if (evidenceFile) {
      writeFileSync(resolve(evidenceFile), `${JSON.stringify({
        observedAtUtc: new Date().toISOString(),
        verdict: 'FAIL / INCONCLUSIVE',
        runner: process.env.RUNNER_OS ?? 'GitHub-hosted ubuntu-24.04 job',
        nodeVersion: process.version,
        processIdentity: identity,
        childProcessIdentities,
        chromeVersion,
        probeHost: 'example.com',
        resolvedProbeIpv4: probeIp,
        namespaceNetwork,
        externalAttempts: attempts,
        browserDiagnostic,
        rawChildEvidence: evidenceLines,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2)}\n`, 'utf8');
    }
    throw error;
  } finally {
    for (const child of children.reverse()) child.kill('SIGTERM');
  }
}

if (role?.startsWith('--server=')) {
  await runServerMode(role.slice('--server='.length));
} else {
  await runProof();
}
