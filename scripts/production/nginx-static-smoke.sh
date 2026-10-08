#!/usr/bin/env bash
set -euo pipefail

edge_image=${NGINX_SMOKE_EDGE_IMAGE:-public-lighting-edge-smoke:${GITHUB_RUN_ID:-local}}
public_image=${NGINX_SMOKE_PUBLIC_IMAGE:-public-lighting-public-smoke:${GITHUB_RUN_ID:-local}}
admin_image=${NGINX_SMOKE_ADMIN_IMAGE:-public-lighting-admin-smoke:${GITHUB_RUN_ID:-local}}
node_image=${NODE_SMOKE_IMAGE:-node:20.20.0-bookworm-slim@sha256:d8a35d586fad3af7abb6fdb9ba972388395405f4d462da9e4a4ddcde67b5e0fb}
network_name="lighting-pf-smoke-${GITHUB_RUN_ID:-$$}"
tls_dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/lighting-pf-tls-${GITHUB_RUN_ID:-$$}"
http_port=${NGINX_SMOKE_HTTP_PORT:-18080}
https_port=${NGINX_SMOKE_HTTPS_PORT:-18443}
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
docker run --detach --name "$edge_name" --network "$network_name" \
  --publish "127.0.0.1:${http_port}:8080" --publish "127.0.0.1:${https_port}:8443" \
  --volume "$tls_dir:/etc/nginx/tls:ro" "$edge_image" >/dev/null

curl_args=(--silent --show-error --insecure --resolve "$public_host:${https_port}:127.0.0.1")
admin_curl_args=(--silent --show-error --insecure --resolve "$admin_host:${https_port}:127.0.0.1")
ready=false
for attempt in $(seq 1 40); do
  if curl "${curl_args[@]}" "https://${public_host}:${https_port}/" >/dev/null 2>&1; then ready=true; break; fi
  sleep 0.5
done
if [[ "$ready" != true ]]; then docker logs "$edge_name"; exit 1; fi

public_html=$(curl "${curl_args[@]}" "https://${public_host}:${https_port}/map")
admin_html=$(curl "${admin_curl_args[@]}" "https://${admin_host}:${https_port}/street-lights")
grep -q '<title>Oznamovanie porúch verejného osvetlenia</title>' <<<"$public_html"
grep -q '<title>Administrácia verejného osvetlenia</title>' <<<"$admin_html"
! grep -q 'Administrácia verejného osvetlenia' <<<"$public_html"
! grep -q 'Oznamovanie porúch verejného osvetlenia' <<<"$admin_html"
public_build_info=$(curl "${curl_args[@]}" "https://${public_host}:${https_port}/build-info.json")
admin_build_info=$(curl "${admin_curl_args[@]}" "https://${admin_host}:${https_port}/build-info.json")
node -e 'if(JSON.parse(process.argv[1]).application!=="public"||JSON.parse(process.argv[2]).application!=="admin")process.exit(1)' "$public_build_info" "$admin_build_info"
public_index_headers=$(curl "${curl_args[@]}" -D - -o /dev/null "https://${public_host}:${https_port}/index.html")
grep -qi '^Cache-Control: no-cache' <<<"$public_index_headers"

health=$(curl "${curl_args[@]}" -H 'X-Forwarded-For: 203.0.113.91' \
  -H 'X-Forwarded-Host: attacker.example' -H 'X-Forwarded-Proto: http' \
  -H 'Forwarded: for=203.0.113.91;host=attacker.example;proto=http' \
  -H 'X-Real-IP: 203.0.113.92' "https://${public_host}:${https_port}/api/health")
node -e 'const x=JSON.parse(process.argv[1]);if(x.url!=="/api/health"||x.host!==process.argv[2]||x.xfh!==process.argv[2]||x.xfp!=="https"||String(x.xff).includes("203.0.113.91")||String(x.forwarded??"").includes("attacker.example")||String(x.xreal??"").includes("203.0.113.92"))process.exit(1)' "$health" "$public_host"

public_admin_status=$(curl "${curl_args[@]}" -o /dev/null -w '%{http_code}' "https://${public_host}:${https_port}/api/admin/auth/me")
admin_public_status=$(curl "${admin_curl_args[@]}" -o /dev/null -w '%{http_code}' "https://${admin_host}:${https_port}/api/light-points")
unknown_api_status=$(curl "${curl_args[@]}" -o /dev/null -w '%{http_code}' "https://${public_host}:${https_port}/api/unexpected")
public_api_root_status=$(curl "${curl_args[@]}" -o /dev/null -w '%{http_code}' "https://${public_host}:${https_port}/api")
admin_api_root_status=$(curl "${admin_curl_args[@]}" -o /dev/null -w '%{http_code}' "https://${admin_host}:${https_port}/api")
test "$public_admin_status" = 404
test "$admin_public_status" = 404
test "$unknown_api_status" = 404
test "$public_api_root_status" = 404
test "$admin_api_root_status" = 404

set +e
unknown_host_status=$(curl --silent --show-error --insecure --max-time 3 \
  --resolve "unknown.example:${https_port}:127.0.0.1" \
  -o /dev/null -w '%{http_code}' "https://unknown.example:${https_port}/" 2>/dev/null)
unknown_host_exit=$?
set -e
test "$unknown_host_status" = 000
test "$unknown_host_exit" -ne 0

cookie_headers=$(curl "${admin_curl_args[@]}" -D - -o /dev/null -X POST \
  "https://${admin_host}:${https_port}/api/admin/auth/login")
grep -qi '^Set-Cookie: __Host-access_token=' <<<"$cookie_headers"
grep -qi '^Cache-Control: no-store' <<<"$cookie_headers"

redirect_status=$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Host: $public_host" "http://127.0.0.1:${http_port}/")
test "$redirect_status" = 308

oversize_file="${tls_dir}/oversize.bin"
head -c $((6 * 1024 * 1024 + 1)) /dev/zero > "$oversize_file"
oversize_status=$(curl --silent --output /dev/null --write-out '%{http_code}' \
  "${admin_curl_args[@]}" -X POST -H 'Content-Type: application/octet-stream' \
  --data-binary "@${oversize_file}" "https://${admin_host}:${https_port}/api/admin/street-lights/import/preview")
test "$oversize_status" = 413

echo 'Production Nginx smoke passed: separate static images/origins, deep links, API-first routing/boundaries, forwarded-header overwrite, cache, redirect, unknown-host rejection, and body cap on an internal-only synthetic network.'
