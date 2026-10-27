#!/usr/bin/env bash
set -Eeuo pipefail

readonly config_root="${PLFR_CONFIG_ROOT:-/etc/plfr-production}"
readonly tls_root="$config_root/tls"
[[ "$(id -u)" -eq 0 ]] || { printf '%s\n' 'Certificate installation must run as root.' >&2; exit 1; }
source "${PLFR_RELEASE_RUNTIME:-/opt/plfr-production/control/release-runtime.sh}"
if [[ "${PLFR_RELEASE_LOCK_HELD:-0}" == '1' ]]; then
  plfr_assert_inherited_release_lock
else
  plfr_acquire_release_lock
fi

certificate="${PLFR_CERT_FILE:-${RENEWED_LINEAGE:-/etc/letsencrypt/live/mapa-svietidiel.sk}/fullchain.pem}"
private_key="${PLFR_KEY_FILE:-${RENEWED_LINEAGE:-/etc/letsencrypt/live/mapa-svietidiel.sk}/privkey.pem}"
if [[ -n "${RENEWED_DOMAINS:-}" ]]; then
  for hostname in mapa-svietidiel.sk www.mapa-svietidiel.sk panel.mapa-svietidiel.sk; do
    [[ " ${RENEWED_DOMAINS} " == *" $hostname "* ]] || {
      printf '%s\n' 'Renewed certificate does not declare every production hostname.' >&2
      exit 1
    }
  done
fi
certificate="$(realpath -e -- "$certificate")" || {
  printf '%s\n' 'Renewed certificate path is unavailable.' >&2
  exit 1
}
private_key="$(realpath -e -- "$private_key")" || {
  printf '%s\n' 'Renewed private key path is unavailable.' >&2
  exit 1
}
plfr_validate_certificate_pair "$certificate" "$private_key"

if [[ -e "$config_root/current-release" || -L "$config_root/current-release" ]]; then
  plfr_load_current_release
  plfr_assert_exact_edge_image
fi

install -d -o root -g root -m 0750 "$tls_root"
plfr_install_tls_pair_and_restart "$tls_root" "$certificate" "$private_key"
