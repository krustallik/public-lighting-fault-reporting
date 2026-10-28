#!/usr/bin/env bash
set -Eeuo pipefail

readonly script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/host-path-guards.sh"

readonly rules_source="$script_dir/vpn-ingress-firewall.nft"
readonly unit_source="$script_dir/systemd/plfr-production-vpn-ingress-firewall.service"
readonly docker_dropin_source="$script_dir/systemd/docker.service.d/20-plfr-vpn-ingress.conf"
readonly rules_target='/etc/plfr-production/vpn-ingress-firewall.nft'
readonly unit_target='/etc/systemd/system/plfr-production-vpn-ingress-firewall.service'
readonly verifier_target='/usr/local/sbin/plfr-verify-vpn-ingress'
readonly docker_dropin_dir='/etc/systemd/system/docker.service.d'
readonly docker_dropin_target="$docker_dropin_dir/20-plfr-vpn-ingress.conf"

if [[ "$(id -u)" -ne 0 || $# -ne 0 ]]; then
  printf '%s\n' 'Usage: install-vpn-ingress-firewall.sh (run as root with no arguments)' >&2
  exit 64
fi

for required in nft hostname systemctl systemd-analyze install ip awk grep stat cmp sed; do
  command -v "$required" >/dev/null 2>&1 || {
    printf 'Required host command is missing: %s\n' "$required" >&2
    exit 1
  }
done
[[ "$(command -v nft)" == '/usr/sbin/nft' ]] || {
  printf '%s\n' 'The nftables binary is not at the path used by the systemd unit.' >&2
  exit 1
}

[[ "$(hostname -s)" == 'vra-ubuntu-server-0579' ]] || {
  printf '%s\n' 'Connected host short name does not match the owner-confirmed VPS.' >&2
  exit 1
}
ip -o -4 addr show dev ens160 | awk '$4 ~ /^147\.232\.204\.151\// { found = 1 } END { exit !found }' || {
  printf '%s\n' 'The expected VPS IPv4 address is not configured on ens160.' >&2
  exit 1
}
systemctl is-active --quiet docker.service || {
  printf '%s\n' 'Docker must already be active before installing the VPN ingress guard.' >&2
  exit 1
}
if systemctl is-active --quiet nftables.service || systemctl is-enabled --quiet nftables.service; then
  printf '%s\n' 'The global nftables service is active or enabled; inspect its ruleset before installing the scoped ingress guard.' >&2
  exit 1
fi
[[ -d /etc/plfr-production && ! -L /etc/plfr-production && "$(stat -c '%u' /etc/plfr-production)" == 0 ]] || {
  printf '%s\n' 'The protected production configuration directory is unavailable or unsafe.' >&2
  exit 1
}
[[ -f "$rules_source" && -f "$unit_source" && -f "$docker_dropin_source" && -f "$script_dir/verify-vpn-ingress-firewall.sh" ]] || {
  printf '%s\n' 'A versioned VPN ingress firewall asset is missing.' >&2
  exit 1
}
plfr_require_unclaimed_path "$rules_target" || exit 1
plfr_require_unclaimed_path "$unit_target" || exit 1
plfr_require_unclaimed_path "$verifier_target" || exit 1
plfr_require_unclaimed_path "$docker_dropin_target" || exit 1
if [[ -e "$docker_dropin_dir" || -L "$docker_dropin_dir" ]]; then
  [[ -d "$docker_dropin_dir" && ! -L "$docker_dropin_dir" && "$(stat -c '%u' "$docker_dropin_dir")" == 0 ]] || {
    printf '%s\n' 'The Docker systemd drop-in directory is not a root-owned directory.' >&2
    exit 1
  }
fi
if nft list table inet plfr_vpn_ingress >/dev/null 2>&1; then
  printf '%s\n' 'The reserved VPN ingress nftables table already exists; inspect it before installation.' >&2
  exit 1
fi
nft --check --file "$rules_source"
systemd-analyze verify "$unit_source"

created_dropin_dir=0
if [[ ! -d "$docker_dropin_dir" ]]; then
  install -d -o root -g root -m 0755 "$docker_dropin_dir"
  created_dropin_dir=1
fi
installed=0
rollback_partial_install() {
  local status="$?"
  trap - EXIT
  if (( status != 0 && installed == 0 )); then
    systemctl disable --now plfr-production-vpn-ingress-firewall.service >/dev/null 2>&1 || true
    nft destroy table inet plfr_vpn_ingress >/dev/null 2>&1 || true
    rm -f -- "$rules_target" "$unit_target" "$verifier_target" "$docker_dropin_target"
    if (( created_dropin_dir == 1 )); then rmdir "$docker_dropin_dir" 2>/dev/null || true; fi
    systemctl daemon-reload >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap rollback_partial_install EXIT

install -o root -g root -m 0644 "$rules_source" "$rules_target"
install -o root -g root -m 0644 "$unit_source" "$unit_target"
install -o root -g root -m 0644 "$docker_dropin_source" "$docker_dropin_target"
install -o root -g root -m 0755 "$script_dir/verify-vpn-ingress-firewall.sh" "$verifier_target"
systemctl daemon-reload
systemctl enable --now plfr-production-vpn-ingress-firewall.service
"$script_dir/verify-vpn-ingress-firewall.sh" "$rules_source" "$unit_source" "$docker_dropin_source"

installed=1
printf '%s\n' 'VPN-only edge firewall installed and active; Docker startup now requires the guard.'
