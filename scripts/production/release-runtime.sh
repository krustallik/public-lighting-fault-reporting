#!/usr/bin/env bash

plfr_validate_release_sha() {
  [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]]
}

plfr_acquire_release_lock() {
  local lock_file="${PLFR_RELEASE_LOCK_FILE:-/run/lock/plfr-production-release.lock}"
  local wait_seconds="${1:-0}"
  [[ "$wait_seconds" =~ ^(0|[1-9][0-9]{0,3})$ ]] && (( 10#$wait_seconds <= 3600 )) || {
    printf '%s\n' 'Production release lock wait must be between 0 and 3600 seconds.' >&2
    return 64
  }
  mkdir -p -- "$(dirname "$lock_file")"
  exec 9>"$lock_file"
  if (( wait_seconds == 0 )); then
    flock -n 9 || { printf '%s\n' 'Another production release or TLS operation is already running.' >&2; return 1; }
  else
    flock --wait "$wait_seconds" 9 || { printf '%s\n' 'Timed out waiting for the production release lock.' >&2; return 1; }
  fi
}

plfr_assert_inherited_release_lock() {
  local lock_file="${PLFR_RELEASE_LOCK_FILE:-/run/lock/plfr-production-release.lock}"
  local descriptor_path expected_path
  descriptor_path="$(readlink -e -- /proc/self/fd/9 2>/dev/null || true)"
  expected_path="$(readlink -m -- "$lock_file" 2>/dev/null || true)"
  [[ -n "$descriptor_path" && "$descriptor_path" == "$expected_path" ]] || {
    printf '%s\n' 'The caller did not pass the shared production release lock to the TLS hook.' >&2
    return 1
  }
  flock -n 9 || {
    printf '%s\n' 'The inherited production release lock descriptor is not held by the caller.' >&2
    return 1
  }
}

plfr_load_current_release() {
  local release_config_root="${PLFR_CONFIG_ROOT:-/etc/plfr-production}"
  local release_app_root="${PLFR_APP_ROOT:-/opt/plfr-production}"
  local release_marker="$release_config_root/current-release"
  local -a marker_lines=()

  [[ -f "$release_marker" && ! -L "$release_marker" ]] || { printf '%s\n' 'Trusted current-release marker is missing or unsafe.' >&2; return 1; }
  mapfile -t marker_lines < "$release_marker"
  [[ "${#marker_lines[@]}" -eq 1 ]] || { printf '%s\n' 'Trusted current-release marker has an invalid shape.' >&2; return 1; }
  PLFR_CURRENT_SHA="${marker_lines[0]}"
  plfr_validate_release_sha "$PLFR_CURRENT_SHA" || { printf '%s\n' 'Trusted current-release marker is malformed.' >&2; return 1; }
  PLFR_CURRENT_RELEASE="$release_app_root/releases/$PLFR_CURRENT_SHA"
  [[ -d "$PLFR_CURRENT_RELEASE" && ! -L "$PLFR_CURRENT_RELEASE" &&
     -f "$PLFR_CURRENT_RELEASE/docker-compose.production.yml" && ! -L "$PLFR_CURRENT_RELEASE/docker-compose.production.yml" ]] || {
    printf '%s\n' 'The recorded production release checkout is unavailable or unsafe.' >&2
    return 1
  }
  PLFR_PRODUCTION_ENV="$release_config_root/production.env"
  [[ -f "$PLFR_PRODUCTION_ENV" && ! -L "$PLFR_PRODUCTION_ENV" ]] || {
    printf '%s\n' 'Production environment configuration is unavailable or unsafe.' >&2
    return 1
  }
  PLFR_COMPOSE=(docker compose --project-directory "$PLFR_CURRENT_RELEASE" --env-file "$PLFR_PRODUCTION_ENV" -f "$PLFR_CURRENT_RELEASE/docker-compose.production.yml")
}

plfr_assert_exact_edge_image() {
  local image="public-lighting-edge:$PLFR_CURRENT_SHA"
  local revision
  revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image" 2>/dev/null)" || {
    printf '%s\n' 'The recorded release edge image is not available locally.' >&2
    return 1
  }
  [[ "$revision" == "$PLFR_CURRENT_SHA" ]] || {
    printf '%s\n' 'The recorded release edge image does not match its exact source SHA.' >&2
    return 1
  }
}

plfr_assert_release_images() {
  local sha="$1" component image revision
  plfr_validate_release_sha "$sha" || { printf '%s\n' 'Release image validation requires an exact commit SHA.' >&2; return 1; }
  for component in backend public admin edge; do
    image="public-lighting-$component:$sha"
    revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image" 2>/dev/null)" || {
      printf '%s\n' 'A recorded release image is not available locally.' >&2
      return 1
    }
    [[ "$revision" == "$sha" ]] || {
      printf '%s\n' 'A recorded release image does not match its exact source SHA.' >&2
      return 1
    }
  done
}

plfr_restart_current_edge() {
  plfr_load_current_release || return 1
  plfr_assert_exact_edge_image || return 1
  APP_BUILD_SHA="$PLFR_CURRENT_SHA" PUBLIC_BUILD_ID="$PLFR_CURRENT_SHA" ADMIN_BUILD_ID="$PLFR_CURRENT_SHA" \
    "${PLFR_COMPOSE[@]}" config --quiet || return 1
  APP_BUILD_SHA="$PLFR_CURRENT_SHA" PUBLIC_BUILD_ID="$PLFR_CURRENT_SHA" ADMIN_BUILD_ID="$PLFR_CURRENT_SHA" \
    "${PLFR_COMPOSE[@]}" up -d --wait --wait-timeout 120 --no-deps --no-build --pull never --force-recreate nginx || return 1
  curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
    --resolve mapa-svietidiel.sk:443:127.0.0.1 https://mapa-svietidiel.sk/api/health -o /dev/null || return 1
  curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
    --resolve mapa-svietidiel.sk:443:127.0.0.1 https://mapa-svietidiel.sk/map -o /dev/null || return 1
  curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
    --resolve panel.mapa-svietidiel.sk:443:127.0.0.1 https://panel.mapa-svietidiel.sk/panel-svietidla/login -o /dev/null || return 1
}

plfr_validate_certificate_pair_material() {
  local certificate="$1"
  local key="$2"
  [[ -s "$certificate" && -s "$key" && ! -L "$certificate" && ! -L "$key" ]] || {
    printf '%s\n' 'TLS certificate material is unavailable or unsafe.' >&2
    return 1
  }
  for host in mapa-svietidiel.sk www.mapa-svietidiel.sk panel.mapa-svietidiel.sk; do
    openssl x509 -in "$certificate" -noout -checkhost "$host" >/dev/null || {
      printf '%s\n' 'TLS certificate SAN validation failed.' >&2
      return 1
    }
  done
  local certificate_public key_public
  certificate_public="$(openssl x509 -in "$certificate" -pubkey -noout | openssl sha256)" || return 1
  key_public="$(openssl pkey -in "$key" -pubout 2>/dev/null | openssl sha256)" || return 1
  [[ "$certificate_public" == "$key_public" ]] || {
    printf '%s\n' 'TLS certificate and private key do not match.' >&2
    return 1
  }
}

plfr_validate_certificate_pair() {
  local certificate="$1"
  local key="$2"
  plfr_validate_certificate_pair_material "$certificate" "$key" || return 1
  openssl x509 -in "$certificate" -noout -checkend 604800 >/dev/null || {
    printf '%s\n' 'TLS certificate expires in less than seven days.' >&2
    return 1
  }
}

plfr_validate_existing_certificate_pair() {
  plfr_validate_certificate_pair_material "$1" "$2"
}

plfr_validate_tls_key_access() {
  local key="$1" legacy="$2" expected_owner="$3" nginx_group="$4"
  local owner group mode
  [[ -f "$key" && ! -L "$key" ]] || {
    printf '%s\n' 'TLS private key is not a regular file.' >&2
    return 1
  }
  owner="$(stat -c '%u' "$key")"
  group="$(stat -c '%g' "$key")"
  mode="$(stat -c '%a' "$key")"
  [[ "$owner" == "$expected_owner" ]] || {
    printf '%s\n' 'TLS private key has an unexpected owner.' >&2
    return 1
  }
  if [[ "$legacy" == 1 ]]; then
    if [[ "$group" == "$nginx_group" && "$mode" == 640 ]]; then
      return 0
    fi
    (( (8#$mode & 0400) != 0 && (8#$mode & 0077) == 0 )) || {
      printf '%s\n' 'Legacy TLS private key must be root-readable and either owner-only or mode 0640 for the Nginx group.' >&2
      return 1
    }
    return 0
  fi
  [[ "$group" == "$nginx_group" && "$mode" == 640 ]] || {
    printf '%s\n' 'Versioned TLS private key must be root-owned, readable by the Nginx group, and mode 0640.' >&2
    return 1
  }
}

plfr_certificate_version() {
  openssl x509 -in "$1" -noout -fingerprint -sha256 | sed 's/^[^=]*=//; s/://g' | tr '[:upper:]' '[:lower:]'
}

plfr_publish_tls_pair() (
  set -Eeuo pipefail
  local publish_tls_root="$1" certificate="$2" key="$3" pair_role="${4:-new}"
  local releases="$publish_tls_root/releases" version temporary_dir link_tmp fingerprint
  case "$pair_role" in
    new) plfr_validate_certificate_pair "$certificate" "$key" || return 1 ;;
    existing) plfr_validate_existing_certificate_pair "$certificate" "$key" || return 1 ;;
    *) printf '%s\n' 'TLS pair role is invalid.' >&2; return 1 ;;
  esac
  fingerprint="$(plfr_certificate_version "$certificate")"
  [[ "$fingerprint" =~ ^[0-9a-f]{64}$ ]] || { printf '%s\n' 'TLS certificate fingerprint is invalid.' >&2; return 1; }
  local owner group tls_group key_mode
  owner="$(id -u)"
  group="$(id -g)"
  tls_group="$group"
  key_mode=0640
  if [[ "$owner" == 0 ]]; then
    group=0
    tls_group=101
  fi
  install -d -o "$owner" -g "$tls_group" -m 0750 "$publish_tls_root" "$releases" || return 1
  version="$releases/$fingerprint"
  if [[ ! -e "$version" ]]; then
    temporary_dir="$(mktemp -d "$releases/.incoming-$fingerprint.XXXXXX")" || return 1
    trap 'if [[ -n "${temporary_dir:-}" && -d "$temporary_dir" ]]; then rm -rf -- "$temporary_dir"; fi' EXIT
    chown "$owner:$tls_group" "$temporary_dir"
    chmod 0750 "$temporary_dir"
    install -o "$owner" -g "$group" -m 0644 "$certificate" "$temporary_dir/tls.crt"
    install -o "$owner" -g "$tls_group" -m "$key_mode" "$key" "$temporary_dir/tls.key"
    case "$pair_role" in
      new) plfr_validate_certificate_pair "$temporary_dir/tls.crt" "$temporary_dir/tls.key" || return 1 ;;
      existing) plfr_validate_existing_certificate_pair "$temporary_dir/tls.crt" "$temporary_dir/tls.key" || return 1 ;;
    esac
    mv -T -- "$temporary_dir" "$version" || return 1
    temporary_dir=''
  fi
  case "$pair_role" in
    new) plfr_validate_certificate_pair "$version/tls.crt" "$version/tls.key" || return 1 ;;
    existing) plfr_validate_existing_certificate_pair "$version/tls.crt" "$version/tls.key" || return 1 ;;
  esac
  link_tmp="$publish_tls_root/.current-$fingerprint.$$"
  ln -s "releases/$fingerprint" "$link_tmp"
  mv -Tf -- "$link_tmp" "$publish_tls_root/current"
  printf '%s\n' "$fingerprint"
)

plfr_initialize_tls_layout() {
  local initialize_tls_root="$1"
  local existing_pair_mode="${2:-new}"
  if [[ -L "$initialize_tls_root/current" ]]; then
    local target
    target="$(readlink -e "$initialize_tls_root/current")" || return 1
    [[ "$target" == "$initialize_tls_root"/releases/* ]] || { printf '%s\n' 'TLS current pointer escapes its release directory.' >&2; return 1; }
    case "$existing_pair_mode" in
      new) plfr_validate_certificate_pair "$target/tls.crt" "$target/tls.key" ;;
      existing) plfr_validate_existing_certificate_pair "$target/tls.crt" "$target/tls.key" ;;
      *) printf '%s\n' 'TLS existing-pair mode is invalid.' >&2; return 1 ;;
    esac
    return $?
  fi
  [[ ! -e "$initialize_tls_root/current" ]] || { printf '%s\n' 'TLS current pointer exists but is not a trusted symlink.' >&2; return 1; }
  [[ -s "$initialize_tls_root/tls.crt" && -s "$initialize_tls_root/tls.key" ]] || {
    printf '%s\n' 'A verified legacy TLS pair is required to initialize versioned TLS storage.' >&2
    return 1
  }
  plfr_publish_tls_pair "$initialize_tls_root" "$initialize_tls_root/tls.crt" "$initialize_tls_root/tls.key" "$existing_pair_mode" >/dev/null
}

plfr_install_tls_pair_and_restart() {
  local install_tls_root="$1" install_certificate="$2" install_key="$3"
  local old_target='' new_fingerprint incoming_fingerprint link_tmp tls_config_root="${PLFR_CONFIG_ROOT:-/etc/plfr-production}"
  [[ -d "$install_tls_root" && ! -L "$install_tls_root" ]] || { printf '%s\n' 'TLS root directory is missing or unsafe.' >&2; return 1; }
  if [[ -L "$install_tls_root/current" ]]; then
    old_target="$(readlink "$install_tls_root/current")"
    plfr_initialize_tls_layout "$install_tls_root" existing || return 1
  elif [[ -e "$install_tls_root/current" ]]; then
    printf '%s\n' 'TLS current pointer exists but is not a symlink.' >&2
    return 1
  elif [[ -s "$install_tls_root/tls.crt" && -s "$install_tls_root/tls.key" ]]; then
    plfr_validate_existing_certificate_pair "$install_tls_root/tls.crt" "$install_tls_root/tls.key" || return 1
    old_target="releases/$(plfr_certificate_version "$install_tls_root/tls.crt")"
    plfr_initialize_tls_layout "$install_tls_root" existing || return 1
  fi

  if [[ -e "$tls_config_root/current-release" || -L "$tls_config_root/current-release" ]]; then
    [[ -n "$old_target" ]] || { printf '%s\n' 'An active release has no rollback TLS pair; refusing certificate replacement.' >&2; return 1; }
    plfr_load_current_release || return 1
    plfr_assert_exact_edge_image || return 1
  fi

  incoming_fingerprint="$(plfr_certificate_version "$install_certificate")"
  if [[ -L "$install_tls_root/current" && "$(readlink "$install_tls_root/current")" == "releases/$incoming_fingerprint" ]]; then
    plfr_validate_certificate_pair "$install_tls_root/current/tls.crt" "$install_tls_root/current/tls.key" || return 1
    printf 'Verified TLS pair %s is already installed; no edge restart was needed.\n' "$incoming_fingerprint"
    return 0
  fi

  new_fingerprint="$(plfr_publish_tls_pair "$install_tls_root" "$install_certificate" "$install_key")" || return 1
  if [[ ! -e "$tls_config_root/current-release" && ! -L "$tls_config_root/current-release" ]]; then
    printf 'Verified TLS pair %s staged before the first application release.\n' "$new_fingerprint"
    return 0
  fi
  if plfr_restart_current_edge; then
    printf 'Verified TLS pair %s installed and the exact current edge is healthy.\n' "$new_fingerprint"
    return 0
  fi

  printf '%s\n' 'TLS edge health check failed; restoring the previous certificate pointer.' >&2
  link_tmp="$install_tls_root/.current-rollback.$$"
  ln -s "$old_target" "$link_tmp" || return 1
  mv -Tf -- "$link_tmp" "$install_tls_root/current" || return 1
  if plfr_restart_current_edge; then
    printf '%s\n' 'Previous TLS pair and the exact recorded edge were restored.' >&2
  else
    printf '%s\n' 'TLS rollback restart failed; HTTPS requires operator recovery.' >&2
  fi
  return 1
}
