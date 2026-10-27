#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(id -u)" -eq 0 ]] || { printf '%s\n' 'Certificate preflight must run as root.' >&2; exit 1; }
source "${PLFR_RELEASE_RUNTIME:-/opt/plfr-production/control/release-runtime.sh}"
plfr_acquire_release_lock
plfr_load_current_release
plfr_assert_exact_edge_image
# DNS-01 does not require stopping Nginx or freeing port 80. Keep HTTPS live
# while the provider performs its bounded TXT challenge.
printf 'Certificate challenge preflight passed for release %s; edge remains running.\n' "$PLFR_CURRENT_SHA"
