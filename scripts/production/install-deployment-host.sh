#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(id -u)" -ne 0 || $# -ne 1 ]]; then
  printf '%s\n' 'Usage: install-deployment-host.sh <ssh-ed25519-public-key>' >&2
  exit 64
fi
public_key="$1"
[[ "$public_key" =~ ^ssh-ed25519\ [A-Za-z0-9+/]+={0,2}\ [A-Za-z0-9._@+-]+$ ]] || {
  printf '%s\n' 'Deployment public key is not a single Ed25519 key line.' >&2
  exit 64
}

for required in docker sudo useradd userdel install visudo certbot git python3 systemctl ss getent grep passwd flock; do
  command -v "$required" >/dev/null 2>&1 || {
    printf 'Required host command is missing: %s\n' "$required" >&2
    exit 1
  }
done
docker compose version >/dev/null 2>&1 || { printf '%s\n' 'Docker Compose plugin is unavailable.' >&2; exit 1; }
[[ -f /etc/os-release ]] && grep -q '^ID=ubuntu$' /etc/os-release || { printf '%s\n' 'Only the reviewed Ubuntu host is supported.' >&2; exit 1; }
[[ "$(hostname -s)" == 'vra-ubuntu-server-0579' ]] || { printf '%s\n' 'Connected host short name does not match the owner-confirmed VPS.' >&2; exit 1; }
if systemctl is-active --quiet caddy || systemctl is-active --quiet nginx; then
  printf '%s\n' 'A host Caddy/Nginx service is active; inspect port ownership before installation.' >&2
  exit 1
fi
if ss -H -lnt '( sport = :80 or sport = :443 )' | grep -q .; then
  printf '%s\n' 'A process already owns port 80 or 443; refusing to install the edge deployment.' >&2
  exit 1
fi
if [[ -e /opt/plfr-production || -e /etc/plfr-production ]]; then
  printf '%s\n' 'A production deployment path already exists; inspect it before installation.' >&2
  exit 1
fi

if getent passwd plfr-deploy >/dev/null; then
  printf '%s\n' 'The plfr-deploy account already exists; inspect it before changing anything.' >&2
  exit 1
fi
if [[ -e /var/lib/plfr-deploy ]]; then
  printf '%s\n' 'The deployment account home path already exists; inspect it before changing anything.' >&2
  exit 1
fi
if [[ -e /usr/local/sbin/plfr-deploy-ssh || -e /usr/local/sbin/plfr-production-deploy || -e /etc/sudoers.d/plfr-deploy ]]; then
  printf '%s\n' 'A deployment control file already exists; inspect it before changing anything.' >&2
  exit 1
fi

for hook in \
  /etc/letsencrypt/renewal-hooks/pre/40-plfr-stop-edge \
  /etc/letsencrypt/renewal-hooks/post/40-plfr-start-edge \
  /etc/letsencrypt/renewal-hooks/deploy/40-plfr-copy-certificate; do
  [[ ! -e "$hook" ]] || { printf '%s\n' 'A certificate renewal hook already exists; inspect it before installation.' >&2; exit 1; }
done
for hook_dir in /etc/letsencrypt/renewal-hooks/pre /etc/letsencrypt/renewal-hooks/post /etc/letsencrypt/renewal-hooks/deploy; do
  [[ -d "$hook_dir" && ! -L "$hook_dir" ]] || {
    printf '%s\n' 'Expected Certbot renewal hook directories are unavailable.' >&2
    exit 1
  }
done

exec 9>/run/lock/plfr-production-install.lock
flock -n 9 || { printf '%s\n' 'Another deployment host installation is already running.' >&2; exit 1; }

created_deploy_user=0
installation_committed=0
rollback_partial_install() {
  local status="$?"
  trap - EXIT
  if (( status != 0 && installation_committed == 0 )); then
    rm -f -- \
      /etc/sudoers.d/plfr-deploy \
      /etc/letsencrypt/renewal-hooks/pre/40-plfr-stop-edge \
      /etc/letsencrypt/renewal-hooks/post/40-plfr-start-edge \
      /etc/letsencrypt/renewal-hooks/deploy/40-plfr-copy-certificate \
      /var/lib/plfr-deploy/.ssh/authorized_keys \
      /usr/local/sbin/plfr-deploy-ssh \
      /usr/local/sbin/plfr-production-deploy \
      /opt/plfr-production/control/verify_github_release.py
    if (( created_deploy_user == 1 )); then
      userdel --remove plfr-deploy >/dev/null 2>&1 || true
    fi
    rmdir \
      /opt/plfr-production/control \
      /opt/plfr-production/releases \
      /opt/plfr-production \
      /etc/plfr-production/secrets \
      /etc/plfr-production/tls \
      /etc/plfr-production 2>/dev/null || true
  fi
  exit "$status"
}
trap rollback_partial_install EXIT

install -d -o root -g root -m 0755 /opt/plfr-production/control /opt/plfr-production/releases
install -d -o root -g root -m 0700 /etc/plfr-production /etc/plfr-production/secrets
install -d -o root -g 101 -m 0750 /etc/plfr-production/tls

useradd --system --create-home --home-dir /var/lib/plfr-deploy --shell /bin/sh --user-group plfr-deploy
created_deploy_user=1
passwd --lock plfr-deploy >/dev/null
install -d -o plfr-deploy -g plfr-deploy -m 0700 /var/lib/plfr-deploy/.ssh
printf 'restrict,command="/usr/local/sbin/plfr-deploy-ssh" %s\n' "$public_key" > /var/lib/plfr-deploy/.ssh/authorized_keys
chown plfr-deploy:plfr-deploy /var/lib/plfr-deploy/.ssh/authorized_keys
chmod 0600 /var/lib/plfr-deploy/.ssh/authorized_keys

install -o root -g root -m 0755 "$(dirname "$0")/deploy-ssh-wrapper.sh" /usr/local/sbin/plfr-deploy-ssh
install -o root -g root -m 0755 "$(dirname "$0")/deploy-root-entrypoint.sh" /usr/local/sbin/plfr-production-deploy
install -o root -g root -m 0644 "$(dirname "$0")/verify_github_release.py" /opt/plfr-production/control/verify_github_release.py
install -o root -g root -m 0755 "$(dirname "$0")/certbot-pre-hook.sh" /etc/letsencrypt/renewal-hooks/pre/40-plfr-stop-edge
install -o root -g root -m 0755 "$(dirname "$0")/certbot-post-hook.sh" /etc/letsencrypt/renewal-hooks/post/40-plfr-start-edge
install -o root -g root -m 0755 "$(dirname "$0")/certbot-deploy-hook.sh" /etc/letsencrypt/renewal-hooks/deploy/40-plfr-copy-certificate
printf '%s\n' 'plfr-deploy ALL=(root) NOPASSWD: /usr/local/sbin/plfr-production-deploy *' > /etc/sudoers.d/plfr-deploy
chown root:root /etc/sudoers.d/plfr-deploy
chmod 0440 /etc/sudoers.d/plfr-deploy
visudo -cf /etc/sudoers.d/plfr-deploy >/dev/null

installation_committed=1
printf '%s\n' 'Deployment account installed with a forced command and one restricted sudo entry.'
