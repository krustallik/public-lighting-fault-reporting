#!/usr/bin/env bash
set -Eeuo pipefail

readonly script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${PLFR_ACME_ENVIRONMENT:-$script_dir/acme-environment.sh}"
source "${PLFR_RELEASE_RUNTIME:-$script_dir/release-runtime.sh}"
readonly config_root="${PLFR_CONFIG_ROOT:-/etc/plfr-production}"
readonly acme_root="${PLFR_ACME_ROOT:-/var/lib/plfr-acme/production}"
readonly lego="${PLFR_LEGO_BIN:-/usr/local/bin/lego}"
readonly install_hook="${PLFR_TLS_INSTALL_HOOK:-/opt/plfr-production/control/certbot-deploy-hook.sh}"

[[ "$(id -u)" -eq 0 ]] || { printf '%s\n' 'Production certificate renewal must run as root.' >&2; exit 1; }
plfr_load_acme_environment
plfr_validate_pinned_lego
[[ "${ACME_RENEWAL_ENABLED:-false}" == 'true' ]] || {
  printf '%s\n' 'ACME renewal is not enabled in the protected service environment.' >&2
  exit 1
}
[[ -x "$lego" ]] || { printf '%s\n' 'Pinned Lego DNS client is unavailable.' >&2; exit 1; }
[[ -n "${ACME_ACCOUNT_EMAIL:-}" && "$ACME_ACCOUNT_EMAIL" == *'@'* ]] || {
  printf '%s\n' 'ACME_ACCOUNT_EMAIL is missing or invalid.' >&2
  exit 1
}
for credential_file in "${WEBSUPPORT_API_KEY_FILE:-}" "${WEBSUPPORT_SECRET_FILE:-}"; do
  [[ -n "$credential_file" && -f "$credential_file" && ! -L "$credential_file" && -s "$credential_file" ]] || {
    printf '%s\n' 'Websupport DNS credentials are missing or unsafe.' >&2
    exit 1
  }
  [[ "$(stat -c '%u' "$credential_file")" == 0 ]] || { printf '%s\n' 'A Websupport DNS credential file is not root-owned.' >&2; exit 1; }
  mode="$(stat -c '%a' "$credential_file")"
  (( (8#$mode & 0077) == 0 )) || { printf '%s\n' 'A Websupport DNS credential file is accessible to other users.' >&2; exit 1; }
done
[[ -d "$acme_root" && ! -L "$acme_root" && "$(stat -c '%u' "$acme_root")" == 0 && "$(stat -c '%a' "$acme_root")" == 700 ]] || {
  printf '%s\n' 'ACME state directory must be a root-owned, mode-0700 directory.' >&2
  exit 1
}
[[ -f "$install_hook" && ! -L "$install_hook" ]] || { printf '%s\n' 'Verified TLS installation hook is unavailable.' >&2; exit 1; }

plfr_acquire_release_lock
exec 8>"${PLFR_ACME_STATE_LOCK_FILE:-/run/lock/plfr-production-acme-state.lock}"
flock -n 8 || { printf '%s\n' 'Another ACME issuance or renewal is already running.' >&2; exit 1; }

export WEBSUPPORT_HTTP_TIMEOUT=10
export WEBSUPPORT_POLLING_INTERVAL=5
export WEBSUPPORT_PROPAGATION_TIMEOUT=180
export WEBSUPPORT_TTL=600

"$lego" --email "$ACME_ACCOUNT_EMAIL" --accept-tos --dns websupport \
  --domains mapa-svietidiel.sk \
  --domains www.mapa-svietidiel.sk \
  --domains panel.mapa-svietidiel.sk \
  --path "$acme_root" renew --days 30

certificate="$acme_root/certificates/mapa-svietidiel.sk.crt"
private_key="$acme_root/certificates/mapa-svietidiel.sk.key"
[[ -s "$certificate" && -s "$private_key" ]] || { printf '%s\n' 'Lego renewal did not produce the expected certificate lineage.' >&2; exit 1; }
PLFR_CERT_FILE="$certificate" PLFR_KEY_FILE="$private_key" \
  PLFR_RELEASE_LOCK_HELD=1 PLFR_RELEASE_RUNTIME="${PLFR_RELEASE_RUNTIME:-$script_dir/release-runtime.sh}" \
  PLFR_RELEASE_LOCK_FILE="${PLFR_RELEASE_LOCK_FILE:-/run/lock/plfr-production-release.lock}" \
  "$install_hook"
