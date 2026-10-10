#!/usr/bin/env bash
#
# @nextship/cli: cache guard
#
# Run every ten minutes by a systemd timer that `nextship server add` installs.
#
# Next.js writes to disk for as long as an app serves: optimized images and the
# fetch cache in `.next/cache`, and every page it regenerates or renders for a new
# dynamic segment beside the build's own files in `.next`. Nothing in Next.js bounds
# either, and a crawler walking an app with dynamic segments can write gigabytes a
# day until the disk is full and every app on the server stops. This keeps what each
# app has written at runtime under a limit by deleting what was used least recently.
#
# Only what Next.js wrote at runtime is ever deleted: everything in the app's cache
# volume, and the files in a build volume modified after that volume was created.
# What the build produced is never touched, so a page with no revalidate time keeps
# the file it was prerendered into. Deleting an entry is safe while the app runs:
# Next.js reads a missing file as a cache miss and renders the page or encodes the
# image again. Every eviction is logged to the journal under nextship-cache-guard.
#
# "Used" is the later of a file's last access and its last write. Access times alone
# are not enough: under `relatime`, the default, the kernel updates one at most once
# a day, and under `noatime` never, where sorting by access would order files by
# nothing and evict the busiest with the idle. With the write time taken too, a
# volume that keeps no access times is evicted oldest written first, and one that
# does is evicted least recently used first, to the day.
#
# Author: Ragul D
# Design: ../../../../docs/design.md §9.3

set -euo pipefail

# Evicting down to below the limit, rather than to it, means one eviction is followed
# by some minutes of room instead of another eviction on the next run.
TARGET_PERCENT=80
APPS=/etc/nextship/apps

# An app may keep 10% of the disk Docker stores volumes on, and never less than 1 GiB,
# which is room for thousands of pages and optimized images.
limit_kib() {
  local disk
  disk="$(df -Pk "$1" | awk 'NR == 2 { print $2 }')"
  local share=$(( disk / 10 ))
  [ "$share" -lt 1048576 ] && share=1048576
  echo "$share"
}

# Prints "<last used> <KiB> <path>" for each file Next.js wrote at runtime under the
# given volume directories, where last used is the later of its access and write
# times. A build volume is given as "<dir>@<epoch>": only its files modified after
# that moment count.
runtime_files() {
  local entry dir since
  for entry in "$@"; do
    dir="${entry%@*}"
    [ -d "$dir" ] || continue
    if [ "$entry" = "$dir" ]; then
      find "$dir" -type f -printf '%A@ %T@ %k %p\n'
    else
      since="${entry##*@}"
      find "$dir" -type f -newermt "@$since" -printf '%A@ %T@ %k %p\n'
    fi
  done | awk '{ used = ($1 > $2) ? $1 : $2; sub(/^[^ ]+ [^ ]+ /, ""); print used, $0 }'
}

# Deletes the least recently used runtime files of one app until what remains is at
# most TARGET_PERCENT of the limit. Prints the number of files and KiB it removed.
evict() {
  local limit="$1"
  shift
  local listing total target removed=0 freed=0 atime kib path entry
  listing="$(runtime_files "$@" | sort -n)"
  total="$(awk '{ sum += $2 } END { print sum + 0 }' <<< "$listing")"
  if [ "$total" -le "$limit" ]; then
    echo "0 0"
    return
  fi
  target=$(( limit * TARGET_PERCENT / 100 ))
  while read -r atime kib path; do
    [ -n "$path" ] || continue
    [ "$total" -le "$target" ] && break
    rm -f -- "$path"
    total=$(( total - kib ))
    removed=$(( removed + 1 ))
    freed=$(( freed + kib ))
  done <<< "$listing"
  # An optimized image is a directory holding one file, so its directory goes too.
  for entry in "$@"; do
    [ -d "${entry%@*}" ] && find "${entry%@*}" -mindepth 1 -type d -empty -delete
  done
  echo "$removed $freed"
}

main() {
  [ -d "$APPS" ] || exit 0
  local app name volumes limit mount created result
  for app in $(ls "$APPS"); do
    volumes=()
    mount="$(docker volume inspect -f '{{.Mountpoint}}' "nextship-$app-cache" 2> /dev/null || true)"
    [ -n "$mount" ] && volumes+=("$mount")
    for name in $(docker volume ls -q --filter "name=^nextship-$app-build-dpl-"); do
      mount="$(docker volume inspect -f '{{.Mountpoint}}' "$name")"
      created="$(date -d "$(docker volume inspect -f '{{.CreatedAt}}' "$name")" +%s)"
      volumes+=("$mount@$created")
    done
    [ "${#volumes[@]}" -gt 0 ] || continue
    limit="$(limit_kib "${volumes[0]%@*}")"
    result="$(evict "$limit" "${volumes[@]}")"
    if [ "${result%% *}" != 0 ]; then
      logger -t nextship-cache-guard "$app: removed ${result%% *} least recently used cache files, $(( ${result##* } / 1024 )) MiB, to stay under its $(( limit / 1024 )) MiB limit"
    fi
  done
}

# Sourced by its tests, which call evict on a directory; run by the timer otherwise.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main; fi
