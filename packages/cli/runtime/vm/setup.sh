#!/usr/bin/env bash
#
# @nextship/cli: server setup
#
# Prepares an Ubuntu or Debian server to run nextship apps, one idempotent step at
# a time. `nextship server add` sends this script over SSH on stdin and runs it as
# root through `sudo -n`; nothing is copied to the server and nothing persists of
# it except what the steps create.
#
#   setup.sh plan  [--skip a,b]          prints one line per step and changes nothing
#   setup.sh apply [--skip a,b] step...  applies the named steps that are not already done
#
# Every step is a `check_<step>` that decides, and an `apply_<step>` that acts.
# `plan` runs only checks, so running it against a server that is already set up
# reports every step `ok` and is exactly how a second `server add` changes nothing.
# Output lines are the contract with the CLI:
#
#   STEP <name> <ok|change|done|skip|refuse> <detail>
#
# `refuse` means the server cannot run nextship as it stands; `apply` stops on one.
# `done` is printed only by `apply`, for a step it just changed.
#
# Environment, set by the CLI:
#   NEXTSHIP_ADMIN        the user nextship connected as, whose authorized_keys the
#                         nextship user receives
#   NEXTSHIP_SSH_PORT     the port that connection used, which the firewall keeps open
#   NEXTSHIP_MIN_DOCKER   the oldest Docker major nextship builds with (docker.ts)
#   NEXTSHIP_WATCHDOG_B64 the watchdog script, base64, installed by the watchdog step
#   NEXTSHIP_OS_RELEASE   tests only: an os-release file to read instead of
#                         /etc/os-release, so the OS check runs against fixtures
#
# Author: Ragul D
# Design: ../../../../docs/design.md §9.3

set -euo pipefail

# Raised whenever a step changes, so `server status` can tell a server set up by an
# older nextship to run `server add --yes` again.
SETUP_VERSION=2

# Pinned to a minor so a server gets the same Caddy until nextship moves it on purpose.
CADDY_IMAGE="caddy:2.10"

STEPS="os arch resources ports docker user dirs network caddy journald swap updates firewall watchdog ssh-hardening"

OS_RELEASE="${NEXTSHIP_OS_RELEASE:-/etc/os-release}"
MIN_DOCKER="${NEXTSHIP_MIN_DOCKER:-23}"
ADMIN="${NEXTSHIP_ADMIN:-root}"
SSH_PORT="${NEXTSHIP_SSH_PORT:-22}"

ETC=/etc/nextship
SERVICE_USER=nextship

report() { printf 'STEP %s %s %s\n' "$1" "$2" "$3"; }
have() { command -v "$1" > /dev/null 2>&1; }
docker_ready() { have docker && docker info > /dev/null 2>&1; }

# Each check sets STATUS and DETAIL rather than printing, so apply can reuse it.
STATUS=""
DETAIL=""
result() { STATUS="$1"; DETAIL="$2"; }

mem_mib() { awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo; }

# ------------------------------------------------------------------------- os

check_os() {
  if [ ! -r "$OS_RELEASE" ]; then result refuse "no $OS_RELEASE, so the distribution cannot be identified"; return; fi
  local id version
  id="$(. "$OS_RELEASE" && printf '%s' "${ID:-}")"
  version="$(. "$OS_RELEASE" && printf '%s' "${VERSION_ID:-}")"
  case "$id:$version" in
    ubuntu:22.04 | ubuntu:24.04 | debian:12) result ok "$id $version" ;;
    *) result refuse "${id:-unknown} ${version:-unknown} is not supported; use Ubuntu 22.04, Ubuntu 24.04 or Debian 12" ;;
  esac
}
apply_os() { :; }

# ----------------------------------------------------------------------- arch

check_arch() {
  case "$(uname -m)" in
    x86_64) result ok amd64 ;;
    aarch64 | arm64) result ok arm64 ;;
    *) result refuse "$(uname -m) is not supported; nextship builds for amd64 and arm64" ;;
  esac
}
apply_arch() { :; }

# ------------------------------------------------------------------ resources

check_resources() {
  local mem swap disk
  mem="$(mem_mib)"
  swap="$(awk '/^SwapTotal:/ { print int($2 / 1024) }' /proc/meminfo)"
  disk="$(df -Pk / | awk 'NR == 2 { print int($4 / 1048576) }')"
  # A "1 GB" plan reports about 960 MiB once the kernel has taken its share, so
  # the floor is set below that rather than refusing the smallest real servers.
  if [ "$mem" -lt 900 ]; then result refuse "${mem} MiB RAM, below the 1 GB nextship needs to run an app"; return; fi
  if [ "$disk" -lt 5 ]; then result refuse "${disk} GB free on /, below the 5 GB an image and its build need"; return; fi
  result ok "${mem} MiB RAM, ${swap} MiB swap, ${disk} GB free"
}
apply_resources() { :; }

# ---------------------------------------------------------------------- ports

check_ports() {
  local holders
  # Caddy's own ports are fine: that is this setup already applied. Docker
  # publishes them through docker-proxy, or through iptables with no process.
  # `|| true` because grep finding no other holder is the good outcome, and
  # pipefail would otherwise end the script on it.
  holders="$({ ss -H -ltnp '( sport = :80 or sport = :443 )' 2> /dev/null || true; } | { grep -v 'docker-proxy' || true; } | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | sort -u | tr '\n' ' ')"
  if [ -n "$holders" ]; then
    result refuse "ports 80 or 443 are held by: ${holders% }; stop it, or run nextship on a server without a web server"
    return
  fi
  result ok "80 and 443 are free for Caddy"
}
apply_ports() { :; }

# --------------------------------------------------------------------- docker

check_docker() {
  if ! have docker; then result change "install Docker CE from Docker's apt repository"; return; fi
  local version major
  version="$(docker version --format '{{.Server.Version}}' 2> /dev/null || true)"
  if [ -z "$version" ]; then result change "start the Docker daemon"; return; fi
  major="${version%%.*}"
  if [ "$major" -lt "$MIN_DOCKER" ]; then
    result refuse "Docker $version is older than $MIN_DOCKER; upgrade it, since nextship will not replace a Docker it did not install"
    return
  fi
  result ok "Docker $version"
}
apply_docker() {
  if ! have docker; then
    local id codename
    id="$(. "$OS_RELEASE" && printf '%s' "$ID")"
    codename="$(. "$OS_RELEASE" && printf '%s' "${VERSION_CODENAME:-}")"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -q
    apt-get install -y -q ca-certificates curl
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/${id}/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
      "$(dpkg --print-architecture)" "$id" "$codename" > /etc/apt/sources.list.d/docker.list
    apt-get update -q
    apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin
  fi
  systemctl enable --now docker
}

# ----------------------------------------------------------------------- user

# `nextship server reboot` is the one thing the nextship user needs root for. The
# rule names the exact command, so it grants nothing else through sudo.
SUDOERS=/etc/sudoers.d/nextship
SUDOERS_RULE="$SERVICE_USER ALL=(root) NOPASSWD: /usr/bin/systemctl reboot"

check_user() {
  if ! id "$SERVICE_USER" > /dev/null 2>&1; then result change "create the $SERVICE_USER user in the docker and systemd-journal groups"; return; fi
  local groups
  groups=" $(id -nG "$SERVICE_USER") "
  case "$groups" in *" docker "*) ;; *) result change "add $SERVICE_USER to the docker group"; return ;; esac
  case "$groups" in *" systemd-journal "*) ;; *) result change "add $SERVICE_USER to the systemd-journal group"; return ;; esac
  if [ ! -s "/home/$SERVICE_USER/.ssh/authorized_keys" ]; then result change "authorise the keys of $ADMIN for $SERVICE_USER"; return; fi
  if [ "$(cat "$SUDOERS" 2> /dev/null)" != "$SUDOERS_RULE" ]; then result change "allow $SERVICE_USER to run systemctl reboot, and nothing else, as root"; return; fi
  result ok "$SERVICE_USER exists, in the docker and systemd-journal groups, and may reboot"
}
apply_user() {
  id "$SERVICE_USER" > /dev/null 2>&1 || useradd --create-home --shell /bin/bash "$SERVICE_USER"
  usermod -aG docker,systemd-journal "$SERVICE_USER"
  local home source
  home="$(getent passwd "$ADMIN" | cut -d: -f6)"
  source="$home/.ssh/authorized_keys"
  if [ ! -s "$source" ]; then
    echo "$ADMIN has no authorized_keys to copy, so nobody could log in as $SERVICE_USER" >&2
    exit 3
  fi
  install -d -m 0700 -o "$SERVICE_USER" -g "$SERVICE_USER" "/home/$SERVICE_USER/.ssh"
  install -m 0600 -o "$SERVICE_USER" -g "$SERVICE_USER" "$source" "/home/$SERVICE_USER/.ssh/authorized_keys"
  printf '%s\n' "$SUDOERS_RULE" > "$SUDOERS.tmp"
  chmod 0440 "$SUDOERS.tmp"
  # A sudoers file sudo cannot parse breaks sudo for every user, so it is checked
  # before it is moved into place.
  visudo -cf "$SUDOERS.tmp" > /dev/null
  mv "$SUDOERS.tmp" "$SUDOERS"
}

# ----------------------------------------------------------------------- dirs

check_dirs() {
  if [ ! -d "$ETC/apps" ] || [ ! -d "$ETC/caddy/sites" ]; then result change "create $ETC, owned by $SERVICE_USER, mode 0700"; return; fi
  if [ "$(stat -c '%U %a' "$ETC")" != "$SERVICE_USER 700" ]; then result change "make $ETC owned by $SERVICE_USER, mode 0700"; return; fi
  result ok "$ETC"
}
apply_dirs() {
  install -d -m 0700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$ETC" "$ETC/apps" "$ETC/caddy" "$ETC/caddy/sites"
  chown "$SERVICE_USER:$SERVICE_USER" "$ETC"
  chmod 0700 "$ETC"
}

# -------------------------------------------------------------------- network

check_network() {
  if ! docker_ready; then result change "create the nextship Docker network, once Docker runs"; return; fi
  if docker network inspect nextship > /dev/null 2>&1; then result ok "Docker network nextship"; else result change "create the nextship Docker network"; fi
}
apply_network() { docker network inspect nextship > /dev/null 2>&1 || docker network create nextship > /dev/null; }

# ---------------------------------------------------------------------- caddy

# Sites are imported one file per app. The global block stays empty: every
# setting that matters is per site, so an app never changes another app's config.
CADDYFILE='# Written by nextship server add. Each app is one file in sites/.
import sites/*.caddy
'

check_caddy() {
  if ! docker_ready; then result change "run Caddy ($CADDY_IMAGE) on ports 80 and 443, once Docker runs"; return; fi
  local running image
  running="$(docker inspect -f '{{.State.Running}}' nextship-caddy 2> /dev/null || true)"
  image="$(docker inspect -f '{{.Config.Image}}' nextship-caddy 2> /dev/null || true)"
  if [ "$running" != "true" ]; then result change "run Caddy ($CADDY_IMAGE) on ports 80 and 443"; return; fi
  if [ "$image" != "$CADDY_IMAGE" ]; then result change "replace Caddy $image with $CADDY_IMAGE"; return; fi
  if [ "$(cat "$ETC/caddy/Caddyfile" 2> /dev/null)" != "$(printf '%s' "$CADDYFILE")" ]; then result change "rewrite $ETC/caddy/Caddyfile"; return; fi
  result ok "Caddy $CADDY_IMAGE serving 80 and 443"
}
apply_caddy() {
  printf '%s' "$CADDYFILE" > "$ETC/caddy/Caddyfile"
  chown "$SERVICE_USER:$SERVICE_USER" "$ETC/caddy/Caddyfile"
  local image
  image="$(docker inspect -f '{{.Config.Image}}' nextship-caddy 2> /dev/null || true)"
  if [ -n "$image" ] && [ "$image" != "$CADDY_IMAGE" ]; then docker rm -f nextship-caddy > /dev/null; fi
  # Pulled on its own and quietly, so a failure below is the error rather than a
  # page of layer progress.
  docker pull -q "$CADDY_IMAGE" > /dev/null
  if docker inspect nextship-caddy > /dev/null 2>&1; then
    docker start nextship-caddy > /dev/null
  else
    # Certificates and Caddy's state live in named volumes, so replacing the
    # container does not reissue every certificate and run into Let's Encrypt's
    # rate limits.
    docker run -d --name nextship-caddy --restart unless-stopped --network nextship \
      -p 80:80 -p 443:443 -p 443:443/udp \
      -v nextship-caddy-data:/data -v nextship-caddy-config:/config \
      -v "$ETC/caddy:/etc/caddy" \
      --label sh.nextship.caddy=true \
      "$CADDY_IMAGE" > /dev/null
  fi
  docker exec nextship-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile > /dev/null 2>&1 || true
}

# ------------------------------------------------------------------- journald

JOURNALD_DROPIN=/etc/systemd/journald.conf.d/nextship.conf

check_journald() {
  if [ -f "$JOURNALD_DROPIN" ]; then result ok "journal limited to 500M"; return; fi
  if grep -qs '^[[:space:]]*SystemMaxUse=' /etc/systemd/journald.conf /etc/systemd/journald.conf.d/*.conf; then
    result ok "journal size is already limited, left as it is"
    return
  fi
  result change "limit the journal to 500M, since app logs are kept there"
}
apply_journald() {
  install -d -m 0755 /etc/systemd/journald.conf.d
  printf '[Journal]\nSystemMaxUse=500M\n' > "$JOURNALD_DROPIN"
  systemctl restart systemd-journald
}

# ----------------------------------------------------------------------- swap

check_swap() {
  local mem
  mem="$(mem_mib)"
  if [ -n "$(swapon --show --noheadings 2> /dev/null)" ]; then result ok "swap already on"; return; fi
  if [ "$mem" -ge 4096 ]; then result ok "${mem} MiB RAM, no swap needed"; return; fi
  result change "add a 2 GB swap file, since ${mem} MiB RAM is tight for a build"
}
apply_swap() {
  [ -f /swapfile ] || { fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048; }
  chmod 600 /swapfile
  mkswap /swapfile > /dev/null
  swapon /swapfile
  grep -qs '^/swapfile ' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
}

# -------------------------------------------------------------------- updates

check_updates() {
  if package_installed unattended-upgrades && grep -qs 'Unattended-Upgrade "1"' /etc/apt/apt.conf.d/20auto-upgrades; then
    result ok "security updates install automatically"
    return
  fi
  result change "install security updates automatically with unattended-upgrades"
}
package_installed() { dpkg -s "$1" 2> /dev/null | grep -qx 'Status: install ok installed'; }
apply_updates() {
  export DEBIAN_FRONTEND=noninteractive
  package_installed unattended-upgrades || { apt-get update -q && apt-get install -y -q unattended-upgrades; }
  # The distribution's default origins are security updates only, which is what
  # this enables. Nothing here adds an origin.
  printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades
}

# ------------------------------------------------------------------- firewall

ssh_ports() {
  { sshd -T 2> /dev/null | awk '$1 == "port" { print $2 }'; printf '%s\n' "$SSH_PORT"; } | sort -un
}

check_firewall() {
  if ! have ufw; then result ok "ufw is not installed, left to your provider's firewall"; return; fi
  local status missing="" port
  status="$(ufw status 2> /dev/null || true)"
  case "$status" in *"Status: active"*) ;; *) result change "enable ufw allowing SSH ($(ssh_ports | tr '\n' ' ' | sed 's/ $//')), 80 and 443"; return ;; esac
  for port in $(ssh_ports) 80 443; do
    printf '%s\n' "$status" | grep -Eq "^${port}(/tcp)?[[:space:]]+ALLOW" || missing="$missing $port"
  done
  if [ -n "$missing" ]; then result change "allow${missing} in ufw"; return; fi
  result ok "ufw allows SSH, 80 and 443"
}
apply_firewall() {
  have ufw || return 0
  local port
  # SSH first, before anything is enabled, so this can never lock out the
  # connection it is running over.
  for port in $(ssh_ports); do ufw allow "${port}/tcp" > /dev/null; done
  ufw allow 80/tcp > /dev/null
  ufw allow 443/tcp > /dev/null
  ufw allow 443/udp > /dev/null
  ufw --force enable > /dev/null
}

# ------------------------------------------------------------------- watchdog

WATCHDOG=/usr/local/lib/nextship/watchdog.sh
WATCHDOG_SERVICE="[Unit]
Description=Restart nextship containers that stay unhealthy

[Service]
Type=oneshot
ExecStart=$WATCHDOG
"
# AccuracySec because systemd's default of a minute let runs drift to two minutes
# apart, measured on a test server, which stretched "three checks" to six minutes.
WATCHDOG_TIMER="[Unit]
Description=Run the nextship watchdog every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target
"

check_watchdog() {
  local expected=""
  [ -n "${NEXTSHIP_WATCHDOG_B64:-}" ] && expected="$(printf '%s' "$NEXTSHIP_WATCHDOG_B64" | base64 -d)"
  if [ ! -f "$WATCHDOG" ] || [ "$(cat "$WATCHDOG")" != "$expected" ] ||
    [ "$(cat /etc/systemd/system/nextship-watchdog.timer 2> /dev/null)" != "$(printf '%s' "$WATCHDOG_TIMER")" ] ||
    [ "$(cat /etc/systemd/system/nextship-watchdog.service 2> /dev/null)" != "$(printf '%s' "$WATCHDOG_SERVICE")" ]; then
    result change "install a watchdog that restarts containers unhealthy for 3 checks in a row"
    return
  fi
  if ! systemctl is-active --quiet nextship-watchdog.timer; then result change "start the watchdog timer"; return; fi
  result ok "watchdog runs every minute"
}
apply_watchdog() {
  install -d -m 0755 /usr/local/lib/nextship
  printf '%s' "$NEXTSHIP_WATCHDOG_B64" | base64 -d > "$WATCHDOG"
  chmod 0755 "$WATCHDOG"
  printf '%s' "$WATCHDOG_SERVICE" > /etc/systemd/system/nextship-watchdog.service
  printf '%s' "$WATCHDOG_TIMER" > /etc/systemd/system/nextship-watchdog.timer
  systemctl daemon-reload
  systemctl enable nextship-watchdog.timer > /dev/null 2>&1
  systemctl restart nextship-watchdog.timer
}

# -------------------------------------------------------------- ssh-hardening

# Named 10- because sshd keeps the first value it reads and reads drop-ins in
# order, and cloud images ship 50-cloud-init.conf with PasswordAuthentication yes.
SSHD_DROPIN=/etc/ssh/sshd_config.d/10-nextship.conf

check_ssh_hardening() {
  local effective
  effective="$(sshd -T 2> /dev/null || true)"
  if printf '%s\n' "$effective" | grep -qx 'passwordauthentication no' &&
    printf '%s\n' "$effective" | grep -Eqx 'permitrootlogin (prohibit-password|without-password|no)'; then
    result ok "password logins are off, root logs in by key only"
    return
  fi
  result change "turn off password logins and allow root by key only"
}
apply_ssh_hardening() {
  install -d -m 0755 /etc/ssh/sshd_config.d
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' > "$SSHD_DROPIN"
  if ! sshd -t; then
    rm -f "$SSHD_DROPIN"
    echo "sshd rejected the hardened configuration, so it was removed and nothing changed" >&2
    exit 3
  fi
  systemctl reload ssh 2> /dev/null || systemctl reload sshd
}

# ----------------------------------------------------------------------- main

step_fn() { printf '%s' "$1" | tr '-' '_'; }

mode="${1:-}"
shift || true
skip=","
if [ "${1:-}" = "--skip" ]; then
  skip=",${2:-},"
  shift 2
fi

case "$mode" in
  plan)
    refused=0
    for step in $STEPS; do
      case "$skip" in *",$step,"*) report "$step" skip "opted out"; continue ;; esac
      "check_$(step_fn "$step")"
      report "$step" "$STATUS" "$DETAIL"
      if [ "$STATUS" = refuse ]; then
        refused=1
        # Nothing after an unsupported OS or architecture means anything.
        case "$step" in os | arch) exit 3 ;; esac
      fi
    done
    exit "$refused"
    ;;
  apply)
    for step in "$@"; do
      case " $STEPS " in *" $step "*) ;; *) echo "unknown step: $step" >&2; exit 2 ;; esac
      case "$skip" in *",$step,"*) continue ;; esac
      "check_$(step_fn "$step")"
      if [ "$STATUS" = refuse ]; then report "$step" refuse "$DETAIL"; exit 3; fi
      if [ "$STATUS" = change ]; then
        "apply_$(step_fn "$step")"
        "check_$(step_fn "$step")"
        if [ "$STATUS" != ok ]; then report "$step" "$STATUS" "$DETAIL"; exit 3; fi
        report "$step" done "$DETAIL"
      else
        report "$step" "$STATUS" "$DETAIL"
      fi
    done
    if [ -d "$ETC" ]; then
      printf '{"setupVersion":%s}\n' "$SETUP_VERSION" > "$ETC/server.json"
      chown "$SERVICE_USER:$SERVICE_USER" "$ETC/server.json" 2> /dev/null || true
    fi
    ;;
  *)
    echo "usage: setup.sh plan|apply [--skip a,b] [step...]" >&2
    exit 2
    ;;
esac
