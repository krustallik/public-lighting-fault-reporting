#!/usr/bin/env bash
set -Eeuo pipefail

readonly app_root='/opt/plfr-production'
readonly config_root='/etc/plfr-production'
readonly env_file="$config_root/production.env"
readonly volume_name='public-lighting-production-pgdata'
readonly release_dir="$(git -C "$(dirname "$(realpath "$0")")" rev-parse --show-toplevel)"
readonly compose_file="$release_dir/docker-compose.production.yml"

if [[ "$(id -u)" -ne 0 || $# -ne 2 ]]; then
  printf '%s\n' 'Release deployment rejected the request.' >&2
  exit 64
fi
sha="$1"
run_id="$2"
[[ "$sha" =~ ^[0-9a-f]{40}$ && "$run_id" =~ ^[0-9]{1,20}$ ]] || {
  printf '%s\n' 'Release deployment rejected malformed release metadata.' >&2
  exit 64
}

exec 9>/run/lock/plfr-production-deploy.lock
flock -n 9 || { printf '%s\n' 'Another production deployment is already running.' >&2; exit 1; }

python3 "$release_dir/scripts/production/verify_github_release.py" "$sha" "$run_id"
[[ -f "$env_file" && ! -L "$env_file" ]] || { printf '%s\n' 'Production environment file is missing or unsafe.' >&2; exit 1; }
[[ "$(stat -c '%u' "$env_file")" == 0 ]] || { printf '%s\n' 'Production environment file must be root-owned.' >&2; exit 1; }
mode="$(stat -c '%a' "$env_file")"
(( (8#$mode & 0077) == 0 )) || { printf '%s\n' 'Production environment file permissions are too broad.' >&2; exit 1; }

env_value() {
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); gsub(/^\047|\047$/, ""); gsub(/^"|"$/, ""); print; exit }' "$env_file"
}

[[ "$(env_value REPORT_SUBMISSION_MODE)" == 'local-persistence' ]] || { printf '%s\n' 'Production local-persistence mode is not enabled.' >&2; exit 1; }
[[ "$(env_value EMAIL_VERIFICATION_ENABLED)" == 'true' ]] || { printf '%s\n' 'Production email verification is not enabled.' >&2; exit 1; }
[[ "$(env_value GEOAPIFY_ENABLED)" == 'true' ]] || { printf '%s\n' 'Geoapify is not enabled in production configuration.' >&2; exit 1; }
[[ "$(env_value NOMINATIM_AUTO_GEOCODE)" == 'false' ]] || { printf '%s\n' 'Automatic Nominatim geocoding must remain disabled.' >&2; exit 1; }
[[ "$(env_value LOCAL_TEST_SUBMIT_ENABLED)" == 'false' ]] || { printf '%s\n' 'Development local-test submission must remain disabled.' >&2; exit 1; }
[[ "$(env_value PRODUCTION_DB_VOLUME)" == "$volume_name" ]] || { printf '%s\n' 'Production database volume name is not the approved volume.' >&2; exit 1; }
[[ "$(env_value DB_NAME)" =~ ^[A-Za-z0-9_]{1,63}$ ]] || { printf '%s\n' 'Production database name is invalid.' >&2; exit 1; }

secret_paths=(
  "$(env_value DB_ADMIN_PASSWORD_FILE)"
  "$(env_value DB_RUNTIME_PASSWORD_FILE)"
  "$(env_value DB_MIGRATION_PASSWORD_FILE)"
  "$(env_value JWT_SECRET_FILE)"
  "$(env_value GEOAPIFY_API_KEY_FILE)"
  "$(env_value RESEND_API_KEY_FILE)"
)
for secret_path in "${secret_paths[@]}"; do
  [[ -n "$secret_path" && -f "$secret_path" && ! -L "$secret_path" && -s "$secret_path" ]] || {
    printf '%s\n' 'A required production secret file is missing or empty.' >&2
    exit 1
  }
  [[ "$(stat -c '%u' "$secret_path")" == 0 ]] || { printf '%s\n' 'A production secret file is not root-owned.' >&2; exit 1; }
  secret_mode="$(stat -c '%a' "$secret_path")"
  (( (8#$secret_mode & 0007) == 0 )) || { printf '%s\n' 'A production secret file is accessible to other users.' >&2; exit 1; }
done
[[ -n "$(env_value RESEND_FROM_EMAIL)" ]] || { printf '%s\n' 'Production OTP sender is not configured.' >&2; exit 1; }
[[ -n "$(env_value VITE_CARTO_PUBLIC_KEY)" ]] || { printf '%s\n' 'Production CARTO public key is not configured.' >&2; exit 1; }

tls_dir="$(env_value TLS_DIRECTORY)"
[[ "$tls_dir" == "$config_root/tls" && -d "$tls_dir" && ! -L "$tls_dir" ]] || {
  printf '%s\n' 'Approved production TLS directory is missing.' >&2
  exit 1
}
[[ -s "$tls_dir/tls.crt" && -s "$tls_dir/tls.key" && ! -L "$tls_dir/tls.crt" && ! -L "$tls_dir/tls.key" ]] || {
  printf '%s\n' 'Production TLS certificate or private key is missing.' >&2
  exit 1
}
openssl x509 -in "$tls_dir/tls.crt" -noout -checkhost mapa-svietidiel.sk >/dev/null
openssl x509 -in "$tls_dir/tls.crt" -noout -checkhost www.mapa-svietidiel.sk >/dev/null
openssl x509 -in "$tls_dir/tls.crt" -noout -checkhost panel.mapa-svietidiel.sk >/dev/null
openssl x509 -in "$tls_dir/tls.crt" -noout -checkend 604800 >/dev/null
cert_public="$(openssl x509 -in "$tls_dir/tls.crt" -pubkey -noout | openssl sha256)"
key_public="$(openssl pkey -in "$tls_dir/tls.key" -pubout 2>/dev/null | openssl sha256)"
[[ "$cert_public" == "$key_public" ]] || { printf '%s\n' 'TLS certificate and private key do not match.' >&2; exit 1; }

[[ "$(git -C "$release_dir" rev-parse HEAD)" == "$sha" ]] || { printf '%s\n' 'Release checkout is not the exact verified SHA.' >&2; exit 1; }
[[ -z "$(git -C "$release_dir" status --porcelain)" ]] || { printf '%s\n' 'Release checkout is not clean.' >&2; exit 1; }

compose=(docker compose --project-directory "$release_dir" --env-file "$env_file" -f "$compose_file")
export APP_BUILD_SHA="$sha" PUBLIC_BUILD_ID="$sha" ADMIN_BUILD_ID="$sha"
"${compose[@]}" config --quiet

docker volume inspect "$volume_name" >/dev/null 2>&1 || {
  printf '%s\n' 'The approved production database volume is absent; refusing to create or initialize it during deployment.' >&2
  exit 1
}
db_id="$("${compose[@]}" ps -q db)"
[[ -n "$db_id" && "$(docker inspect --format '{{.State.Health.Status}}' "$db_id" 2>/dev/null || true)" == 'healthy' ]] || {
  printf '%s\n' 'The existing production database container is not healthy; refusing rollout.' >&2
  exit 1
}
db_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$db_id")"
[[ "$db_volume" == "$volume_name" ]] || { printf '%s\n' 'The running database is not attached to the approved persistent volume.' >&2; exit 1; }

current_file="$config_root/current-release"
previous_sha=''
if [[ -f "$current_file" ]]; then
  previous_sha="$(cat "$current_file")"
  [[ "$previous_sha" =~ ^[0-9a-f]{40}$ && -d "$app_root/releases/$previous_sha" ]] || {
    printf '%s\n' 'Current release marker is invalid; refusing rollout.' >&2
    exit 1
  }
  previous_compose=(docker compose --project-directory "$app_root/releases/$previous_sha" --env-file "$env_file" -f "$app_root/releases/$previous_sha/docker-compose.production.yml")
else
  for service in backend public-app admin-app nginx; do
    [[ -z "$("${compose[@]}" ps -q "$service")" ]] || {
      printf '%s\n' 'Application containers exist without a trusted release marker; refusing rollout.' >&2
      exit 1
    }
  done
fi

# Build in a single job on this 2-vCPU host; no deployment is attempted until
# all exact-SHA source images have built and the database ledger is proven read-only.
"${compose[@]}" --parallel 1 build --pull backend public-app admin-app nginx
for image in \
  "public-lighting-backend:$sha" \
  "public-lighting-public:$sha" \
  "public-lighting-admin:$sha" \
  "public-lighting-edge:$sha"; do
  [[ "$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")" == "$sha" ]] || {
    printf '%s\n' 'A built production image does not carry the exact release revision.' >&2
    exit 1
  }
done

# This container runs the packaged-ledger check with the restricted migration
# role. It performs SELECT-only validation and never executes a migration.
"${compose[@]}" --profile release run --rm --no-deps migration-check

rollout() {
  local release_sha="$1"
  APP_BUILD_SHA="$release_sha" PUBLIC_BUILD_ID="$release_sha" ADMIN_BUILD_ID="$release_sha" \
    "${compose[@]}" up -d --wait --wait-timeout 180 --no-deps backend public-app admin-app || return 1
  APP_BUILD_SHA="$release_sha" PUBLIC_BUILD_ID="$release_sha" ADMIN_BUILD_ID="$release_sha" \
    "${compose[@]}" up -d --wait --wait-timeout 180 --no-deps nginx || return 1
  curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
    --resolve mapa-svietidiel.sk:443:127.0.0.1 https://mapa-svietidiel.sk/api/health -o /dev/null || return 1
  curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
    --resolve mapa-svietidiel.sk:443:127.0.0.1 https://mapa-svietidiel.sk/map -o /dev/null || return 1
  curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
    --resolve panel.mapa-svietidiel.sk:443:127.0.0.1 https://panel.mapa-svietidiel.sk/panel-svietidla/login -o /dev/null || return 1
}

if rollout "$sha"; then
  marker_tmp="$config_root/.current-release-$sha.tmp"
  printf '%s\n' "$sha" > "$marker_tmp"
  chown root:root "$marker_tmp"
  chmod 0600 "$marker_tmp"
  mv -f -- "$marker_tmp" "$current_file"
  printf 'Production release deployed and local HTTPS health checks passed: %s\n' "$sha"
  exit 0
fi

printf '%s\n' 'New release health check failed; attempting image-only rollback.' >&2
if [[ -n "$previous_sha" ]]; then
  if APP_BUILD_SHA="$previous_sha" PUBLIC_BUILD_ID="$previous_sha" ADMIN_BUILD_ID="$previous_sha" \
    "${previous_compose[@]}" up -d --wait --wait-timeout 180 --no-build --pull never --no-deps backend public-app admin-app \
    && APP_BUILD_SHA="$previous_sha" PUBLIC_BUILD_ID="$previous_sha" ADMIN_BUILD_ID="$previous_sha" \
    "${previous_compose[@]}" up -d --wait --wait-timeout 180 --no-build --pull never --no-deps nginx \
    && curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
      --resolve mapa-svietidiel.sk:443:127.0.0.1 https://mapa-svietidiel.sk/api/health -o /dev/null; then
    printf 'Image-only rollback restored previous release %s; database was untouched.\n' "$previous_sha" >&2
  else
    printf 'Rollback failed; leave database and containers in place for recovery. Previous SHA: %s\n' "$previous_sha" >&2
  fi
else
  APP_BUILD_SHA="$sha" PUBLIC_BUILD_ID="$sha" ADMIN_BUILD_ID="$sha" \
    "${compose[@]}" stop nginx backend public-app admin-app >/dev/null 2>&1 || true
  printf '%s\n' 'First release stopped; database volume was left untouched.' >&2
fi
exit 1
