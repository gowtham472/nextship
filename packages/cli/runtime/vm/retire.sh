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
# The container Caddy serves is never stopped, whatever `previous` says. The app's
# Caddy site names it on a `# live <container>` line, and that file is what Caddy
# reads, so it cannot disagree with what is serving. nextship empties `previous`
# before it points Caddy anywhere, so the two should never name the same container;
# this is for the case where they do, because stopping the live app is not undone by
# Docker's restart policy. With no such line to read, nothing is stopped either.
#
# Author: Ragul D
# Design: ../../../../docs/design.md §9.3

set -euo pipefail

APPS=/etc/nextship/apps
SITES=/etc/nextship/caddy/sites
[ -d "$APPS" ] || exit 0
now="$(date +%s)"

for file in "$APPS"/*/previous; do
  [ -s "$file" ] || continue
  app="$(basename "$(dirname "$file")")"
  read -r container until < "$file" || true
  [ -n "$container" ] || continue
  case "$until" in '' | *[!0-9]*) logger -t nextship-retire "$app: unreadable $file, left alone"; continue ;; esac
  [ "$now" -ge "$until" ] || continue
  live="$(sed -n 's/^# live //p' "$SITES/$app.caddy" 2> /dev/null | head -n 1)"
  if [ -z "$live" ] || [ "$live" = "$container" ]; then
    logger -t nextship-retire "$app: not stopping $container: ${live:+it is the container Caddy serves}${live:-the site file names no live container}"
    : > "$file"
    continue
  fi
  label="$(docker inspect -f '{{index .Config.Labels "sh.nextship.app"}}' "$container" 2> /dev/null || true)"
  if [ "$label" = "$app" ]; then
    # 30 s, the time a deployment gives a replaced container to finish its requests.
    docker stop -t 30 "$container" > /dev/null && logger -t nextship-retire "$app: stopped $container, kept for the tabs that loaded it until now"
  fi
  : > "$file"
done
