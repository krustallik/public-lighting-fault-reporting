#!/usr/bin/env bash
set -Eeuo pipefail

readonly config_root='/etc/plfr-production'
readonly marker='/run/plfr-certbot-edge-was-running'
[[ "$(id -u)" -eq 0 ]] || exit 1
[[ -f "$marker" ]] || exit 0

sha="$(cat "$marker")"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { printf '%s\n' 'Certificate renewal marker is invalid.' >&2; exit 1; }
release="/opt/plfr-production/releases/$sha"
[[ -f "$release/docker-compose.production.yml" && -f "$config_root/production.env" ]] || {
  printf '%s\n' 'Recorded production release is unavailable; refusing to start a different edge.' >&2
  exit 1
}
compose=(docker compose --project-directory "$release" --env-file "$config_root/production.env" -f "$release/docker-compose.production.yml")
"${compose[@]}" up -d --wait --wait-timeout 90 --no-deps nginx
rm -- "$marker"
