#!/usr/bin/env bash

plfr_load_acme_environment() {
  local environment_file="${PLFR_ACME_ENV_FILE:-/etc/plfr-production/acme.env}"
  [[ -f "$environment_file" && ! -L "$environment_file" && "$(stat -c '%u' "$environment_file")" == 0 && "$(stat -c '%a' "$environment_file")" == 600 ]] || {
    printf '%s\n' 'Protected ACME environment file is missing or unsafe.' >&2
    return 1
  }
  set -a
  # This file is root-owned, mode 0600, and contains only owner-managed ACME
  # contact data plus paths to separately protected credentials.
  source "$environment_file"
  set +a
  [[ "${ACME_ACCOUNT_EMAIL:-}" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ && "${#ACME_ACCOUNT_EMAIL}" -le 254 ]] || {
    printf '%s\n' 'ACME_ACCOUNT_EMAIL is missing or invalid.' >&2
    return 1
  }
  plfr_validate_websupport_credentials
}

plfr_validate_websupport_credentials() {
  local credential_file mode
  for credential_file in "${WEBSUPPORT_API_KEY_FILE:-}" "${WEBSUPPORT_SECRET_FILE:-}"; do
    [[ -n "$credential_file" && -f "$credential_file" && ! -L "$credential_file" && -s "$credential_file" ]] || {
      printf '%s\n' 'Websupport DNS credentials are missing or unsafe.' >&2
      return 1
    }
    [[ "$(stat -c '%u' "$credential_file")" == 0 ]] || { printf '%s\n' 'A Websupport DNS credential file is not root-owned.' >&2; return 1; }
    mode="$(stat -c '%a' "$credential_file")"
    (( (8#$mode & 0077) == 0 )) || { printf '%s\n' 'A Websupport DNS credential file is accessible to other users.' >&2; return 1; }
  done
}

plfr_validate_pinned_lego() {
  local lego_bin="${PLFR_LEGO_BIN:-/usr/local/bin/lego}" version parsed_version=''
  [[ -x "$lego_bin" ]] || { printf '%s\n' 'Pinned Lego DNS client is unavailable.' >&2; return 1; }
  version="$("$lego_bin" --version 2>/dev/null || true)"
  if [[ "$version" =~ (^|[^[:alnum:]])v?([0-9]+\.[0-9]+\.[0-9]+)([[:space:]]|$) ]]; then
    parsed_version="${BASH_REMATCH[2]}"
  fi
  [[ "$parsed_version" == '5.5.2' ]] || { printf '%s\n' 'Only the reviewed Lego 5.5.2 DNS client is supported.' >&2; return 1; }
}
