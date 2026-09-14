#!/usr/bin/env bash
#
# @nextship/cli: container watchdog
#
# Run every minute by a systemd timer that `nextship server add` installs.
#
# Docker records a container as unhealthy but never acts on it: `--restart` only
# reacts to the process exiting, so an app that hangs while its process stays up
# keeps its failing health check forever. This restarts a nextship container that
# has been unhealthy for three consecutive runs, about three minutes, which is long
# enough that a slow start or a brief stall is left alone. Only containers labelled
# sh.nextship.managed=true are ever looked at; nothing else on the server is touched.
# Every restart is logged to the journal with the reason, under the tag
# nextship-watchdog.
#
# Author: Ragul D
# Design: ../../../../docs/design.md §9.3

set -euo pipefail

STATE=/run/nextship-watchdog
THRESHOLD=3
mkdir -p "$STATE"

seen=" "
for id in $(docker ps -q --filter label=sh.nextship.managed=true); do
  seen="$seen$id "
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2> /dev/null || true)"
  if [ "$health" != "unhealthy" ]; then
    rm -f "$STATE/$id"
    continue
  fi
  count=$(( $(cat "$STATE/$id" 2> /dev/null || echo 0) + 1 ))
  if [ "$count" -ge "$THRESHOLD" ]; then
    name="$(docker inspect -f '{{.Name}}' "$id" | sed 's#^/##')"
    logger -t nextship-watchdog "restarting $name: unhealthy for $count consecutive checks"
    docker restart "$id" > /dev/null || logger -t nextship-watchdog "restart of $name failed"
    rm -f "$STATE/$id"
  else
    echo "$count" > "$STATE/$id"
  fi
done

# Forget containers that no longer run, so a replaced container's count never carries over.
for file in "$STATE"/*; do
  [ -e "$file" ] || continue
  case "$seen" in *" $(basename "$file") "*) ;; *) rm -f "$file" ;; esac
done
