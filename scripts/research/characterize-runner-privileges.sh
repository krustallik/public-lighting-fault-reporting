#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_PRIVILEGE_EVIDENCE:?Set RUNNER_PRIVILEGE_EVIDENCE to an evidence file path}"

runner_user="$(id -un)"
runner_uid="$(id -u)"
runner_groups="$(id -nG)"
runner_caps="$(grep -E '^(Cap(Inh|Prm|Eff|Bnd|Amb)|NoNewPrivs):' /proc/self/status | tr '\n' ';')"
runner_userns="$(readlink /proc/self/ns/user)"
if proc1_netns="$(readlink /proc/1/ns/net 2>/dev/null)" && [[ -n "$proc1_netns" ]]; then
  proc1_netns_accessible=true
else
  proc1_netns='UNREADABLE'
  proc1_netns_accessible=false
fi

sudo_listing="$(sudo -n -l 2>&1)"
grep -q 'NOPASSWD: ALL' <<< "$sudo_listing"
sudo_root_uid="$(sudo -n id -u)"
test "$sudo_root_uid" = 0
host_netns="$(sudo -n readlink /proc/1/ns/net)"
host_userns="$(sudo -n readlink /proc/1/ns/user)"
entered_netns="$(sudo -n nsenter --target 1 --net -- readlink /proc/self/ns/net)"
test -n "$host_netns"
test -n "$host_userns"
test "$entered_netns" = "$host_netns"

mkdir -p "$(dirname "$RUNNER_PRIVILEGE_EVIDENCE")"
{
  echo "runner_os=${RUNNER_OS:-Linux}"
  echo "runner_user=$runner_user"
  echo "runner_uid=$runner_uid"
  echo "runner_groups=$runner_groups"
  echo "runner_userns=$runner_userns"
  echo "runner_capability_lines=$runner_caps"
  echo "proc1_netns_accessible_as_runner=$proc1_netns_accessible"
  echo "proc1_netns_as_runner=$proc1_netns"
  echo '--- sudo -n -l ---'
  echo "$sudo_listing"
  echo "runner_passwordless_sudo=true"
  echo "host_proc1_netns_as_root=$host_netns"
  echo "host_proc1_userns_as_root=$host_userns"
  echo "sudo_nsenter_target1_netns=$entered_netns"
  echo "runner_can_enter_host_netns_read_only=true"
} | tee "$RUNNER_PRIVILEGE_EVIDENCE"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo '### GitHub-hosted runner privilege evidence'
    echo "- Runner identity: $runner_user (uid $runner_uid), groups: $runner_groups."
    echo '- sudo -n -l grants NOPASSWD: ALL; sudo -n id -u returns 0.'
    echo "- Host PID 1 network namespace is $host_netns; passwordless sudo nsenter --target 1 --net read-only inspection enters the same namespace."
    echo "- Runner user namespace is $runner_userns; host PID 1 user namespace is $host_userns."
    echo "- Unprivileged /proc/1/ns/net readable: $proc1_netns_accessible; runner capability/NoNewPrivs fields: $runner_caps."
  } >> "$GITHUB_STEP_SUMMARY"
fi

if [[ -n "${GITHUB_ENV:-}" ]]; then
  printf 'RUNNER_HOST_PID=%s\n' "$$" >> "$GITHUB_ENV"
  printf 'HOST_NETNS_ID=%s\n' "$host_netns" >> "$GITHUB_ENV"
  printf 'HOST_USERNS_ID=%s\n' "$host_userns" >> "$GITHUB_ENV"
fi
