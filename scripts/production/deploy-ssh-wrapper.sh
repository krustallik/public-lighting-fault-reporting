#!/usr/bin/env bash
set -euo pipefail

original_command="${SSH_ORIGINAL_COMMAND:-}"
if [[ "$original_command" =~ ^deploy\ ([0-9a-f]{40})\ ([0-9]{1,20})$ ]]; then
  exec sudo -n /usr/local/sbin/plfr-production-deploy "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
fi

printf '%s\n' 'Only the verified production deploy command is allowed.' >&2
exit 64
