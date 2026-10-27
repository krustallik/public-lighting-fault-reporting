#!/usr/bin/env bash

plfr_require_unclaimed_path() {
  local path="${1:-}"
  [[ -n "$path" && ! -e "$path" && ! -L "$path" ]] || {
    printf 'Installation target already exists or is unsafe: %s\n' "$path" >&2
    return 1
  }
}
