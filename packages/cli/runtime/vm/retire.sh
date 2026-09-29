#!/usr/bin/env bash
#
# @nextship/cli: retire the previous deployment
#
# Run every minute by a systemd timer that `nextship server add` installs.
#
# After a deployment the one it replaced keeps running for an hour, so a tab that
# loaded it can still fetch its files and call its Server Actions (caddy.ts). Each
# app's `previous` file, written by nextship with its deployment history, names that
# container and when it stops, as `<container> <epoch seconds>`. This stops it once
# that moment has passed and empties the file. Caddy's route to it then fails over
# to the live container, which is what such a request got before it was kept.
#
# Only a container labelled as this app's nextship container is ever stopped, so a
# damaged file cannot stop anything else. Stopped, not removed: its logs stay
# readable and the next deployment's cleanup removes it like any other.
#
# Author: Ragul D
# Design: ../../../../docs/design.md §9.3

set -euo pipefail

APPS=/etc/nextship/apps
[ -d "$APPS" ] || exit 0
now="$(date +%s)"

for file in "$APPS"/*/previous; do
  [ -s "$file" ] || continue
  app="$(basename "$(dirname "$file")")"
  read -r container until < "$file" || true
  case "$until" in '' | *[!0-9]*) logger -t nextship-retire "$app: unreadable $file, left alone"; continue ;; esac
  [ "$now" -ge "$until" ] || continue
  label="$(docker inspect -f '{{index .Config.Labels "sh.nextship.app"}}' "$container" 2> /dev/null || true)"
  if [ "$label" = "$app" ]; then
    # 30 s, the time a deployment gives a replaced container to finish its requests.
    docker stop -t 30 "$container" > /dev/null && logger -t nextship-retire "$app: stopped $container, kept for the tabs that loaded it until now"
  fi
  : > "$file"
done
