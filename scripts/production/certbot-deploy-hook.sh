#!/usr/bin/env bash
set -Eeuo pipefail

readonly config_root='/etc/plfr-production'
readonly lineage="${RENEWED_LINEAGE:-/etc/letsencrypt/live/mapa-svietidiel.sk}"
readonly target="$config_root/tls"
[[ "$(id -u)" -eq 0 ]] || exit 1
case " ${RENEWED_DOMAINS:-} " in
  *' mapa-svietidiel.sk '*) ;;
  *) printf '%s\n' 'Certificate renewal is for another hostname; production certificate was not changed.'; exit 0 ;;
esac
[[ -s "$lineage/fullchain.pem" && -s "$lineage/privkey.pem" ]] || {
  printf '%s\n' 'Renewed certificate material is unavailable.' >&2
  exit 1
}
for host in mapa-svietidiel.sk www.mapa-svietidiel.sk panel.mapa-svietidiel.sk; do
  openssl x509 -in "$lineage/fullchain.pem" -noout -checkhost "$host" >/dev/null
done
openssl x509 -in "$lineage/fullchain.pem" -noout -checkend 604800 >/dev/null
cert_public="$(openssl x509 -in "$lineage/fullchain.pem" -pubkey -noout | openssl sha256)"
key_public="$(openssl pkey -in "$lineage/privkey.pem" -pubout 2>/dev/null | openssl sha256)"
[[ "$cert_public" == "$key_public" ]] || { printf '%s\n' 'Renewed certificate and private key do not match.' >&2; exit 1; }

install -d -o root -g 101 -m 0750 "$target"
cert_tmp="$target/.tls.crt.$$"
key_tmp="$target/.tls.key.$$"
trap 'rm -f -- "$cert_tmp" "$key_tmp"' EXIT
install -o root -g root -m 0644 "$lineage/fullchain.pem" "$cert_tmp"
install -o root -g 101 -m 0640 "$lineage/privkey.pem" "$key_tmp"
mv -f -- "$cert_tmp" "$target/tls.crt"
mv -f -- "$key_tmp" "$target/tls.key"
trap - EXIT
printf '%s\n' 'Verified renewal copied for the next Nginx start.'
