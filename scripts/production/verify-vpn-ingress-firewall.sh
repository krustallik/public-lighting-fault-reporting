#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(id -u)" -ne 0 || ( $# -ne 1 && $# -ne 3 ) ]]; then
  printf '%s\n' 'VPN ingress firewall verification rejected the request.' >&2
  exit 64
fi

expected_rules=''
expected_unit=''
expected_docker_dropin=''
if [[ "$#" == 3 ]]; then
  expected_rules="$1"
  expected_unit="$2"
  expected_docker_dropin="$3"
elif [[ "$1" != '--active' ]]; then
  printf '%s\n' 'VPN ingress firewall verification rejected the request.' >&2
  exit 64
fi
readonly rules_target='/etc/plfr-production/vpn-ingress-firewall.nft'
readonly unit_target='/etc/systemd/system/plfr-production-vpn-ingress-firewall.service'
readonly docker_dropin_target='/etc/systemd/system/docker.service.d/20-plfr-vpn-ingress.conf'

for required in cmp grep nft stat systemctl sed; do
  command -v "$required" >/dev/null 2>&1 || {
    printf '%s\n' 'VPN ingress firewall verification failed.' >&2
    exit 1
  }
done

if [[ "$#" == 3 ]]; then
  for pair in \
    "$expected_rules:$rules_target" \
    "$expected_unit:$unit_target" \
    "$expected_docker_dropin:$docker_dropin_target"; do
    source_path="${pair%%:*}"
    target_path="${pair#*:}"
    [[ -f "$source_path" && ! -L "$source_path" && -f "$target_path" && ! -L "$target_path" &&
       "$(stat -c '%u' "$target_path")" == 0 && "$(stat -c '%a' "$target_path")" == 644 ]] || {
      printf '%s\n' 'VPN ingress firewall files are missing or unsafe.' >&2
      exit 1
    }
    cmp -s -- "$source_path" "$target_path" || {
      printf '%s\n' 'Installed VPN ingress firewall files do not match the exact release.' >&2
      exit 1
    }
  done
else
  assert_installed_asset() {
    local path="$1" expected="$2"
    [[ -f "$path" && ! -L "$path" && "$(stat -c '%u' "$path")" == 0 &&
       "$(stat -c '%a' "$path")" == 644 ]] || {
      printf '%s\n' 'Installed VPN ingress firewall files are missing or unsafe.' >&2
      exit 1
    }
    printf '%s\n' "$expected" | cmp -s - "$path" || {
      printf '%s\n' 'Installed VPN ingress firewall files do not match the approved policy.' >&2
      exit 1
    }
  }
  expected_rules="$(cat <<'EOF'
destroy table inet plfr_vpn_ingress
add table inet plfr_vpn_ingress
add chain inet plfr_vpn_ingress edge_guard { type filter hook prerouting priority raw; policy accept; }
add rule inet plfr_vpn_ingress edge_guard tcp dport { 80, 443 } ip saddr != 147.232.164.0/22 drop comment "plfr-vpn-only-edge"
EOF
)"
  expected_unit="$(cat <<'EOF'
[Unit]
Description=Restrict the production web edge to the TUKE VPN client network
DefaultDependencies=no
After=local-fs.target
Before=network-pre.target docker.service shutdown.target
Wants=network-pre.target
Conflicts=shutdown.target

[Service]
Type=oneshot
ExecStart=/usr/sbin/nft -f /etc/plfr-production/vpn-ingress-firewall.nft
ExecReload=/usr/sbin/nft -f /etc/plfr-production/vpn-ingress-firewall.nft
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
)"
  expected_docker_dropin="$(cat <<'EOF'
[Unit]
Requires=plfr-production-vpn-ingress-firewall.service
After=plfr-production-vpn-ingress-firewall.service
EOF
)"
  assert_installed_asset "$rules_target" "$expected_rules"
  assert_installed_asset "$unit_target" "$expected_unit"
  assert_installed_asset "$docker_dropin_target" "$expected_docker_dropin"
fi

systemctl is-enabled --quiet plfr-production-vpn-ingress-firewall.service &&
  systemctl is-active --quiet plfr-production-vpn-ingress-firewall.service || {
    printf '%s\n' 'The VPN ingress firewall service is not enabled and active.' >&2
    exit 1
  }

requires="$(systemctl show docker.service -p Requires --value)"
after="$(systemctl show docker.service -p After --value)"
[[ " $requires " == *' plfr-production-vpn-ingress-firewall.service '* &&
   " $after " == *' plfr-production-vpn-ingress-firewall.service '* ]] || {
  printf '%s\n' 'Docker is not ordered after and dependent on the VPN ingress firewall.' >&2
  exit 1
}

table="$(nft list table inet plfr_vpn_ingress 2>/dev/null)" || {
  printf '%s\n' 'The active VPN ingress nftables table is missing.' >&2
  exit 1
}
[[ "$(printf '%s\n' "$table" | grep -Ec '^[[:space:]]*chain ')" == 1 ]] || {
  printf '%s\n' 'The active VPN ingress table has an unexpected chain layout.' >&2
  exit 1
}
chain="$(nft list chain inet plfr_vpn_ingress edge_guard 2>/dev/null)" || {
  printf '%s\n' 'The active VPN ingress chain is missing.' >&2
  exit 1
}
printf '%s\n' "$chain" | grep -Fq 'type filter hook prerouting priority raw; policy accept;' || {
  printf '%s\n' 'The VPN ingress chain is not filtering before Docker destination NAT.' >&2
  exit 1
}
actual_rules="$(printf '%s\n' "$chain" | sed -n '/^[[:space:]]*type filter hook prerouting priority raw; policy accept;/,$p' | sed '1d; /^[[:space:]]*}[[:space:]]*$/d; s/^[[:space:]]*//; /^[[:space:]]*$/d')"
expected_rule='tcp dport { 80, 443 } ip saddr != 147.232.164.0/22 drop comment "plfr-vpn-only-edge"'
[[ "$actual_rules" == "$expected_rule" ]] || {
  printf '%s\n' 'The active VPN ingress rule does not match the approved source range and web ports.' >&2
  exit 1
}

printf '%s\n' 'VPN-only public edge firewall verified.'
