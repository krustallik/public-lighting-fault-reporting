#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(id -u)" -eq 0 ]] || { printf '%s\n' 'Certificate post-hook must run as root.' >&2; exit 1; }
source "${PLFR_RELEASE_RUNTIME:-/opt/plfr-production/control/release-runtime.sh}"
plfr_acquire_release_lock
plfr_restart_current_edge
printf 'The current exact-SHA edge was restarted and health-checked: %s\n' "$PLFR_CURRENT_SHA"
