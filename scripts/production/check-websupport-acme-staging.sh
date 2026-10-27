#!/usr/bin/env bash
set -Eeuo pipefail

readonly script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${PLFR_ACME_ENVIRONMENT:-$script_dir/acme-environment.sh}"
source "${PLFR_RELEASE_RUNTIME:-$script_dir/release-runtime.sh}"
readonly lego="${PLFR_LEGO_BIN:-/usr/local/bin/lego}"
readonly state_root="${PLFR_ACME_STAGING_ROOT:-/var/lib/plfr-acme/staging-check}"
[[ "$(id -u)" -eq 0 ]] || { printf '%s\n' 'ACME staging check must run as root.' >&2; exit 1; }
[[ "${PLFR_APPROVE_ACME_STAGING_DNS_CHALLENGE:-}" == 'yes' ]] || {
  printf '%s\n' 'Set PLFR_APPROVE_ACME_STAGING_DNS_CHALLENGE=yes only for an owner-approved staging DNS challenge.' >&2
  exit 64
}
plfr_load_acme_environment
plfr_validate_pinned_lego
[[ -x "$lego" ]] || { printf '%s\n' 'Pinned Lego DNS client is unavailable.' >&2; exit 1; }
for credential_file in "${WEBSUPPORT_API_KEY_FILE:-}" "${WEBSUPPORT_SECRET_FILE:-}"; do
  [[ -n "$credential_file" && -f "$credential_file" && ! -L "$credential_file" && -s "$credential_file" ]] || {
    printf '%s\n' 'Websupport DNS credentials are missing or unsafe.' >&2
    exit 1
  }
  [[ "$(stat -c '%u' "$credential_file")" == 0 ]] || { printf '%s\n' 'A Websupport DNS credential file is not root-owned.' >&2; exit 1; }
  mode="$(stat -c '%a' "$credential_file")"
  (( (8#$mode & 0077) == 0 )) || { printf '%s\n' 'A Websupport DNS credential file is accessible to other users.' >&2; exit 1; }
done
[[ ! -e "$state_root" && ! -L "$state_root" ]] || {
  printf '%s\n' 'ACME staging state already exists; inspect it before retrying.' >&2
  exit 1
}
exec 8>"${PLFR_ACME_STATE_LOCK_FILE:-/run/lock/plfr-production-acme-state.lock}"
flock -n 8 || { printf '%s\n' 'Another ACME challenge or renewal is already running.' >&2; exit 1; }
install -d -o root -g root -m 0700 "$state_root"
trap 'status=$?; if (( status != 0 )); then printf "%s\n" "Staging state retained for diagnosis at the configured private path." >&2; fi; exit "$status"' EXIT

export WEBSUPPORT_HTTP_TIMEOUT=10
export WEBSUPPORT_POLLING_INTERVAL=5
export WEBSUPPORT_PROPAGATION_TIMEOUT=180
export WEBSUPPORT_TTL=600

"$lego" --server https://acme-staging-v02.api.letsencrypt.org/directory \
  --email "$ACME_ACCOUNT_EMAIL" \
  --accept-tos --dns websupport \
  --domains mapa-svietidiel.sk \
  --domains www.mapa-svietidiel.sk \
  --domains panel.mapa-svietidiel.sk \
  --path "$state_root" run

certificate="$state_root/certificates/mapa-svietidiel.sk.crt"
private_key="$state_root/certificates/mapa-svietidiel.sk.key"
PLFR_RELEASE_RUNTIME="${PLFR_RELEASE_RUNTIME:-$(dirname "$0")/release-runtime.sh}" \
  bash -c 'source "$PLFR_RELEASE_RUNTIME"; plfr_validate_certificate_pair "$1" "$2"' _ "$certificate" "$private_key"
printf '%s\n' 'ACME staging issuance and SAN/key-pair checks passed. Staging material was not installed.'
