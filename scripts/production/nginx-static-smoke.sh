#!/usr/bin/env bash
set -euo pipefail

edge_image=${NGINX_SMOKE_EDGE_IMAGE:-public-lighting-edge-smoke:${GITHUB_RUN_ID:-local}}
public_image=${NGINX_SMOKE_PUBLIC_IMAGE:-public-lighting-public-smoke:${GITHUB_RUN_ID:-local}}
admin_image=${NGINX_SMOKE_ADMIN_IMAGE:-public-lighting-admin-smoke:${GITHUB_RUN_ID:-local}}
node_image=${NODE_SMOKE_IMAGE:-node:20.20.0-bookworm-slim@sha256:d8a35d586fad3af7abb6fdb9ba972388395405f4d462da9e4a4ddcde67b5e0fb}
network_name="lighting-pf-smoke-${GITHUB_RUN_ID:-$$}"
tls_dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/lighting-pf-tls-${GITHUB_RUN_ID:-$$}"
public_host=mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk
admin_host=admin.mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk
backend_name="lighting-pf-backend-${GITHUB_RUN_ID:-$$}"
edge_name="lighting-pf-edge-${GITHUB_RUN_ID:-$$}"
public_name="lighting-pf-public-${GITHUB_RUN_ID:-$$}"
admin_name="lighting-pf-admin-${GITHUB_RUN_ID:-$$}"

cleanup() {
  docker rm -f "$edge_name" "$backend_name" "$public_name" "$admin_name" >/dev/null 2>&1 || true
  docker network rm "$network_name" >/dev/null 2>&1 || true
  rm -rf "$tls_dir"
}
trap cleanup EXIT
trap 'status=$?; printf "%s\n" "Production Nginx smoke failed at line ${BASH_LINENO[0]:-?}: $BASH_COMMAND" >&2; exit "$status"' ERR

mkdir -p "$tls_dir"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "$tls_dir/tls.key" -out "$tls_dir/tls.crt" \
  -subj "/CN=$public_host" -addext "subjectAltName=DNS:$public_host,DNS:$admin_host" >/dev/null 2>&1
chmod 0444 "$tls_dir/tls.key" "$tls_dir/tls.crt"

docker network create --internal "$network_name" >/dev/null
docker run --detach --name "$backend_name" --network "$network_name" --network-alias backend \
  --entrypoint node "$node_image" -e \
  'require("node:http").createServer((req,res)=>{res.setHeader("content-type","application/json");if(req.url==="/api/admin/auth/login")res.setHeader("set-cookie","__Host-access_token=synthetic; Secure; HttpOnly; Path=/; SameSite=Lax");res.end(JSON.stringify({url:req.url,host:req.headers.host,xff:req.headers["x-forwarded-for"],xfh:req.headers["x-forwarded-host"],xfp:req.headers["x-forwarded-proto"],forwarded:req.headers.forwarded,xreal:req.headers["x-real-ip"]}))}).listen(5000,"0.0.0.0")' >/dev/null
docker run --detach --name "$public_name" --network "$network_name" --network-alias public-app "$public_image" >/dev/null
docker run --detach --name "$admin_name" --network "$network_name" --network-alias admin-app "$admin_image" >/dev/null
upstreams_ready=false
for attempt in $(seq 1 40); do
  if docker exec "$backend_name" node -e '
    Promise.all(["public-app", "admin-app"].map(async (host) => {
      const response = await fetch(`http://${host}:8080/`, { signal: AbortSignal.timeout(1000) });
      if (!response.ok) throw new Error(`${host} returned ${response.status}`);
      await response.body?.cancel();
    })).then(() => process.exit(0)).catch(() => process.exit(1));
  ' >/dev/null 2>&1; then
    upstreams_ready=true
    break
  fi
  sleep 0.5
done
if [[ "$upstreams_ready" != true ]]; then
  echo 'Synthetic public/admin static upstreams did not become ready before edge startup.'
  docker logs "$public_name"
  docker logs "$admin_name"
  exit 1
fi
docker run --detach --name "$edge_name" --network "$network_name" --network-alias edge --volume "$tls_dir:/etc/nginx/tls:ro" "$edge_image" >/dev/null

docker exec --interactive \
  --env "SMOKE_PUBLIC_HOST=$public_host" \
  --env "SMOKE_ADMIN_HOST=$admin_host" \
  "$backend_name" node - <<'NODE'
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');

const publicHost = process.env.SMOKE_PUBLIC_HOST;
const adminHost = process.env.SMOKE_ADMIN_HOST;

function request(client, options, body) {
  return new Promise((resolve, reject) => {
    let responseStarted = false;
    const req = client.request(options, (res) => {
      responseStarted = true;
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      const finish = () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.on('end', finish);
      res.on('aborted', finish);
      res.on('error', finish);
    });
    req.setTimeout(5000, () => req.destroy(new Error('synthetic edge request timed out')));
    req.on('error', (error) => { if (!responseStarted) reject(error); });
    req.end(body);
  });
}

function tls(host, path, method = 'GET', headers = {}, body) {
  return request(https, {
    hostname: 'edge',
    port: 8443,
    servername: host,
    rejectUnauthorized: false,
    method,
    path,
    headers: { ...headers, Host: host },
  }, body);
}

async function waitForEdge() {
  let lastError = 'no response';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await tls(publicHost, '/');
      if (response.status === 200) return;
      lastError = 'HTTP ' + response.status;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Synthetic edge did not become ready on its internal network: ' + lastError);
}

async function main() {
  await waitForEdge();

  const publicPage = await tls(publicHost, '/map');
  const adminPage = await tls(adminHost, '/street-lights');
  assert.equal(publicPage.status, 200);
  assert.equal(adminPage.status, 200);
  assert.ok(publicPage.body.includes('<title>Oznamovanie porúch verejného osvetlenia</title>'));
  assert.ok(adminPage.body.includes('<title>Administrácia verejného osvetlenia</title>'));
  assert.ok(!publicPage.body.includes('Administrácia verejného osvetlenia'));
  assert.ok(!adminPage.body.includes('Oznamovanie porúch verejného osvetlenia'));
  console.log('PASS: separate public/admin host routing and SPA deep links');

  const publicBuild = await tls(publicHost, '/build-info.json');
  const adminBuild = await tls(adminHost, '/build-info.json');
  assert.equal(JSON.parse(publicBuild.body).application, 'public');
  assert.equal(JSON.parse(adminBuild.body).application, 'admin');
  const publicIndex = await tls(publicHost, '/index.html');
  assert.match(publicIndex.headers['cache-control'] ?? '', /no-cache/i);
  console.log('PASS: separate build artifacts and HTML cache policy');

  const health = await tls(publicHost, '/api/health', 'GET', {
    'X-Forwarded-For': '203.0.113.91',
    'X-Forwarded-Host': 'attacker.example',
    'X-Forwarded-Proto': 'http',
    Forwarded: 'for=203.0.113.91;host=attacker.example;proto=http',
    'X-Real-IP': '203.0.113.92',
  });
  const healthBody = JSON.parse(health.body);
  assert.equal(health.status, 200);
  assert.equal(healthBody.url, '/api/health');
  assert.equal(healthBody.host, publicHost);
  assert.equal(healthBody.xfh, publicHost);
  assert.equal(healthBody.xfp, 'https');
  assert.ok(!String(healthBody.xff ?? '').includes('203.0.113.91'));
  assert.ok(!String(healthBody.forwarded ?? '').includes('attacker.example'));
  assert.ok(!String(healthBody.xreal ?? '').includes('203.0.113.92'));

  const blockedRoutes = [
    [publicHost, '/api/admin/auth/me'],
    [adminHost, '/api/light-points'],
    [publicHost, '/api/unexpected'],
    [publicHost, '/api'],
    [adminHost, '/api'],
  ];
  for (const [host, path] of blockedRoutes) {
    assert.equal((await tls(host, path)).status, 404, host + ' ' + path);
  }
  console.log('PASS: forwarded-header replacement and public/admin API boundaries');

  const unknownHost = await tls('unknown.example', '/').then(
    (response) => response,
    () => null
  );
  assert.equal(unknownHost, null, 'unknown TLS host must be rejected without a response');

  const login = await tls(adminHost, '/api/admin/auth/login', 'POST');
  const cookie = login.headers['set-cookie'];
  assert.equal(login.status, 200);
  assert.ok(String(cookie ?? '').includes('__Host-access_token='));
  assert.equal(login.headers['cache-control'], 'no-store');

  const redirect = await request(http, {
    hostname: 'edge',
    port: 8080,
    path: '/',
    method: 'GET',
    headers: { Host: publicHost },
  });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.location, 'https://' + publicHost + '/');

  const oversized = Buffer.alloc(6 * 1024 * 1024 + 1);
  const upload = await tls(adminHost, '/api/admin/street-lights/import/preview', 'POST', {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(oversized.length),
  }, oversized);
  assert.equal(upload.status, 413);
  console.log('PASS: unknown-host rejection, cookie/cache headers, HTTPS redirect, and 6 MiB body cap');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
NODE

echo 'Production Nginx smoke passed: internal-only synthetic network, separate static origins, API boundaries, forwarded-header overwrite, cache, host rejection, HTTPS redirect, and body cap.'
