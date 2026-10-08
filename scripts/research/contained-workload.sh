#!/usr/bin/env bash
set -euo pipefail

mode="${1:?Usage: contained-workload.sh probe|browser [--inside|--workload]}"
stage="${2:-root}"
script_path="$(readlink -f "$0")"

die() {
  echo "PROCESS EGRESS CONTAINMENT FAILED: $*" >&2
  exit 1
}

if [[ "$stage" == root ]]; then
  [[ "$EUID" -eq 0 ]] || die 'the isolation setup must run as root, before dropping into the workload identity.'
  echo "containment root setup started: euid=$EUID script=$script_path"
  [[ "$mode" == probe || "$mode" == browser ]] || die "unknown workload mode: $mode"
  : "${SUDO_USER:?Invoke this helper with sudo from the GitHub runner account}"
  : "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
  : "${RUNNER_TEMP:?RUNNER_TEMP is required}"
  : "${PROCESS_EGRESS_EVIDENCE_DIR:?PROCESS_EGRESS_EVIDENCE_DIR is required}"
  : "${PROBE_IPV4:?Resolve the synthetic example.com address before isolation}"
  : "${HOST_NETNS_ID:?Runner characterization must record the host network namespace}"
  : "${HOST_USERNS_ID:?Runner characterization must record the host user namespace}"
  if [[ "$mode" == browser ]]; then
    : "${P5_E2E_SOCKET_HOST:?browser workload requires the disposable PostGIS socket source}"
    [[ "${P5_E2E_SOCKET_REL:-}" == '.p5-e2e-postgres-socket' ]] || die 'browser workload must use the dedicated disposable PostGIS socket mount.'
    [[ "${P5_E2E_SOCKET_HOST}" == "/tmp/p5-e2e-postgres-socket-${GITHUB_RUN_ID:-}" && "${DB_HOST:-}" == "$P5_E2E_SOCKET_HOST" ]] || die 'browser database host must resolve only to the run-scoped disposable Unix socket directory.'
    [[ "${DB_NAME:-}" =~ ^p5_e2e_[a-z0-9_]+$ && "${DB_USER:-}" == p5_e2e_user && -n "${DB_PASSWORD:-}" ]] || die 'browser workload database identity is not the synthetic disposable test identity.'
    [[ "${P5_E2E_ALLOW_DB_RESET:-}" == true && -n "${JWT_SECRET:-}" ]] || die 'browser workload lacks explicit disposable-database test settings.'
    [[ -S "$DB_HOST/.s.PGSQL.${DB_PORT:-5432}" ]] || die 'the disposable PostGIS Unix socket is unavailable before containment.'
  fi

  for tool in ip unshare setpriv useradd getent sudo nsenter python3 ps mount mktemp; do
    command -v "$tool" >/dev/null || die "required host utility is unavailable: $tool"
  done
  [[ -r /proc/1/ns/net ]] || die 'root cannot open the host PID 1 network namespace handle.'
  [[ "$(sudo -n readlink /proc/1/ns/net)" == "$HOST_NETNS_ID" ]] || die 'the host network namespace changed after characterization.'
  [[ "$(sudo -n readlink /proc/1/ns/user)" == "$HOST_USERNS_ID" ]] || die 'the host user namespace changed after characterization.'

  sandbox_user='egress-workload'
  if getent passwd "$sandbox_user" >/dev/null; then
    die "unexpected pre-existing workload account: $sandbox_user"
  fi
  sandbox_root="$RUNNER_TEMP/process-egress-containment"
  sandbox_home="$sandbox_root/home"
  sandbox_tmp="$sandbox_root/tmp"
  sandbox_cache="$sandbox_root/cache"
  sandbox_workspace="$sandbox_root/workspace"
  sandbox_evidence="$sandbox_root/evidence"
  sandbox_browser_cache="$sandbox_root/browser-cache"
  sandbox_script="$sandbox_root/contained-workload.sh"
  install -d -m 0700 "$sandbox_root" "$sandbox_home" "$sandbox_tmp" "$sandbox_cache"
  install -d -m 0755 "$sandbox_workspace" "$sandbox_evidence" "$sandbox_browser_cache"
  install -m 0555 "$script_path" "$sandbox_script"
  useradd --system --user-group --no-create-home --home-dir "$sandbox_home" --shell /usr/sbin/nologin "$sandbox_user"
  sandbox_uid="$(id -u "$sandbox_user")"
  sandbox_gid="$(id -g "$sandbox_user")"
  chown -R "$sandbox_uid:$sandbox_gid" "$sandbox_root"

  install -d -m 0755 "$PROCESS_EGRESS_EVIDENCE_DIR"
  chown -R "$sandbox_uid:$sandbox_gid" "$PROCESS_EGRESS_EVIDENCE_DIR"
  chown -R "$sandbox_uid:$sandbox_gid" "$GITHUB_WORKSPACE/frontend" "$GITHUB_WORKSPACE/backend"
  if [[ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ]]; then
    [[ -d "$PLAYWRIGHT_BROWSERS_PATH" ]] || die 'the configured Playwright browser cache is missing.'
    chown -R "$sandbox_uid:$sandbox_gid" "$PLAYWRIGHT_BROWSERS_PATH"
  fi

  sudo_listing="$(sudo -n -l -U "$sandbox_user" 2>&1 || true)"
  if ! grep -Eqi 'not allowed to run sudo|not in the sudoers file' <<< "$sudo_listing"; then
    die "the dedicated workload account has sudo authorization or its absence could not be proved: $sudo_listing"
  fi
  {
    echo "dedicated_workload_user=$sandbox_user"
    echo "dedicated_workload_uid=$sandbox_uid"
    echo "dedicated_workload_gid=$sandbox_gid"
    echo "dedicated_workload_groups=$(id -nG "$sandbox_user")"
    echo "sudo_policy_query=$sudo_listing"
    if [[ -S /var/run/docker.sock ]]; then
      echo 'host_docker_socket=present'
    else
      echo 'host_docker_socket=absent'
    fi
  } >> "$PROCESS_EGRESS_EVIDENCE_DIR/containment.txt"
  chown "$sandbox_uid:$sandbox_gid" "$PROCESS_EGRESS_EVIDENCE_DIR/containment.txt"

  exec 9</proc/1/ns/net
  opened_host_netns="$(readlink /proc/self/fd/9)"
  [[ "$opened_host_netns" == "$HOST_NETNS_ID" ]] || die 'the retained namespace descriptor does not identify the characterized host network namespace.'
  export HOST_NETNS_FD=9 HOST_NETNS_ID="$opened_host_netns"
  export SANDBOX_USER="$sandbox_user" SANDBOX_UID="$sandbox_uid" SANDBOX_GID="$sandbox_gid"
  export SANDBOX_ROOT="$sandbox_root" SANDBOX_HOME="$sandbox_home" SANDBOX_TMP="$sandbox_tmp" SANDBOX_CACHE="$sandbox_cache"
  export SANDBOX_WORKSPACE="$sandbox_workspace" SANDBOX_EVIDENCE="$sandbox_evidence"
  export SANDBOX_BROWSER_CACHE="$sandbox_browser_cache" SANDBOX_SCRIPT="$sandbox_script"
  sandbox_view_root="$(mktemp -d /tmp/process-egress-workload.XXXXXX)" || die 'could not create the temporary mount target under /tmp.'
  export SANDBOX_VIEW_ROOT="$sandbox_view_root"

  echo 'starting unshare with network namespace, PID namespace, and a fresh proc mount.'
  if unshare --net --pid --fork --mount-proc /bin/bash "$script_path" "$mode" --inside; then
    unshare_status=0
  else
    unshare_status=$?
  fi
  rmdir -- "$SANDBOX_VIEW_ROOT"
  exit "$unshare_status"
fi

if [[ "$stage" == --inside ]]; then
  [[ "$EUID" -eq 0 ]] || die 'namespace bootstrap did not retain its setup identity.'
  echo "isolated namespace bootstrap started: euid=$EUID pid=$$"
  [[ "$(readlink /proc/self/ns/user)" == "$HOST_USERNS_ID" ]] || die 'namespace setup changed the host-owned user namespace.'
  [[ "$(readlink /proc/self/fd/${HOST_NETNS_FD:?})" == "$HOST_NETNS_ID" ]] || die 'host namespace descriptor did not survive namespace setup.'

  mount --make-rprivate /
  sandbox_source_root="$SANDBOX_ROOT"
  mount --bind "$sandbox_source_root" "$SANDBOX_VIEW_ROOT"
  SANDBOX_ROOT="$SANDBOX_VIEW_ROOT"
  SANDBOX_HOME="$SANDBOX_ROOT/home"
  SANDBOX_TMP="$SANDBOX_ROOT/tmp"
  SANDBOX_CACHE="$SANDBOX_ROOT/cache"
  SANDBOX_WORKSPACE="$SANDBOX_ROOT/workspace"
  SANDBOX_EVIDENCE="$SANDBOX_ROOT/evidence"
  SANDBOX_BROWSER_CACHE="$SANDBOX_ROOT/browser-cache"
  SANDBOX_SCRIPT="$SANDBOX_ROOT/contained-workload.sh"
  mount --bind "$GITHUB_WORKSPACE" "$SANDBOX_WORKSPACE"
  if [[ "$mode" == browser ]]; then
    socket_mountpoint="$SANDBOX_WORKSPACE/${P5_E2E_SOCKET_REL:?}"
    [[ -d "$socket_mountpoint" && ! -L "$socket_mountpoint" ]] || die 'the contained database socket mountpoint is missing or is not a directory.'
    mount --bind "$P5_E2E_SOCKET_HOST" "$socket_mountpoint"
    echo "disposable_postgis_socket=mounted at $P5_E2E_SOCKET_REL from run-scoped host directory" >> "$PROCESS_EGRESS_EVIDENCE_DIR/containment.txt"
  fi
  mount --bind "$PROCESS_EGRESS_EVIDENCE_DIR" "$SANDBOX_EVIDENCE"
  if [[ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ]]; then
    mount --bind "$PLAYWRIGHT_BROWSERS_PATH" "$SANDBOX_BROWSER_CACHE"
  fi
  GITHUB_WORKSPACE="$SANDBOX_WORKSPACE"
  PROCESS_EGRESS_EVIDENCE_DIR="$SANDBOX_EVIDENCE"
  RUNNER_TEMP="$SANDBOX_TMP"
  PLAYWRIGHT_BROWSERS_PATH="$SANDBOX_BROWSER_CACHE"
  cd "$SANDBOX_WORKSPACE"

  ip link set lo up
  mapfile -t interface_names < <(ip -o link show | awk -F ': ' '{ print $2 }' | sed 's/@.*//')
  [[ "${#interface_names[@]}" -eq 1 && "${interface_names[0]}" == lo ]] || die "unexpected isolated interfaces: ${interface_names[*]}"
  [[ -z "$(ip route show)" ]] || die 'isolated IPv4 routes are not empty.'
  [[ -z "$(ip -6 route show)" ]] || die 'isolated IPv6 routes are not empty.'
  isolated_netns="$(readlink /proc/1/ns/net)"
  [[ "$isolated_netns" != "$HOST_NETNS_ID" ]] || die 'the PID namespace init still uses the host network namespace.'

  exec setpriv \
    --reuid="$SANDBOX_UID" \
    --regid="$SANDBOX_GID" \
    --clear-groups \
    --bounding-set=-all \
    --inh-caps=-all \
    --ambient-caps=-all \
    --no-new-privs \
    /usr/bin/env -i \
      "HOME=$SANDBOX_HOME" \
      "TMPDIR=$SANDBOX_TMP" \
      "XDG_CACHE_HOME=$SANDBOX_CACHE" \
      "npm_config_cache=$SANDBOX_CACHE/npm" \
      "PATH=$PATH" \
      "GITHUB_WORKSPACE=$SANDBOX_WORKSPACE" \
      "RUNNER_TEMP=$SANDBOX_TMP" \
      "RUNNER_OS=${RUNNER_OS:-Linux}" \
      "RUNNER_HOST_PID=${RUNNER_HOST_PID:?}" \
      "PROCESS_EGRESS_EVIDENCE_DIR=$SANDBOX_EVIDENCE" \
      "EGRESS_EVIDENCE_FILE=$SANDBOX_EVIDENCE/process-egress-evidence.json" \
      "PROCESS_IDENTITY_FILE=$SANDBOX_EVIDENCE/workload-process-identities.txt" \
      "SANDBOX_USER=$SANDBOX_USER" \
      "SANDBOX_UID=$SANDBOX_UID" \
      "SANDBOX_GID=$SANDBOX_GID" \
      "SANDBOX_TMP=$SANDBOX_TMP" \
      "HOST_NETNS_FD=$HOST_NETNS_FD" \
      "HOST_NETNS_ID=$HOST_NETNS_ID" \
      "HOST_USERNS_ID=$HOST_USERNS_ID" \
      "ISOLATED_NETNS_ID=$isolated_netns" \
      "PROBE_IPV4=$PROBE_IPV4" \
      "CHROME_BIN=${CHROME_BIN:-google-chrome}" \
      "PLAYWRIGHT_BROWSERS_PATH=$SANDBOX_BROWSER_CACHE" \
      "P5_E2E_SOCKET_REL=${P5_E2E_SOCKET_REL:-}" \
      "P5_E2E_SOCKET_HOST=${P5_E2E_SOCKET_HOST:-}" \
      "DB_HOST=$SANDBOX_WORKSPACE/${P5_E2E_SOCKET_REL:-}" \
      "DB_PORT=${DB_PORT:-5432}" \
      "DB_NAME=${DB_NAME:-}" \
      "DB_USER=${DB_USER:-}" \
      "DB_PASSWORD=${DB_PASSWORD:-}" \
      "P5_E2E_ALLOW_DB_RESET=${P5_E2E_ALLOW_DB_RESET:-}" \
      "JWT_SECRET=${JWT_SECRET:-}" \
      "CI=${CI:-true}" \
      "PROCESS_EGRESS_ISOLATED=1" \
      /bin/bash "$SANDBOX_SCRIPT" "$mode" --workload
fi

if [[ "$stage" == --workload ]]; then
  [[ "$(id -u)" == "${SANDBOX_UID:?}" ]] || die 'workload did not run as the dedicated unprivileged user.'
  [[ "$(readlink /proc/self/ns/net)" == "${ISOLATED_NETNS_ID:?}" ]] || die 'workload did not retain the proven isolated network namespace.'
  workload_userns_id="$(readlink /proc/self/ns/user)"
  [[ "$workload_userns_id" == "$HOST_USERNS_ID" ]] || die 'workload is not in the characterized host-owned user namespace.'
  groups="$(id -nG)"
  if grep -Eqi '(^|[[:space:]])(sudo|docker)([[:space:]]|$)' <<< "$groups"; then
    die "workload retained a sudo or docker group: $groups"
  fi
  [[ "$(readlink /proc/self/fd/${HOST_NETNS_FD:?})" == "$HOST_NETNS_ID" ]] || die 'workload does not hold the expected host namespace descriptor for a negative setns check.'
  [[ "$(readlink /proc/1/ns/net)" != "$HOST_NETNS_ID" ]] || die 'workload is in the host network namespace.'

  status_file="/proc/self/status"
  cap_eff="$(awk '/^CapEff:/ { print $2 }' "$status_file")"
  cap_prm="$(awk '/^CapPrm:/ { print $2 }' "$status_file")"
  cap_inh="$(awk '/^CapInh:/ { print $2 }' "$status_file")"
  cap_bnd="$(awk '/^CapBnd:/ { print $2 }' "$status_file")"
  cap_amb="$(awk '/^CapAmb:/ { print $2 }' "$status_file")"
  no_new_privs="$(awk '/^NoNewPrivs:/ { print $2 }' "$status_file")"
  for value in "$cap_eff" "$cap_prm" "$cap_inh" "$cap_bnd" "$cap_amb"; do
    [[ "$value" =~ ^0+$ ]] || die "workload has a nonzero capability mask: $value"
  done
  [[ "$no_new_privs" == 1 ]] || die 'no_new_privs is not set for the workload.'

  if sudo -n true >/dev/null 2>"$SANDBOX_TMP/sudo-denied.txt"; then
    die 'passwordless sudo unexpectedly succeeded in the workload.'
  fi
  if [[ -r /var/run/docker.sock ]]; then
    die 'the workload can read the host Docker socket.'
  fi
  if [[ -S /var/run/docker.sock ]]; then
    docker_socket_result='present-but-unreadable'
  else
    docker_socket_result='absent'
  fi

  nsenter_output=''
  if nsenter --net="/proc/self/fd/$HOST_NETNS_FD" -- /bin/true >"$SANDBOX_TMP/nsenter.out" 2>"$SANDBOX_TMP/nsenter.err"; then
    die 'nsenter unexpectedly entered the held host network namespace descriptor.'
  fi
  nsenter_output="$(cat "$SANDBOX_TMP/nsenter.err")"
  grep -qi 'Operation not permitted' <<< "$nsenter_output" || die "nsenter failed for an unexpected reason: $nsenter_output"

  python3 - "$HOST_NETNS_FD" <<'PY'
import ctypes
import errno
import sys

fd = int(sys.argv[1])
libc = ctypes.CDLL(None, use_errno=True)
setns = getattr(libc, "setns", None)
if setns is None:
    raise SystemExit("setns syscall wrapper is unavailable; cannot prove the privilege boundary")
result = setns(fd, 0x40000000)  # CLONE_NEWNET
if result == 0:
    raise SystemExit("setns unexpectedly entered the host network namespace")
error = ctypes.get_errno()
print(f"direct_setns_result=blocked errno={error} ({errno.errorcode.get(error, 'UNKNOWN')})")
if error != errno.EPERM:
    raise SystemExit(f"setns failed for an unexpected reason: errno={error}")
PY

  if [[ -e "/proc/$RUNNER_HOST_PID/ns/net" ]]; then
    visible_runner_netns="$(readlink "/proc/$RUNNER_HOST_PID/ns/net")"
    [[ "$visible_runner_netns" != "$HOST_NETNS_ID" ]] || die 'the host runner network namespace is visible through the isolated proc mount.'
    proc_runner_pid='pid-number-visible-but-not-host'
  else
    visible_runner_netns='UNAVAILABLE'
    proc_runner_pid='hidden'
  fi

  {
    echo "workload_user=$(id -un)"
    echo "workload_uid=$(id -u)"
    echo "workload_gid=$(id -g)"
    echo "workload_groups=$groups"
    echo "workload_userns_id=$workload_userns_id"
    echo "workload_cap_inh=$cap_inh"
    echo "workload_cap_prm=$cap_prm"
    echo "workload_cap_eff=$cap_eff"
    echo "workload_cap_bnd=$cap_bnd"
    echo "workload_cap_amb=$cap_amb"
    echo "workload_no_new_privs=$no_new_privs"
    echo "host_netns_id=$HOST_NETNS_ID"
    echo "isolated_netns_id=$(readlink /proc/1/ns/net)"
    echo "proc_runner_host_pid=$proc_runner_pid"
    echo "proc_runner_host_netns=$visible_runner_netns"
    echo 'passwordless_sudo=BLOCKED'
    echo "docker_socket_access=$docker_socket_result"
    echo "nsenter_host_netns=BLOCKED ($nsenter_output)"
    echo 'direct_setns_host_netns=BLOCKED (EPERM)'
    echo 'isolated_interfaces=lo only'
    echo 'ipv4_routes=empty'
    echo 'ipv6_routes=empty'
  } | tee -a "$PROCESS_EGRESS_EVIDENCE_DIR/containment.txt"

  exec 9<&-
  unset HOST_NETNS_FD RUNNER_HOST_PID
  : > "$PROCESS_IDENTITY_FILE"
  declare -A observed_processes=()
  declare -A observed_roles=()

  process_role() {
    local command_name="$1"
    local arguments="$2"
    if [[ "$arguments" == *"process-egress-probe.mjs --server=backend"* ]]; then
      echo probe-backend
    elif [[ "$arguments" == *"process-egress-probe.mjs --server=frontend"* ]]; then
      echo probe-frontend
    elif [[ "$arguments" == *"process-egress-probe.mjs"* ]]; then
      echo probe-node
    elif [[ "$arguments" == *"tests/e2e-support/server.ts"* ]]; then
      echo e2e-backend
    elif [[ "$arguments" == *"vite"* && "$arguments" == *"--host 127.0.0.1"* ]]; then
      echo e2e-frontend
    elif [[ "$arguments" == *"playwright"* && "$arguments" == *"test"* ]]; then
      echo e2e-test
    elif [[ "$command_name" == *chrome* || "$arguments" == *chrome* || "$arguments" == *chromium* ]]; then
      echo browser
    fi
  }

  sample_process_identity() {
    local pid euid egid command_name arguments role status effective_uid effective_gid child_cap_eff child_cap_prm child_cap_inh child_cap_amb child_cap_bnd child_nnp child_netns child_userns child_userns_scope child_interfaces child_ipv4_route_interfaces child_ipv6_route_interfaces key
    while read -r pid euid egid command_name arguments; do
      [[ "$pid" =~ ^[0-9]+$ ]] || continue
      [[ -r "/proc/$pid/status" ]] || continue
      status="$(cat "/proc/$pid/status" 2>/dev/null)" || continue
      effective_uid="$(awk '/^Uid:/ { print $3 }' <<< "$status")"
      effective_gid="$(awk '/^Gid:/ { print $3 }' <<< "$status")"
      child_cap_eff="$(awk '/^CapEff:/ { print $2 }' <<< "$status")"
      child_cap_prm="$(awk '/^CapPrm:/ { print $2 }' <<< "$status")"
      child_cap_inh="$(awk '/^CapInh:/ { print $2 }' <<< "$status")"
      child_cap_amb="$(awk '/^CapAmb:/ { print $2 }' <<< "$status")"
      child_cap_bnd="$(awk '/^CapBnd:/ { print $2 }' <<< "$status")"
      child_nnp="$(awk '/^NoNewPrivs:/ { print $2 }' <<< "$status")"
      child_netns="$(readlink "/proc/$pid/ns/net" 2>/dev/null)" || continue
      child_userns="$(readlink "/proc/$pid/ns/user" 2>/dev/null)" || continue
      child_interfaces="$(awk -F: 'NR > 2 { gsub(/[[:space:]]/, "", $1); if ($1 != "") print $1 }' "/proc/$pid/net/dev" 2>/dev/null)" || continue
      child_ipv4_route_interfaces="$(awk 'NR > 1 && NF { print $1 }' "/proc/$pid/net/route" 2>/dev/null | sort -u)" || continue
      child_ipv6_route_interfaces="$(awk 'NF { print $10 }' "/proc/$pid/net/ipv6_route" 2>/dev/null | sort -u)" || continue
      [[ "$effective_uid" == "$SANDBOX_UID" ]] || die "PID $pid ($command_name) escaped the dedicated workload UID: euid=$effective_uid"
      [[ "$child_netns" != "$HOST_NETNS_ID" ]] || die "PID $pid ($command_name) entered the host network namespace."
      [[ "$child_cap_inh" =~ ^0+$ && "$child_cap_amb" =~ ^0+$ && "$child_nnp" == 1 ]] || die "PID $pid ($command_name) has unexpected inheritable/ambient capability or NoNewPrivs state: CapInh=$child_cap_inh CapAmb=$child_cap_amb NoNewPrivs=$child_nnp userns=$child_userns netns=$child_netns"
      if [[ "$child_userns" == "$HOST_USERNS_ID" ]]; then
        child_userns_scope=workload
        [[ "$child_cap_eff" =~ ^0+$ && "$child_cap_prm" =~ ^0+$ && "$child_cap_bnd" =~ ^0+$ ]] || die "PID $pid ($command_name) gained capabilities in the workload user namespace: CapEff=$child_cap_eff CapPrm=$child_cap_prm CapBnd=$child_cap_bnd"
      else
        # Chromium may create a descendant user namespace; its CAP_SYS_ADMIN does not authorize operations in the host-owned network namespace.
        child_userns_scope=nested
        [[ ( "$child_cap_eff" =~ ^0+$ || "$child_cap_eff" == 0000000000200000 ) && ( "$child_cap_prm" =~ ^0+$ || "$child_cap_prm" == 0000000000200000 ) ]] || die "PID $pid ($command_name) has unexpected capability scope in nested user namespace: CapEff=$child_cap_eff CapPrm=$child_cap_prm CapBnd=$child_cap_bnd userns=$child_userns"
      fi
      [[ "$child_interfaces" == lo && ( -z "$child_ipv4_route_interfaces" || "$child_ipv4_route_interfaces" == lo ) && ( -z "$child_ipv6_route_interfaces" || "$child_ipv6_route_interfaces" == lo ) ]] || die "PID $pid ($command_name) has a network namespace with external-capable interface/routes: netns=$child_netns interfaces=$child_interfaces ipv4_route_interfaces=$child_ipv4_route_interfaces ipv6_route_interfaces=$child_ipv6_route_interfaces"
      role="$(process_role "$command_name" "$arguments")"
      [[ -n "$role" ]] || continue
      key="$role:$pid"
      [[ -n "${observed_processes[$key]:-}" ]] && continue
      observed_processes[$key]=1
      observed_roles[$role]=1
      echo "role=$role pid=$pid uid=$effective_uid gid=$effective_gid CapEff=$child_cap_eff CapPrm=$child_cap_prm CapInh=$child_cap_inh CapAmb=$child_cap_amb CapBnd=$child_cap_bnd NoNewPrivs=$child_nnp userns=$child_userns userns_scope=$child_userns_scope netns=$child_netns interfaces=$child_interfaces ipv4_route_interfaces=${child_ipv4_route_interfaces:-none} ipv6_route_interfaces=${child_ipv6_route_interfaces:-none}" | tee -a "$PROCESS_IDENTITY_FILE"
    done < <(ps -ww -eo pid=,euid=,egid=,comm=,args=)
  }

  run_monitored() {
    local label="$1"
    shift
    local log_file="$SANDBOX_TMP/$label.log"
    local command_pid command_status
    echo "Starting monitored workload: $label"
    "$@" >"$log_file" 2>&1 &
    command_pid=$!
    while kill -0 "$command_pid" 2>/dev/null; do
      sample_process_identity
      sleep 0.05
    done
    if wait "$command_pid"; then
      command_status=0
    else
      command_status=$?
    fi
    sample_process_identity
    cat "$log_file"
    [[ "$command_status" -eq 0 ]] || die "$label exited with status $command_status"
  }

  run_monitored process-egress-probe node "$GITHUB_WORKSPACE/scripts/research/process-egress-probe.mjs"
  for role in probe-node probe-backend probe-frontend browser; do
    [[ -n "${observed_roles[$role]:-}" ]] || die "the process identity sampler did not observe required role $role"
  done

  if [[ "$mode" == browser ]]; then
    run_monitored playwright-e2e npm --prefix frontend run test:e2e
    for role in e2e-backend e2e-frontend e2e-test; do
      [[ -n "${observed_roles[$role]:-}" ]] || die "the process identity sampler did not observe required role $role"
    done
    [[ -n "${observed_roles[browser]:-}" ]] || die 'the E2E Chromium process was not observed under the contained identity.'
  fi
  exit 0
fi

die "unknown helper stage: $stage"
