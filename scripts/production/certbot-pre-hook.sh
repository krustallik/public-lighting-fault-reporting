#!/usr/bin/env bash
set -Eeuo pipefail

readonly config_root='/etc/plfr-production'
readonly marker='/run/plfr-certbot-edge-was-running'
[[ "$(id -u)" -eq 0 ]] || exit 1
[[ -f "$config_root/current-release" && -f "$config_root/production.env" ]] || exit 0
[[ ! -e "$marker" ]] || { printf '%s\n' 'Certificate renewal hook marker already exists.' >&2; exit 1; }

sha="$(cat "$config_root/current-release")"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { printf '%s\n' 'Current release marker is invalid.' >&2; exit 1; }
release="/opt/plfr-production/releases/$sha"
compose=(docker compose --project-directory "$release" --env-file "$config_root/production.env" -f "$release/docker-compose.production.yml")
nginx_id="$("${compose[@]}" ps -q nginx)"
[[ -n "$nginx_id" ]] || exit 0
[[ "$(docker inspect --format '{{.State.Status}}' "$nginx_id")" == 'running' ]] || exit 0

printf '%s\n' "$sha" > "$marker"
chmod 0600 "$marker"
"${compose[@]}" stop nginx
