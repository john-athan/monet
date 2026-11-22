#!/bin/sh
# Every check monet has, by part. Run it directly, through `oss check monet`, or
# let CI call it, one part per job:
#   tools/validate.sh              every part this machine can build
#   tools/validate.sh app          only the server and the web app
#   tools/validate.sh mac android  any selection
set -eu
cd "$(dirname "$0")/.."

parts="${*:-app mac android}"
fail=0
step() { printf '\n== %s\n' "$1"; }
check() { if "$@"; then echo "ok"; else echo "FAILED: $*"; fail=1; fi; }

for part in $parts; do
  case "$part" in
    app)
      step "app: bun test"
      check sh -c 'cd app && bun test' ;;
    mac)
      if [ "$(uname)" = Darwin ]; then
        step "mac: make test"
        check make -C mac test
      else
        step "mac: skipped, it needs macOS"
      fi ;;
    android)
      step "android: lint and unit tests"
      check android/tools/validate.sh ;;
    *) echo "unknown part: $part (app, mac, android)"; exit 2 ;;
  esac
done

if [ "$fail" -ne 0 ]; then printf '\nvalidate: FAILED\n'; exit 1; fi
printf '\nvalidate: everything passes\n'
