#!/usr/bin/env bash
set -Eeuo pipefail

readonly repository_url='https://github.com/krustallik/public-lighting-fault-reporting.git'
readonly releases_root='/opt/plfr-production/releases'

if [[ "$(id -u)" -ne 0 || $# -ne 2 ]]; then
  printf '%s\n' 'Deployment entrypoint rejected the request.' >&2
  exit 64
fi
sha="$1"
run_id="$2"
[[ "$sha" =~ ^[0-9a-f]{40}$ && "$run_id" =~ ^[0-9]{1,20}$ ]] || {
  printf '%s\n' 'Deployment entrypoint rejected malformed release metadata.' >&2
  exit 64
}

exec 8>/run/lock/plfr-production-fetch.lock
flock -w 600 8 || { printf '%s\n' 'Timed out waiting for the production release checkout lock.' >&2; exit 1; }

python3 /opt/plfr-production/control/verify_github_release.py "$sha" "$run_id"
install -d -o root -g root -m 0755 "$releases_root"
release="$releases_root/$sha"
incoming=''
cleanup_incoming_checkout() {
  local status="$?"
  trap - EXIT
  if [[ -n "$incoming" && -e "$incoming" ]]; then
    rm -rf -- "$incoming"
  fi
  exit "$status"
}
trap cleanup_incoming_checkout EXIT

if [[ -e "$release" ]]; then
  [[ -d "$release/.git" ]] || {
    printf '%s\n' 'Release path already exists and is not a verified checkout; stopping.' >&2
    exit 1
  }
  [[ "$(git -C "$release" rev-parse HEAD 2>/dev/null || true)" == "$sha" ]] || {
    printf '%s\n' 'Existing release checkout does not match the requested SHA; stopping.' >&2
    exit 1
  }
  [[ -z "$(git -C "$release" status --porcelain)" ]] || {
    printf '%s\n' 'Existing release checkout is not clean; stopping.' >&2
    exit 1
  }
else
  incoming="$releases_root/.incoming-$sha-$$"
  git clone --filter=blob:none --no-checkout "$repository_url" "$incoming" >/dev/null
  git -C "$incoming" fetch --depth=1 origin "$sha" >/dev/null
  git -C "$incoming" checkout --detach "$sha" >/dev/null
  [[ "$(git -C "$incoming" rev-parse HEAD)" == "$sha" ]] || {
    printf '%s\n' 'Fetched release SHA did not match the requested commit.' >&2
    exit 1
  }
  chown -R root:root "$incoming"
  chmod -R go-w "$incoming"
  mv -T -- "$incoming" "$release"
  incoming=''
fi

python3 "$release/scripts/production/verify_github_release.py" "$sha" "$run_id"
flock -u 8
exec 8>&-
exec bash "$release/scripts/production/deploy-release.sh" "$sha" "$run_id"
